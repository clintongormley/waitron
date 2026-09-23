import { fileURLToPath } from "node:url";

/**
 * This package's migration set — `packages/workforce-es`'s first owned table, `convenio_config`.
 * Exported as data rather than a function because ordering across packages is the RUNTIME's
 * responsibility, and a descriptor makes the caller state that order out loud. `convenio_config`'s
 * one foreign key is into core's `locations`, and the set does not need core to have run first:
 * applied before core through `applyMigrations`, it migrates cleanly (measured 2026-09-23).
 *
 * Its own journal table (`__drizzle_migrations_workforce_es`) keeps this Spain lane migration
 * isolated from the workforce and fiscal sequences: journals never collide, so the lanes run in
 * parallel with no shared bookkeeping. Registered in packages/migrations/migrations.manifest.json
 * after `workforce` and before `fiscal-verifactu`.
 */
export const WORKFORCE_ES_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_workforce_es",
} as const;
