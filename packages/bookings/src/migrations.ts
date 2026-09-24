import { fileURLToPath } from "node:url";

export const BOOKINGS_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_bookings",
} as const;
