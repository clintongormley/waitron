import { fileURLToPath } from "node:url";

/**
 * This package's migration set. Exported as data because cross-package ordering is the RUNTIME's
 * responsibility, and a descriptor makes the caller state that order out loud. This set does not
 * need core to have run first: applied before core through `applyMigrations`, it migrates cleanly
 * (measured 2026-09-23).
 */
export const IDENTITY_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_identity",
} as const;
