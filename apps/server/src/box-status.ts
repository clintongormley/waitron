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
import type { SlotSummary, SubscriptionStatus } from "@waitron/sync";
import type { BackupStatus } from "./backup-status.js";
import { readCertExpiry, type CertExpiry } from "./cert-expiry.js";
import { readChainHeight, type ChainHeight } from "./chain-height.js";
import { checkTimeHealth, type TimeHealth } from "./time-health.js";
import { healthSnapshot, type HealthState } from "./health.js";
import { requireManagementSession } from "@waitron/server-kit";
import { createErrorBoundary } from "@waitron/server-kit";
import type { Logger } from "./logger.js";

/**
 * The box-status wire shape. `cert.available: false`, `replication.configured: false` and
 * `backup.configured: false` are the deliberate N/A placeholders — cert when no TLS path is configured
 * or the leaf is unreadable, replication when neither a slot nor a subscription reader is wired (native
 * replication off), backup when scheduled backup is off. Native replication (swap S4) reports the box's
 * OWN side: a PRIMARY is a `publisher` and lists its peers' slots (`listSlots`); a MIRROR is a
 * `subscriber` and reports its subscription health incl. the narrowed `publications` (I6,
 * `readSubscriptionStatus`). `chain` is passed through untouched; the "no records" signal is
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
  replication:
    | { configured: false }
    | {
        configured: true;
        role: "publisher";
        slots: { peer: string; active: boolean; walStatus: string | null; retainedBytes: string }[];
      }
    | {
        configured: true;
        role: "subscriber";
        enabled: boolean;
        workerUp: boolean;
        tablesReady: number;
        tablesTotal: number;
        applyErrorCount: number;
        syncErrorCount: number;
        publications: string[];
      };
  disposal:
    | { applicable: false }
    | {
        applicable: true;
        carrierNodeId: string;
        drained: boolean;
        active: boolean;
        walStatus: string | null;
        retainedBytes: string | null;
      };
  backup: BackupStatus;
  duties: Record<string, unknown>;
};

/** The carrier a fenced node drains onto, plus its native slot-drain verdict (Ruling C2). `drained` is
 * `isDrained(slot, fenceLsn)` — computed by the boot-wired reader, which holds the fence LSN — so
 * box-status stays pure. Only present when the node is fenced with a known carrier; a serving node
 * reports `disposal.applicable:false`. */
export type DisposalStatus = {
  carrierNodeId: string;
  drained: boolean;
  active: boolean;
  walStatus: string | null;
  retainedBytes: bigint | null;
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
  /** A PRIMARY's peer slots (`listSlots`), or `undefined` when this box is not a publisher. */
  replicationSlots: (() => Promise<SlotSummary[]>) | undefined;
  /** A MIRROR's subscription health (`readSubscriptionStatus`), or `undefined` when this box holds no
   * subscription. Exactly one of `replicationSlots`/`replicationSubscription` is wired per boot; if
   * neither is, replication reads `configured: false`. */
  replicationSubscription: (() => Promise<SubscriptionStatus>) | undefined;
  disposal: (() => Promise<DisposalStatus>) | undefined;
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

  // Native replication (swap S4) reports the box's OWN side. A PRIMARY is a publisher and lists its
  // peers' slots; a MIRROR is a subscriber and reports its subscription (incl. the narrowed
  // `publications`, I6). Exactly one reader is wired per boot; neither ⇒ `configured: false`. The
  // publisher branch takes precedence when both are somehow present (a primary never holds a
  // subscription in the steady state). bigint → string on the wire (never `Number()`).
  let replication: BoxStatus["replication"] = { configured: false };
  if (readers.replicationSlots !== undefined) {
    const slots = await readers.replicationSlots();
    replication = {
      configured: true,
      role: "publisher",
      slots: slots.map((s) => ({
        peer: s.slotName,
        active: s.active,
        walStatus: s.walStatus,
        retainedBytes: (s.retainedBytes ?? 0n).toString(),
      })),
    };
  } else if (readers.replicationSubscription !== undefined) {
    const sub = await readers.replicationSubscription();
    replication = {
      configured: true,
      role: "subscriber",
      enabled: sub.enabled,
      workerUp: sub.workerUp,
      tablesReady: sub.tablesReady,
      tablesTotal: sub.tablesTotal,
      applyErrorCount: sub.applyErrorCount,
      syncErrorCount: sub.syncErrorCount,
      publications: sub.publications,
    };
  }

  // A fenced node draining onto a carrier surfaces the drain verdict so the box is never junked blind;
  // an absent reader means the node is serving (unfenced / no carrier), reported `applicable:false`.
  // `drained` (`isDrained(slot, fenceLsn)`) and `active` come precomputed from the boot-wired reader.
  // bigint → string on the wire (never `Number()`), matching the `replication` precedent.
  let disposal: BoxStatus["disposal"] = { applicable: false };
  if (readers.disposal !== undefined) {
    const d = await readers.disposal();
    disposal = {
      applicable: true,
      carrierNodeId: d.carrierNodeId,
      drained: d.drained,
      active: d.active,
      walStatus: d.walStatus,
      retainedBytes: d.retainedBytes?.toString() ?? null,
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
    awaitingFiscalCertificate: readers.awaitingFiscalCertificate(),
    chain,
    singletonRole,
    replication,
    disposal,
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
  /** A PRIMARY's peer-slot lister (`listSlots` on the migrator/owner pool), or `undefined` on a mirror. */
  readReplicationSlots: (() => Promise<SlotSummary[]>) | undefined;
  /** A MIRROR's subscription reader (`readSubscriptionStatus` on the migrator/owner pool), or
   * `undefined` on a primary. Exactly one of the two is wired per boot. */
  readReplicationSubscription: (() => Promise<SubscriptionStatus>) | undefined;
  readDisposal: (() => Promise<DisposalStatus>) | undefined;
  readBackup: (() => Promise<BackupStatus>) | undefined;
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
        awaitingFiscalCertificate: () => deps.readAwaitingFiscalCertificate(),
        chain: async () => chain,
        replicationSlots: deps.readReplicationSlots,
        replicationSubscription: deps.readReplicationSubscription,
        disposal: deps.readDisposal,
        backup: deps.readBackup,
        duties: () =>
          healthSnapshot(deps.health, deps.now()).body.duties as Record<string, unknown>,
      });
      return c.json(status, 200);
    }),
  );
}
