import { fileURLToPath } from "node:url";

/**
 * This package's migration set. Exported as data rather than a function because ordering across
 * packages is the RUNTIME's responsibility, and a descriptor makes the caller state that order out
 * loud. The set migrates before or after core alike (measured 2026-09-23 through
 * `applyMigrations`), but the code needs core PRESENT: `listReconcilable` joins core's
 * `working_orders` (`./store.ts:801`).
 */
export const PAYMENTS_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_payments",
} as const;
