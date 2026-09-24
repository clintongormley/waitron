import { fileURLToPath } from "node:url";
import { appendOnlyTablesIn } from "@waitron/sync-enrolment";
import { WORKFORCE_CLASSIFICATION } from "./classification.js";

/**
 * `appendOnlyTables` travels with the set because those tables exist only once this set has
 * migrated, so every caller that applies it can protect them.
 */
export const WORKFORCE_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_workforce",
  appendOnlyTables: appendOnlyTablesIn(WORKFORCE_CLASSIFICATION),
} as const;
