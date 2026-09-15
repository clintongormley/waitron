import { fileURLToPath } from "node:url";

/**
 * This package's migration set. Exported as data because cross-package ordering is the RUNTIME's
 * responsibility — core migrations must run before these (`sessions.till_id` references core's
 * `tills`) — and a descriptor makes the caller state that order out loud.
 */
export const IDENTITY_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_identity",
} as const;
