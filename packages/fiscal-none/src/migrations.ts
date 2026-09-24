import { fileURLToPath } from "node:url";

/**
 * The empty migration set: a journal with zero entries, so this applies as a no-op. This module is
 * the "no fiscal regime" slot and owns no tables, but the module contract still requires a migration
 * set, so it ships an empty one.
 */
export const FISCAL_NONE_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_fiscal_none",
} as const;
