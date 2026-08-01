import { CORE_MIGRATIONS } from "@waitron/db";
import {
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
} from "@waitron/db/testing/postgres.js";

export type { RealPostgres };

/**
 * Starts a real PostgreSQL server and runs `@waitron/db`'s own migrations against it. Only
 * `CORE_MIGRATIONS` — `packages/core` owns no module tables of its own, so unlike
 * `packages/payments`'s starter there is no second set to compose after core's.
 *
 * `settleSale`'s RLS behaviour (a cross-tenant sale reads back as `sale.not_found`, never as a
 * forbidden row) and its concurrency behaviour (two callers race on `sale_settlements`'s UNIQUE key
 * on distinct backend processes) cannot be exercised on PGlite: it connects as a superuser, which
 * bypasses `FORCE ROW LEVEL SECURITY`, and it serialises every query onto one backend, so a
 * contention test on it is a false pass rather than a weak one (design §7, CLAUDE.md §4).
 */
export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired:
      "settle-sale.test.ts requires a running Docker daemon. It cannot be skipped: PGlite's " +
      "superuser bypasses row-level security (so the cross-tenant not_found path proves nothing) " +
      "and it serialises onto one backend (so the settlement race is a false pass) — see " +
      "settle-sale.test.ts and the design's §7.",
    migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
  });
}
