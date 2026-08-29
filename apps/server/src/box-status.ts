import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  asAppUser,
  withTenant,
  type Database,
  type DeploymentEnvironment,
  type DeploymentMode,
} from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { SubscriberLag } from "@waitron/sync";
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
 * backup unconditionally until 4b fills it in. `chain` is passed through untouched; the "no records"
 * signal is `chain.height === 0`, never `chain.lastAt`.
 */
export type BoxStatus = {
  mode: DeploymentMode;
  environment: DeploymentEnvironment;
  time: TimeHealth;
  cert: { available: true; notAfter: string; daysRemaining: number } | { available: false };
  chain: ChainHeight;
  replication:
    { configured: false } | { configured: true; worstLagSeq: string; subscribers: number };
  backup: { configured: false };
  duties: Record<string, unknown>;
};

export type BoxStatusReaders = {
  mode: () => Promise<DeploymentMode>;
  environment: DeploymentEnvironment;
  time: () => Promise<TimeHealth>;
  cert: (() => Promise<CertExpiry>) | undefined;
  chain: () => Promise<ChainHeight>;
  replicationLag: (() => Promise<SubscriberLag[]>) | undefined;
  duties: () => Record<string, unknown>;
};

export async function collectBoxStatus(readers: BoxStatusReaders): Promise<BoxStatus> {
  const [mode, time, chain] = await Promise.all([readers.mode(), readers.time(), readers.chain()]);

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
    // (never `Number()`); an empty subscriber list summarises as a zero worst-lag.
    const lags = await readers.replicationLag();
    replication = {
      configured: true,
      worstLagSeq: (lags[0]?.lag ?? 0n).toString(),
      subscribers: lags.length,
    };
  }

  return {
    mode,
    environment: readers.environment,
    time,
    cert,
    chain,
    replication,
    backup: { configured: false },
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
  readMode: () => DeploymentMode;
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
        environment: deps.environment,
        time: () => checkTimeHealth(),
        cert: certPath === undefined ? undefined : () => readCertExpiry(certPath, deps.now()),
        chain: async () => chain,
        replicationLag: deps.readReplicationLag,
        duties: () =>
          healthSnapshot(deps.health, deps.now()).body.duties as Record<string, unknown>,
      });
      return c.json(status, 200);
    }),
  );
}
