import { fileURLToPath } from "node:url";

/**
 * Exported as data rather than a function because ordering across packages is the RUNTIME's
 * responsibility, and a descriptor makes the caller state that order out loud.
 */
export const WORKFORCE_ES_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_workforce_es",
} as const;
