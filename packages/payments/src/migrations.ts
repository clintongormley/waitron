import { fileURLToPath } from "node:url";

export const PAYMENTS_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_payments",
} as const;
