import { fileURLToPath } from "node:url";
import { appendOnlyTablesIn } from "@waitron/sync-enrolment";
import { FISCAL_CLASSIFICATION } from "./classification.js";

/**
 * The code needs core PRESENT: `liveSeriesBases` reads core's `invoice_series`.
 * `appendOnlyTables` travels with the set because those tables exist only once it has migrated.
 */
export const FISCAL_MIGRATIONS = {
  // Resolved from this module's URL, not the cwd, which differs between `pnpm -r` and `--filter`.
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_fiscal",
  appendOnlyTables: appendOnlyTablesIn(FISCAL_CLASSIFICATION),
} as const;
