import { fileURLToPath } from "node:url";
import { appendOnlyTablesIn } from "@waitron/sync-enrolment";
import { FISCAL_CLASSIFICATION } from "./classification.js";

/**
 * This package's migration set. Exported as data rather than as a `runFiscalMigrations()`
 * function because ordering across packages is the RUNTIME's responsibility, and a descriptor makes
 * the caller state that order out loud. The set migrates before or after core alike (measured
 * 2026-09-23 through `applyMigrations`), but the code needs core PRESENT: `liveSeriesBases` reads
 * core's `invoice_series` (`./reserved-series.ts:55`).

 * `appendOnlyTables` is the third field a caller needs and drizzle does not: the tables this set's
 * own module declared `appendOnly()`. It travels WITH the set because that is the only level at
 * which the list is true — the tables exist once this set has migrated and not before — so every
 * caller that applies a set has what it needs to protect it, whether it is `applyMigrations` on the
 * box or `useVenueDb` in a suite. Derived, never written out: a hand-copied list beside the
 * declarations is the drift this repository has already paid for elsewhere.
 */
export const FISCAL_MIGRATIONS = {
  // Resolved from this module's own URL. `main` points at TS source and there is no build step,
  // so a path relative to cwd would resolve differently under `pnpm -r test` than under
  // `pnpm --filter … test`.
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_fiscal",
  appendOnlyTables: appendOnlyTablesIn(FISCAL_CLASSIFICATION),
} as const;
