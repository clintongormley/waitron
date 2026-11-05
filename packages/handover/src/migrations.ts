import { fileURLToPath } from "node:url";
import { appendOnlyTablesIn } from "@waitron/sync-enrolment";
import { HANDOVER_CLASSIFICATION } from "./classification.js";

export const HANDOVER_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_handover",
  appendOnlyTables: appendOnlyTablesIn(HANDOVER_CLASSIFICATION),
} as const;
