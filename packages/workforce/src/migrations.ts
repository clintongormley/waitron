import { fileURLToPath } from "node:url";
import { appendOnlyTablesIn } from "@waitron/sync-enrolment";
import { WORKFORCE_CLASSIFICATION } from "./classification.js";

/**
 * This package's migration set. Exported as data rather than a function because ordering across
 * packages is the RUNTIME's responsibility, and a descriptor makes the caller state that order out
 * loud. Its foreign keys into core's `locations`, `tills` and `nodes` and identity's `persons` do
 * not need those sets to have run first: applied before both through `applyMigrations`, it
 * migrates cleanly (measured 2026-09-23).
 *
 * Its own journal table (`__drizzle_migrations_workforce`) is what keeps the workforce lane
 * migration-isolated from the fiscal sequence: journals never collide, so this lane runs in
 * parallel with no shared bookkeeping. Registered in packages/migrations/migrations.manifest.json
 * after `core`, before `fiscal`.

 * `appendOnlyTables` is the third field a caller needs and drizzle does not: the tables this set's
 * own module declared `appendOnly()`. It travels WITH the set because that is the only level at
 * which the list is true — the tables exist once this set has migrated and not before — so every
 * caller that applies a set has what it needs to protect it, whether it is `applyMigrations` on the
 * box or `useVenueDb` in a suite. Derived, never written out: a hand-copied list beside the
 * declarations is the drift this repository has already paid for elsewhere.
 */
export const WORKFORCE_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_workforce",
  appendOnlyTables: appendOnlyTablesIn(WORKFORCE_CLASSIFICATION),
} as const;
