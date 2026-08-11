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
export { ENROLLED } from "./registry.js";
export type { CaptureOp, EnrolledTable, SyncMode } from "./registry.js";

// The static per-table apply SQL, built once from the registry + live schema (never from row data).
export { applyStatementFor, deleteStatementFor } from "./apply-sql.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable from
// this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts.
// See errors.reachability.test.ts.
import "./errors.js";
