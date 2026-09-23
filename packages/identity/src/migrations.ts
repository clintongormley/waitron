import { fileURLToPath } from "node:url";

/**
 * This package's migration set. Exported as data because cross-package ordering is the RUNTIME's
 * responsibility — core migrations must run before these — and a descriptor makes the caller state
 * that order out loud. Until the storage switch dropped it, `sessions.till_id` referencing core's
 * `tills` was the reason; the requirement outlived the key.
 */
export const IDENTITY_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_identity",
} as const;
