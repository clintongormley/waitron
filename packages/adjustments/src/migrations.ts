import { fileURLToPath } from "node:url";
import { appendOnlyTablesIn } from "@waitron/sync-enrolment";
import { ADJUSTMENTS_CLASSIFICATION } from "./classification.js";

export const ADJUSTMENTS_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_adjustments",
  appendOnlyTables: appendOnlyTablesIn(ADJUSTMENTS_CLASSIFICATION),
} as const;
