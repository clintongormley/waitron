import { fileURLToPath } from "node:url";
import { appendOnlyTablesIn } from "@waitron/sync-enrolment";
import { WORKFORCE_CLASSIFICATION } from "@waitron/workforce";
import { STAFFING_TABLES } from "./classification.js";

export const STAFFING_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_staffing",
  appendOnlyTables: appendOnlyTablesIn(
    WORKFORCE_CLASSIFICATION.filter(({ table }) =>
      (STAFFING_TABLES as readonly string[]).includes(table),
    ),
  ),
} as const;
