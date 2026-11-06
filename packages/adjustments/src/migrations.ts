import { fileURLToPath } from "node:url";
import { appendOnlyTablesIn } from "@waitron/sync-enrolment";
import { CORE_CLASSIFICATION } from "@waitron/db";
import { ADJUSTMENTS_TABLES } from "./classification.js";

export const ADJUSTMENTS_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_adjustments",
  appendOnlyTables: appendOnlyTablesIn(
    CORE_CLASSIFICATION.filter(({ table }) =>
      (ADJUSTMENTS_TABLES as readonly string[]).includes(table),
    ),
  ),
} as const;
