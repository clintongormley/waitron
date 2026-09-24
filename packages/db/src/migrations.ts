import { fileURLToPath } from "node:url";
import { appendOnlyTablesIn } from "@waitron/sync-enrolment";
import { CORE_CLASSIFICATION } from "./classification.js";

/**
 * This package's own migration set. A module package composes its own migrations with core's by
 * running both descriptors, in order, against one database — ordering is the RUNTIME's
 * responsibility, never Drizzle's, so both halves of that composition are handed out as plain data.
 *
 * `migrationsTable` matches `drizzle.config.ts`'s own `migrations.table`.
 *
 * `appendOnlyTables` travels WITH the set because the tables exist once this set has migrated and
 * not before, so every caller that applies a set has what it needs to protect it. Derived, never
 * written out.
 */
export const CORE_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_db",
  appendOnlyTables: appendOnlyTablesIn(CORE_CLASSIFICATION),
} as const;
