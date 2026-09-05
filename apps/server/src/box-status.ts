import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { sql } from "drizzle-orm";
import {
  asAppUser,
  withTenant,
  type Database,
  type DeploymentEnvironment,
  type DeploymentMode,
  type SingletonRole,
} from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { DrainProgress, SubscriberLag } from "@waitron/sync";
import type { BackupStatus } from "./backup-status.js";
import { readCertExpiry, type CertExpiry } from "./cert-expiry.js";
import { readChainHeight, type ChainHeight } from "./chain-height.js";
import { checkTimeHealth, type TimeHealth } from "./time-health.js";
import { healthSnapshot, type HealthState } from "./health.js";
import { requireManagementSession } from "./management-session.js";
import { createErrorBoundary } from "./error-boundary.js";
import type { Logger } from "./logger.js";

/**
 * The box-status wire shape. `cert.available: false`, `replication.configured: false`,
 * `backup.configured: false` and `configConflicts.configured: false` are the deliberate N/A
 * placeholders — cert when no TLS path is configured or the leaf is unreadable, replication when sync is
 * off (Task 6 supplies the reader), backup when scheduled backup is off (no reader wired), and
 * configConflicts when the sync module is off (a `toggleable` module — its `sync_config_conflicts` ops
 * table then does not exist, so the reader is absent). `chain` is passed through untouched; the "no
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
  disposal:
    | { applicable: false }
    | {
        applicable: true;
        carrierNodeId: string;
        drained: boolean;
        ownTailSeq: string | null;
        carrierAppliedSeq: string | null;
      };
  backup: BackupStatus;
  /** The count of config-class rows primary-wins has overridden and recorded for ops review
   * (membership Slice 7). `configured: false` when the sync module is off (the `sync_config_conflicts`
   * ops table does not exist, so no reader is wired); otherwise the current `count` (0 is the healthy
   * norm — conflicts accrue only while a carrier drains a returned node's tail, spec §7). */
  configConflicts: { configured: false } | { configured: true; count: number };
  duties: Record<string, unknown>;
};

/** The carrier a fenced node drains onto, plus its drain progress (membership rejoin R2). Only present
 * when the node is fenced and a carrier is known; a serving node reports `disposal.applicable:false`. */
export type DisposalStatus = { carrierNodeId: string } & DrainProgress;

export type BoxStatusReaders = {
  mode: () => Promise<DeploymentMode>;
  environment: DeploymentEnvironment;
  time: () => Promise<TimeHealth>;
  cert: (() => Promise<CertExpiry>) | undefined;
  chain: () => Promise<ChainHeight>;
  singletonRole: () => Promise<SingletonRole>;
  replicationLag: (() => Promise<SubscriberLag[]>) | undefined;
  disposal: (() => Promise<DisposalStatus>) | undefined;
  backup: (() => Promise<BackupStatus>) | undefined;
  configConflicts: (() => Promise<{ count: number }>) | undefined;
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

  // A fenced node draining onto a carrier surfaces the drain verdict so the box is never junked blind;
  // an absent reader means the node is serving (unfenced / no carrier), reported `applicable:false`.
  // bigint → string on the wire (never `Number()`), matching the `replication` precedent.
  let disposal: BoxStatus["disposal"] = { applicable: false };
  if (readers.disposal !== undefined) {
    const d = await readers.disposal();
    disposal = {
      applicable: true,
      carrierNodeId: d.carrierNodeId,
      drained: d.drained,
      ownTailSeq: d.ownTailSeq?.toString() ?? null,
      carrierAppliedSeq: d.carrierAppliedSeq?.toString() ?? null,
    };
  }

  // Backup mirrors replication's fail-loud posture, NOT cert's swallow: an absent reader means backup
  // is off (`configured: false`), but a reader that FAULTS (a filesystem error reading the dump dir) is
  // a real problem worth surfacing — never a silent fallback to "off".
  let backup: BoxStatus["backup"] = { configured: false };
  if (readers.backup !== undefined) {
    backup = await readers.backup();
  }

  // Config-conflict count (membership Slice 7). Absent reader ⇒ the sync module is off, so the ops table
  // does not exist — `configured: false`, the same N/A shape as replication/backup. A reader that FAULTS
  // propagates (fail-loud, like replication/backup, NOT swallowed like cert): a failed count read is a
  // real problem worth surfacing, never a silent "off".
  let configConflicts: BoxStatus["configConflicts"] = { configured: false };
  if (readers.configConflicts !== undefined) {
    const c = await readers.configConflicts();
    configConflicts = { configured: true, count: c.count };
  }

  return {
    mode,
    environment: readers.environment,
    time,
    cert,
    chain,
    singletonRole,
    replication,
    disposal,
    backup,
    configConflicts,
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
  readDisposal: (() => Promise<DisposalStatus>) | undefined;
  readBackup: (() => Promise<BackupStatus>) | undefined;
  readConfigConflicts: (() => Promise<{ count: number }>) | undefined;
  readMode: () => DeploymentMode;
  readSingletonRole: () => SingletonRole;
};

/**
 * Counts the append-only `sync_config_conflicts` ops rows (membership Slice 7) — config-class writes
 * primary-wins overrode while a carrier drained a returned node's tail (spec §7). Read through the
 * `sync_tailer` role, NOT `app_user`: `row_image` is a jsonb copy of a rejected CONFIG row (tenant
 * business data), so its SELECT is granted to the dedicated NOLOGIN `sync_tailer` reader only
 * (0009_sync_config_conflicts.sql), the same isolation `sync_log` enforces (app_user INSERT-only). So
 * `db` MUST be the sync_tailer pool (`lagPool`/`syncDb`, a sync_tailer member) and this MUST NOT
 * `asAppUser` — a `SET ROLE app_user` would drop the sync_tailer membership's SELECT and be refused —
 * mirroring the lag reader's "NO asAppUser here" note (boot.ts). The table carries no RLS and no
 * tenant_id (0009), so no `withTenant` GUC is needed: a bare `count(*)` is the whole read. It needs no
 * index (Slice-7 minor: an index is deferred until a list/filter surface lands).
 */
export async function readConfigConflictCount(db: Database): Promise<{ count: number }> {
  const r = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from sync_config_conflicts`,
  );
  // `count(*)` is an aggregate with no GROUP BY, so it ALWAYS returns exactly one row (0 when empty) —
  // hence `.rows[0]!` rather than a `?? 0` fallback that could never run.
  return { count: r.rows[0]!.count };
}

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
        disposal: deps.readDisposal,
        backup: deps.readBackup,
        configConflicts: deps.readConfigConflicts,
        duties: () =>
          healthSnapshot(deps.health, deps.now()).body.duties as Record<string, unknown>,
      });
      return c.json(status, 200);
    }),
  );
}
