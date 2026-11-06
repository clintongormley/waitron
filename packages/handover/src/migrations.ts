import { fileURLToPath } from "node:url";
import { appendOnlyTablesIn } from "@waitron/sync-enrolment";
import { CORE_CLASSIFICATION } from "@waitron/db";
import { HANDOVER_TABLES } from "./tables.js";

export const HANDOVER_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_handover",
  appendOnlyTables: appendOnlyTablesIn(
    CORE_CLASSIFICATION.filter(({ table }) =>
      (HANDOVER_TABLES as readonly string[]).includes(table),
    ),
  ),
} as const;
