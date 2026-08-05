import { CORE_MIGRATIONS } from "@waitron/db";
import {
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
} from "@waitron/db/testing/postgres.js";

export type { RealPostgres };

/**
 * Starts a real PostgreSQL server and applies `@waitron/db`'s core migrations against it.
 *
 * `@waitron/catalogue` owns no migrations of its own — the `catalogues`/`categories`/`products`
 * tables and their FORCE-RLS/grant lines live in `CORE_MIGRATIONS` (0026/0027), so this suite needs
 * only that one set, unlike `packages/payments-stripe`'s helper which pairs core with its package's
 * own set. Real Postgres (not PGlite) because the isolation suite this feeds probes RLS under a
 * non-superuser role, which PGlite's superuser connection bypasses (see operations.rls.test.ts).
 */
export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired:
      "The catalogue RLS suite requires a running Docker daemon. It cannot be skipped: PGlite's " +
      "superuser bypasses row-level security, so it cannot exercise the tenant-isolation policies " +
      "and the SELECT/INSERT/UPDATE (no DELETE) grants this suite exists to verify (see " +
      "operations.rls.test.ts).",
    migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
  });
}
