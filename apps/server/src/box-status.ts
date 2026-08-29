import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  asAppUser,
  withTenant,
  type Database,
  type DeploymentEnvironment,
  type DeploymentMode,
  type SingletonRole,
} from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { SubscriberLag } from "@waitron/sync";
import type { BackupStatus } from "./backup-status.js";
import { readCertExpiry, type CertExpiry } from "./cert-expiry.js";
import { readChainHeight, type ChainHeight } from "./chain-height.js";
import { checkTimeHealth, type TimeHealth } from "./time-health.js";
import { healthSnapshot, type HealthState } from "./health.js";
import { requireManagementSession } from "./management-session.js";
import { createErrorBoundary } from "./error-boundary.js";
import type { Logger } from "./logger.js";

/**
 * The box-status wire shape. `cert.available: false`, `replication.configured: false` and
 * `backup.configured: false` are the deliberate N/A placeholders — cert when no TLS path is
 * configured or the leaf is unreadable, replication when sync is off (Task 6 supplies the reader),
 * backup when scheduled backup is off (no reader wired). `chain` is passed through untouched; the "no
 * records" signal is `chain.height === 0`, never `chain.lastAt`.
 */
export type BoxStatus = {
  mode: DeploymentMode;
  environment: DeploymentEnvironment;
  time: TimeHealth;
  cert: { available: true; notAfter: string; daysRemaining: number } | { available: false };
  chain: ChainHeight;
  singletonRole: SingletonRole;
  replication:
    { configured: false } | { configured: true; worstLagSeq: string; subscribers: number };
  backup: BackupStatus;
  duties: Record<string, unknown>;
};

export type BoxStatusReaders = {
  mode: () => Promise<DeploymentMode>;
  environment: DeploymentEnvironment;
  time: () => Promise<TimeHealth>;
  cert: (() => Promise<CertExpiry>) | undefined;
  chain: () => Promise<ChainHeight>;
  singletonRole: () => Promise<SingletonRole>;
  replicationLag: (() => Promise<SubscriberLag[]>) | undefined;
  backup: (() => Promise<BackupStatus>) | undefined;
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

  let replication: BoxStatus["replication"] = { configured: false };
  if (readers.replicationLag !== undefined) {
    // `lagFor` returns worst-first, so the head is the worst lag. bigint → string on the wire
    // (never `Number()`); an empty subscriber list summarises as a zero worst-lag. `lagFor` yields one
    // row per `(subscriber, origin)` pair, so `subscribers` is a DISTINCT count of subscriber ids, not
    // `lags.length` — a multi-origin future would otherwise over-count.
    const lags = await readers.replicationLag();
    replication = {
      configured: true,
      worstLagSeq: (lags[0]?.lag ?? 0n).toString(),
      subscribers: new Set(lags.map((l) => l.subscriberId)).size,
    };
  }

  // Backup mirrors replication's fail-loud posture, NOT cert's swallow: an absent reader means backup
  // is off (`configured: false`), but a reader that FAULTS (a filesystem error reading the dump dir) is
  // a real problem worth surfacing — never a silent fallback to "off".
  let backup: BoxStatus["backup"] = { configured: false };
  if (readers.backup !== undefined) {
    backup = await readers.backup();
  }

  return {
    mode,
    environment: readers.environment,
    time,
    cert,
    chain,
    singletonRole,
    replication,
    backup,
    duties: readers.duties(),
  };
}

export type BoxStatusDeps = {
  db: Database;
  cfg: { tenantId: string; nodeId: string };
  environment: DeploymentEnvironment;
  health: HealthState;
  now: () => Date;
  tlsCertPath: string | undefined;
  readReplicationLag: (() => Promise<SubscriberLag[]>) | undefined;
  readBackup: (() => Promise<BackupStatus>) | undefined;
  readMode: () => DeploymentMode;
  readSingletonRole: () => SingletonRole;
};

/**
 * The AppError codes this route can surface, and their HTTP status — the same code→status entries the
 * management API's `STATUS` map assigns them (reused, not reinvented). `requireManagementSession`
 * throws `management_session.required` (401); `authorizeManager` re-resolves the session
 * (`management_session.required`/`.expired` → 401, `person.suspended` → 403) and refuses a role without
 * `till.configure` with `authorization.not_permitted` (403). Any other thrown value is a server fault
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
 * `requireManagementSession` → 401 before any DB work, then `withTenant` + `asAppUser` +
 * `authorizeManager("till.configure")` for the tenant-scoped chain read (a `manager`-role person holds
 * it). The composed status is assembled by `collectBoxStatus` from the sibling slice-4a readers; a cert
 * path absent (plain-HTTP boot) yields `cert.available:false`, a lag reader absent (sync off, or Task 6
 * not yet wired) yields `replication.configured:false`.
 */
export function mountBoxStatusApi(app: Hono, deps: BoxStatusDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "box-status.failed");
  app.get("/api/box/status", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c); // throws 401 if absent
      const chain = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "till.configure",
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
        chain: async () => chain,
        replicationLag: deps.readReplicationLag,
        backup: deps.readBackup,
        duties: () =>
          healthSnapshot(deps.health, deps.now()).body.duties as Record<string, unknown>,
      });
      return c.json(status, 200);
    }),
  );
}
