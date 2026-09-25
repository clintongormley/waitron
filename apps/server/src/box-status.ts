import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  withTransaction,
  type Database,
  type DeploymentEnvironment,
  type DeploymentMode,
  type SingletonRole,
} from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { StreamView } from "@waitron/stream";
import type { BackupStatus } from "./backup-status.js";
import { readCertExpiry, type CertExpiry } from "./cert-expiry.js";
import { readChainHeight, type ChainHeight } from "./chain-height.js";
import { checkTimeHealth, type TimeHealth } from "./time-health.js";
import { healthSnapshot, type HealthState } from "./health.js";
import { requireManagementSession } from "@waitron/server-kit";
import { createErrorBoundary } from "@waitron/server-kit";
import type { Logger } from "./logger.js";

/**
 * The box-status wire shape. `cert.available: false` and `backup.configured: false` are the deliberate
 * N/A placeholders — cert when no TLS path is configured or the leaf is unreadable, backup when
 * scheduled backup is off. `chain` is passed through untouched; the "no records" signal is
 * `chain.height === 0`, never `chain.lastAt`.
 */
export type BoxStatus = {
  mode: DeploymentMode;
  environment: DeploymentEnvironment;
  time: TimeHealth;
  cert: { available: true; notAfter: string; daysRemaining: number } | { available: false };
  /**
   * True when this node is a filing primary whose last drain pass skipped for a missing `fiscal.aeat`
   * certificate — the promoted-mirror "sell and chain now, file once the cert lands" state (pass.ts's
   * `AwaitingCertStatus`). `false` on any node that is filing normally, or not the singleton primary
   * (a non-primary runs no drain, so the cell never leaves its `false` default).
   */
  awaitingFiscalCertificate: boolean;
  chain: ChainHeight;
  singletonRole: SingletonRole;
  backup: BackupStatus;
  stream: StreamView;
  duties: Record<string, unknown>;
};

export type BoxStatusReaders = {
  mode: () => Promise<DeploymentMode>;
  environment: DeploymentEnvironment;
  time: () => Promise<TimeHealth>;
  cert: (() => Promise<CertExpiry>) | undefined;
  /** The awaiting-fiscal-certificate cell read (pass.ts's `AwaitingCertStatus`). Always present — it is
   * an in-process boolean, never an off-vs-on slot — read synchronously like `duties`. */
  awaitingFiscalCertificate: () => boolean;
  chain: () => Promise<ChainHeight>;
  singletonRole: () => Promise<SingletonRole>;
  backup: (() => Promise<BackupStatus>) | undefined;
  stream: () => StreamView;
  duties: () => Record<string, unknown>;
};

export async function collectBoxStatus(readers: BoxStatusReaders): Promise<BoxStatus> {
  const [mode, time, chain, singletonRole] = await Promise.all([
    readers.mode(),
    readers.time(),
    readers.chain(),
    readers.singletonRole(),
  ]);

  let cert: BoxStatus["cert"] = { available: false };
  if (readers.cert !== undefined) {
    try {
      const c = await readers.cert();
      cert = { available: true, notAfter: c.notAfter, daysRemaining: c.daysRemaining };
    } catch {
      // A missing or unreadable leaf must never fail the whole status read.
      cert = { available: false };
    }
  }

  // Backup fails LOUD, unlike cert's swallow: an absent reader means backup is off
  // (`configured: false`), but a reader that FAULTS (a filesystem error reading the dump dir) is a real
  // problem worth surfacing — never a silent fallback to "off".
  let backup: BoxStatus["backup"] = { configured: false };
  if (readers.backup !== undefined) {
    backup = await readers.backup();
  }

  return {
    mode,
    environment: readers.environment,
    time,
    cert,
    awaitingFiscalCertificate: readers.awaitingFiscalCertificate(),
    chain,
    singletonRole,
    backup,
    stream: readers.stream(),
    duties: readers.duties(),
  };
}

export type BoxStatusDeps = {
  db: Database;
  cfg: { nodeId: string };
  environment: DeploymentEnvironment;
  health: HealthState;
  now: () => Date;
  tlsCertPath: string | undefined;
  readBackup: (() => Promise<BackupStatus>) | undefined;
  readStream: () => StreamView;
  readMode: () => DeploymentMode;
  readSingletonRole: () => SingletonRole;
  /** Reads the awaiting-fiscal-certificate cell the fiscal pass writes (pass.ts's `AwaitingCertStatus`),
   * the same live holder, so box-status tracks a promoted mirror's "sell now, file later" state without
   * a DB read. */
  readAwaitingFiscalCertificate: () => boolean;
};

/**
 * The AppError codes this route can surface, and their HTTP status — the same code→status entries the
 * management API's `STATUS` map assigns them (reused, not reinvented). `requireManagementSession`
 * throws `management_session.required` (401); `authorizeManager` re-resolves the session
 * (`management_session.required`/`.expired` → 401, `person.suspended` → 403) and refuses a role without
 * `system.manage` with `authorization.not_permitted` (403). Any other thrown value is a server fault
 * the boundary answers with an opaque 500.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
};

/**
 * Registers `GET /api/box/status` on the shared trading app. Gated exactly like the FP-1 status routes:
 * `requireManagementSession` → 401 before any DB work, then `withTransaction` +
 * `authorizeManager("system.manage")` for the chain read (a `manager`-role person holds
 * it). The composed status is assembled by `collectBoxStatus` from the sibling slice-4a readers; a cert
 * path absent (plain-HTTP boot) yields `cert.available:false`.
 */
export function mountBoxStatusApi(app: Hono, deps: BoxStatusDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "box-status.failed");
  app.get("/api/box/status", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c); // throws 401 if absent
      const chain = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "system.manage",
        });
        return readChainHeight(tx, deps.cfg.nodeId);
      });
      const certPath = deps.tlsCertPath;
      const status = await collectBoxStatus({
        mode: () => Promise.resolve(deps.readMode()),
        singletonRole: () => Promise.resolve(deps.readSingletonRole()),
        environment: deps.environment,
        time: () => checkTimeHealth(),
        cert: certPath === undefined ? undefined : () => readCertExpiry(certPath, deps.now()),
        awaitingFiscalCertificate: () => deps.readAwaitingFiscalCertificate(),
        chain: async () => chain,
        backup: deps.readBackup,
        stream: deps.readStream,
        duties: () =>
          healthSnapshot(deps.health, deps.now()).body.duties as Record<string, unknown>,
      });
      return c.json(status, 200);
    }),
  );
}
