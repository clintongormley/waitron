import { fileURLToPath } from "node:url";

export const ADJUSTMENTS_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_adjustments",
} as const;
