import { fileURLToPath } from "node:url";

/**
 * Exported as data because cross-package ordering is the RUNTIME's responsibility. This set does
 * not need core to have run first.
 */
export const IDENTITY_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_identity",
} as const;
