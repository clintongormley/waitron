import { fileURLToPath } from "node:url";

export const MEDIA_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_media",
} as const;
