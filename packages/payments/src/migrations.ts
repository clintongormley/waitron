import { fileURLToPath } from "node:url";
import { appendOnlyTablesIn } from "@waitron/sync-enrolment";
import { PAYMENTS_CLASSIFICATION } from "./classification.js";

export const PAYMENTS_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_payments",
  appendOnlyTables: appendOnlyTablesIn(PAYMENTS_CLASSIFICATION),
} as const;
