import { fileURLToPath } from "node:url";
import { appendOnlyTablesIn } from "@waitron/sync-enrolment";
import { CORE_CLASSIFICATION } from "@waitron/db";
import { CATALOGUE_TABLES } from "./classification.js";

/**
 * `appendOnlyTables` travels with the set, so a caller that hands it to `applyMigrations` protects
 * them.
 */
export const CATALOGUE_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_catalogue",
  appendOnlyTables: appendOnlyTablesIn(
    CORE_CLASSIFICATION.filter(({ table }) =>
      (CATALOGUE_TABLES as readonly string[]).includes(table),
    ),
  ),
} as const;
