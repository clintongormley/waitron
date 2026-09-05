// The entire public surface of @waitron/sync. Re-exports only — no logic here.
//
// Task 2 adds the outbox migration descriptor; Task 3 adds the static per-table apply SQL (built
// from an injected enrolment set since the SP-2a inversion — the per-table registry entries
// themselves now live in each owning package's own `enrolment.ts`, assembled only by the composition
// root; only the generic vocabulary — the types and the `SYNC_LANES`/`tablesForLane` helpers — is
// re-exported here from `@waitron/sync-enrolment`, see below). The apply loop and retention helpers
// land in later tasks
// (docs/superpowers/plans/2026-08-08-sync-slice1-commercial-outbox-plan.md, Tasks 4/6).

// The commercial-lane sync outbox migration set, consumed by @waitron/migrations' manifest (and its
// manifest.test.ts, which pins the journal-table name against this descriptor).
export { SYNC_MIGRATIONS } from "./migrations.js";

// The enrolment vocabulary — re-exported from the leaf `@waitron/sync-enrolment` so existing importers
// of `@waitron/sync` keep resolving these. `@waitron/sync` no longer OWNS the enrolment data (there is
// no central enrolment constant here any more): the assembled module set is injected by the composition
// root (SP-2a inversion). The lane helper and types travel here; the per-table apply metadata is
// declared by each owning package.
export { SYNC_LANES, tablesForLane } from "@waitron/sync-enrolment";
export type { CaptureOp, EnrolledTable, SyncLane, SyncMode } from "@waitron/sync-enrolment";

// The producer-side disposal guard — a returned/fenced node proves LOCALLY that its own-origin
// sync_log tail has fully drained onto the carrier (per-lane own high-water vs the carrier's reported
// sync_cursor), the read box-status surfaces before a node is safely disposable (rejoin §6 step 3).
export { readDrainProgress } from "./disposal.js";
export type { DrainProgress, DrainProgressArgs } from "./disposal.js";

// The static per-table apply SQL, built once per injected enrolment set from each entry's columns
// (never from row data).
export { applyStatementFor, deleteStatementFor } from "./apply-sql.js";

// The apply loop — take a peer's captured sync_log rows and write each into the local mirror as the
// non-superuser app role under withTenant, idempotently and in seq order, with the environment
// handshake up front (docs/superpowers/plans/2026-08-08-sync-slice1-commercial-outbox-plan.md Task 4).
export { applyBatch } from "./apply.js";
export type { ApplyBatchOptions, ApplyBatchResult, SyncLogRow } from "./apply.js";

// The sync_tailer source read — select a peer's captured sync_log rows past a cursor, row_image as
// raw jsonb text, under the deli tenant context (docs/superpowers/plans/2026-08-15-sync-transport-slice1.md Task 5).
export { readSyncLogSince } from "./source.js";
export type { ReadSyncLogArgs } from "./source.js";

// The NDJSON wire codec — one JSON object per line, seq as a decimal string and row_image as a raw
// jsonb-text string field (design §4b) so JS never re-parses a numeric across the wire (Task 6).
export { decodeBatch, encodeBatch } from "./wire.js";

// The pull client — syncPullOnce (env handshake + fetch + apply one batch) and the runSyncPull
// background loop boot.ts starts (drain-per-peer, bounded backoff, stream_stalled alarm) — Task 9.
export { runSyncPull, syncPullOnce } from "./pull.js";
export type { HttpClient, PullPeer, RunSyncPullDeps, SyncPullDeps } from "./pull.js";

// Bounded log retention (prune to the min across ALL subscriber cursors — a down subscriber holds the
// log), per-subscriber lag reporting, the explicit eviction verb, and the scheduled retention sweep
// boot starts (prune + lag alarm each tick; never evicts, never alive-filters — spec §3.2/§3.4).
export { evictSubscriber, lagFor, pruneSyncLog, runRetentionSweep } from "./retention.js";
export type { PruneResult, RetentionSweepDeps, SubscriberLag } from "./retention.js";

// The source-side cursor-report writer — a subscriber's POSTed cursor recorded into the source's OWN
// sync_cursor (origin=self), so retention holds the log at the min across every subscriber (spec §3.1).
export { recordSubscriberCursor } from "./cursor-report.js";
export type { RecordSubscriberCursorArgs } from "./cursor-report.js";

// Per-peer subscriber identity for the sync source: mint a peer's bearer token and resolve a
// presented token to its subscriber_id (spec docs/.../2026-08-27-sync-cloud-mirror-peer-identity-design.md).
export { authenticatePeer, enrolPeer, listPeers, revokePeer } from "./peers.js";
export type { EnrolPeerInput, PeerSummary } from "./peers.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable from
// this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts.
// See errors.reachability.test.ts.
import "./errors.js";
