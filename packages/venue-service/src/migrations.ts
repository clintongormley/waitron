import { fileURLToPath } from "node:url";

export const VENUE_SERVICE_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_venue_service",
} as const;
