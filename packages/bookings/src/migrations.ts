import { fileURLToPath } from "node:url";

/**
 * The bookings module's migration set — the runtime `{ migrationsFolder, migrationsTable }` shape a
 * test's `usePgliteDb`/`runMigrationSets` applies, the same way `packages/db` exports
 * `CORE_MIGRATIONS`. Its own journal table keeps this lane migration-isolated from core's
 * `__drizzle_migrations_db`. Bookings FKs into `core`, so a fixture applies the whole manifest in
 * order (see the package's `src/testing/migrations.ts`), the same way `@waitron/fiscal-verifactu` does.
 */
export const BOOKINGS_MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  migrationsTable: "__drizzle_migrations_bookings",
} as const;
