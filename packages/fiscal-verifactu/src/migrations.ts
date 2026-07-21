import { fileURLToPath } from "node:url";

/**
 * This package's migration set. Exported as data rather than as a `runFiscalMigrations()`
 * function because ordering is the RUNTIME's responsibility — nothing in Drizzle enforces that
 * core migrations run before module ones, and a function that ran them itself would invite a
 * caller to run it first. Handing back a descriptor makes the caller state the order out loud.
 */
export const FISCAL_MIGRATIONS = {
  // Resolved from this module's own URL. `main` points at TS source and there is no build step,
  // so a path relative to cwd would resolve differently under `pnpm -r test` than under
  // `pnpm --filter … test`.
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_fiscal",
} as const;
