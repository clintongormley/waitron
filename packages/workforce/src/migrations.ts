import { fileURLToPath } from "node:url";

/**
 * This package's migration set. Exported as data rather than a function because ordering across
 * packages is the RUNTIME's responsibility — core migrations must run before these (the `tenants`
 * foreign key) — and a descriptor makes the caller state that order out loud.
 *
 * Its own journal table (`__drizzle_migrations_workforce`) is what keeps the workforce lane
 * migration-isolated from the fiscal sequence: journals never collide, so this lane runs in
 * parallel with no shared bookkeeping. Registered in packages/migrations/migrations.manifest.json
 * after `core`, before `fiscal`.
 */
export const WORKFORCE_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_workforce",
} as const;
