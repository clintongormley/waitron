import { fileURLToPath } from "node:url";

/**
 * The empty migration set: a journal with zero entries, so this applies as a no-op. This module is
 * the "no fiscal regime" slot and owns no tables, but the module contract still requires a migration
 * set, so it ships an empty one. Its own journal table (`__drizzle_migrations_fiscal_none`) keeps
 * this lane migration-isolated: journals never collide, so the lanes run in parallel with no shared
 * bookkeeping.
 */
export const FISCAL_NONE_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_fiscal_none",
} as const;
