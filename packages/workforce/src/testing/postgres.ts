import { CORE_MIGRATIONS } from "@waitron/db";
import {
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
} from "@waitron/db/testing/postgres.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "../migrations.js";

export type { RealPostgres };

/**
 * The setup budget a container suite needs, passed to `useRealPostgres`'s `timeoutMs`. It restates
 * vitest.config.ts's own `hookTimeout` (180s) because `useRealPostgres` gives its `beforeAll` no
 * default, and the per-hook argument wins over the config value — so a suite passing nothing would
 * silently drop to vitest's 5s default. Same reasoning as fiscal-verifactu's copy.
 */
export const CONTAINER_SETUP_TIMEOUT_MS = 180_000;

/**
 * Starts a real PostgreSQL server and runs the three migration sets against it, core first — then
 * identity (persons, which workforce's FKs target), then workforce. Ordering across packages is the
 * runtime's responsibility and nothing enforces it, so it is explicit here.
 */
export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired:
      "The workforce RLS suites require a running Docker daemon. They cannot be skipped: PGlite runs " +
      "every connection as a superuser, which bypasses FORCE ROW LEVEL SECURITY and cannot prove " +
      "tenant isolation or the app role's exact privilege set.",
    migrate: (uri) =>
      runMigrationSets(uri, [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS]),
  });
}
