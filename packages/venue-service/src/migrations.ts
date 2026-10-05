import { fileURLToPath } from "node:url";
import { appendOnlyTablesIn } from "@waitron/sync-enrolment";
import { VENUE_SERVICE_CLASSIFICATION } from "./classification.js";

export const VENUE_SERVICE_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_venue_service",
  appendOnlyTables: appendOnlyTablesIn(VENUE_SERVICE_CLASSIFICATION),
} as const;
