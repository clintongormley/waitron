// The entire public surface of @waitron/sync. Re-exports only — no logic here.
//
// Task 1 is the package skeleton, so there is nothing to re-export yet: the enrolment registry, the
// apply loop and the retention helpers land in later tasks
// (docs/superpowers/plans/2026-08-08-sync-slice1-commercial-outbox-plan.md, Tasks 3/4/6). Until then
// this barrel exists only to keep errors.ts reachable from the public surface, below.

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable from
// this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts.
// See errors.reachability.test.ts.
import "./errors.js";
