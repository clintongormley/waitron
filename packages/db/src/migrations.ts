import { fileURLToPath } from "node:url";
import { appendOnlyTablesIn } from "@waitron/sync-enrolment";
import { CORE_CLASSIFICATION } from "./classification.js";

/**
 * This package's own migration set, in the same descriptor shape as
 * `packages/fiscal-verifactu`'s `FISCAL_MIGRATIONS` (Task 12). A module package composes its own
 * migrations with core's by running both descriptors, in order, against one database — ordering
 * is the RUNTIME's responsibility, never Drizzle's, so both halves of that composition are handed
 * out as plain data rather than as a function that would silently decide the order itself.
 *
 * `migrationsTable` matches `drizzle.config.ts`'s own `migrations.table` — `__drizzle_migrations_db`,
 * not Drizzle's bare default of `__drizzle_migrations`, which this package deliberately avoids so
 * that a consumer never confuses "the journal Drizzle would use if you forgot the option" with
 * "the journal this package actually uses".
 *
 * One definition, one folder, one journal table: a package that needs core's migrations imports
 * this constant rather than naming the folder again.
 *
 * `appendOnlyTables` is the third field a caller needs and drizzle does not: the tables this set's
 * own module declared `appendOnly()`. It travels WITH the set because that is the only level at
 * which the list is true — the tables exist once this set has migrated and not before — so every
 * caller that applies a set has what it needs to protect it, whether it is `applyMigrations` on the
 * box or `useVenueDb` in a suite. Derived, never written out: a hand-copied list beside the
 * declarations is the drift this repository has already paid for elsewhere.
 */
export const CORE_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_db",
  appendOnlyTables: appendOnlyTablesIn(CORE_CLASSIFICATION),
} as const;
