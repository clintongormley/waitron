// The entire public surface of @waitron/sync. Re-exports only — no logic here.
//
// Task 2 adds the outbox migration descriptor; Task 3 adds the enrolment registry and the static
// per-table apply SQL. The apply loop and retention helpers land in later tasks
// (docs/superpowers/plans/2026-08-08-sync-slice1-commercial-outbox-plan.md, Tasks 4/6).

// The commercial-lane sync outbox migration set, consumed by @waitron/migrations' manifest (and its
// manifest.test.ts, which pins the journal-table name against this descriptor).
export { SYNC_MIGRATIONS } from "./migrations.js";

// The enrolment registry — the audit surface for "what crosses the wire" (the fourteen commercial
// tables, their apply mode, conflict key, watermark and capture ops).
export { ENROLLED, tablesForLane } from "./registry.js";
export type { CaptureOp, EnrolledTable, SyncLane, SyncMode } from "./registry.js";

// The static per-table apply SQL, built once from the registry + live schema (never from row data).
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
// log) and per-subscriber lag reporting (docs/superpowers/plans/2026-08-08-sync-slice1-commercial-outbox-plan.md
// Task 6).
export { lagFor, pruneSyncLog } from "./retention.js";
export type { PruneResult, SubscriberLag } from "./retention.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable from
// this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts.
// See errors.reachability.test.ts.
import "./errors.js";
