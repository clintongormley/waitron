// The entire public surface of @waitron/sync. Re-exports only — no logic here.
//
// Task 2 adds the outbox migration descriptor. The enrolment registry, the apply loop and the
// retention helpers land in later tasks
// (docs/superpowers/plans/2026-08-08-sync-slice1-commercial-outbox-plan.md, Tasks 3/4/6).

// The commercial-lane sync outbox migration set, consumed by @waitron/migrations' manifest (and its
// manifest.test.ts, which pins the journal-table name against this descriptor).
export { SYNC_MIGRATIONS } from "./migrations.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable from
// this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts.
// See errors.reachability.test.ts.
import "./errors.js";
