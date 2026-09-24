import { fileURLToPath } from "node:url";

export const SCHEDULER_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_scheduler",
} as const;
