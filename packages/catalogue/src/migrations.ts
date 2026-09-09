import { fileURLToPath } from "node:url";

export const CATALOGUE_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_catalogue",
} as const;
