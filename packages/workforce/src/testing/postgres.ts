import { CORE_MIGRATIONS } from "@waitron/db";
import {
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
} from "@waitron/db/testing/postgres.js";
import { WORKFORCE_MIGRATIONS } from "../migrations.js";

export type { RealPostgres };

/**
 * Starts a real PostgreSQL server and runs both migration sets against it, core first — ordering
 * across packages is the runtime's responsibility and nothing enforces it, so it is explicit here.
 */
export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired:
      "The persons RLS suite requires a running Docker daemon. It cannot be skipped: PGlite runs " +
      "every connection as a superuser, which bypasses FORCE ROW LEVEL SECURITY and cannot prove " +
      "tenant isolation or the app role's exact privilege set.",
    migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS]),
  });
}
