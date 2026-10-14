import { fileURLToPath } from "node:url";
import { appendOnlyTablesIn } from "@waitron/sync-enrolment";
import { STAFFING_CLASSIFICATION } from "./classification.js";

export const STAFFING_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_staffing",
  appendOnlyTables: appendOnlyTablesIn(STAFFING_CLASSIFICATION),
} as const;
