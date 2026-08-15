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
 * `@waitron/recipes` owns no migrations of its own — the `ingredients`/`recipe_lines` tables and
 * their FORCE-RLS/grant lines live in `CORE_MIGRATIONS`, so this suite needs only that one set,
 * exactly as `packages/catalogue`'s helper does for its own tables. Real Postgres (not PGlite)
 * because the isolation suites this feeds probe RLS under a non-superuser role, which PGlite's
 * superuser connection bypasses. The RLS suites that exercise this are `ingredients.rls.test.ts`
 * and `recipe-lines.rls.test.ts`, both of which call `startRealPostgres()`.
 */
export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired:
      "The recipes RLS suites require a running Docker daemon. They cannot be skipped: PGlite's " +
      "superuser bypasses row-level security, so it cannot exercise the tenant-isolation policies " +
      "and the SELECT/INSERT/UPDATE (no DELETE) grants on the ingredient tables.",
    migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
  });
}
