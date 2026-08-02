import { fileURLToPath } from "node:url";

/**
 * This package's migration set — `packages/workforce-es`'s first owned table, `convenio_config`.
 * Exported as data rather than a function because ordering across packages is the RUNTIME's
 * responsibility — core migrations must run before these (the `tenants`/`locations` foreign keys) —
 * and a descriptor makes the caller state that order out loud.
 *
 * Its own journal table (`__drizzle_migrations_workforce_es`) keeps this Spain lane migration
 * isolated from the workforce and fiscal sequences: journals never collide, so the lanes run in
 * parallel with no shared bookkeeping. Registered in packages/migrations/migrations.manifest.json
 * AFTER `workforce`, BEFORE `fiscal` — `convenio_config` FKs only core `tenants`/`locations`, so it
 * needs no ordering after `workforce`'s own tables, and keeping `credentials` last preserves the
 * provisioning RLS test's `last.name === "credentials"` assertion.
 */
export const WORKFORCE_ES_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_workforce_es",
} as const;
