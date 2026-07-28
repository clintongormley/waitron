import { fileURLToPath } from "node:url";

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
 * `src/testing/harness.ts` imports this rather than computing its own. It carried a private
 * duplicate, under a comment giving two reasons: the constant was "not exported" (scoped to
 * `harness.ts`'s own module surface — that stayed true right up to deletion; the private const was
 * never exported from that module) and that a later package with its own migrations folder (e.g.
 * `fiscal-verifactu`) "supplies its own core migrations rather than importing this package's" — that
 * second clause is the one that went stale: `packages/fiscal-verifactu/src/testing/postgres.ts` now
 * imports `CORE_MIGRATIONS` from `@waitron/db`, precisely what it said would not happen. Same
 * folder, same table, one definition.
 */
export const CORE_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_db",
} as const;
