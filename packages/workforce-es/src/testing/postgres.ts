import { CORE_MIGRATIONS } from "@waitron/db";
import {
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
} from "@waitron/db/testing/postgres.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "@waitron/workforce";
import { WORKFORCE_ES_MIGRATIONS } from "../migrations.js";

export type { RealPostgres };

/**
 * The setup budget a container suite needs, passed to `useRealPostgres`'s `timeoutMs`. It restates
 * vitest.config.ts's own `hookTimeout` (180s) because `useRealPostgres` gives its `beforeAll` no
 * default, and the per-hook argument wins over the config value — so a suite passing nothing would
 * silently drop to vitest's 5s default. Same reasoning as workforce's copy.
 */
export const CONTAINER_SETUP_TIMEOUT_MS = 180_000;

/**
 * Starts a real PostgreSQL server and runs the four migration sets against it, core first — ordering
 * across packages is the runtime's responsibility and nothing enforces it, so it is explicit here.
 * The `convenio_config` table's FKs reach only core (tenants/locations), and the sole real-PG suite,
 * `convenio-config.rls.test.ts`, seeds only a tenant and a location — never a workforce row. The
 * identity + workforce sets are applied because the workforce-es PACKAGE depends on `@waitron/workforce`
 * (this file and `convenio.ts` import from it) and workforce's own FKs target identity's `persons`, so
 * the helper migrates workforce-es's full package stack rather than a core-plus-`convenio_config` subset.
 */
export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired:
      "The convenio_config RLS suite requires a running Docker daemon. It cannot be skipped: PGlite " +
      "runs every connection as a superuser, which bypasses FORCE ROW LEVEL SECURITY and cannot " +
      "prove tenant isolation or the app role's exact privilege set.",
    migrate: (uri) =>
      runMigrationSets(uri, [
        CORE_MIGRATIONS,
        IDENTITY_MIGRATIONS,
        WORKFORCE_MIGRATIONS,
        WORKFORCE_ES_MIGRATIONS,
      ]),
  });
}
