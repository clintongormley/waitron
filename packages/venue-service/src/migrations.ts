import { fileURLToPath } from "node:url";
import { appendOnlyTablesIn } from "@waitron/sync-enrolment";
import { CORE_CLASSIFICATION } from "@waitron/db";
import { VENUE_SERVICE_TABLES } from "./classification.js";

export const VENUE_SERVICE_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_venue_service",
  appendOnlyTables: appendOnlyTablesIn(
    CORE_CLASSIFICATION.filter(({ table }) =>
      (VENUE_SERVICE_TABLES as readonly string[]).includes(table),
    ),
  ),
} as const;
