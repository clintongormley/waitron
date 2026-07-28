import { CORE_MIGRATIONS } from "@waitron/db";
import {
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
} from "@waitron/db/testing/postgres.js";
import { SCHEDULER_MIGRATIONS } from "../migrations.js";

export type { RealPostgres };

/**
 * Starts a real PostgreSQL server and runs both migration sets against it, core first — ordering
 * across packages is the runtime's responsibility and nothing enforces it, so it is explicit here.
 */
export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired:
      "The scheduler's real-Postgres suites require a running Docker daemon. They cannot be " +
      "skipped: PGlite runs every connection as a superuser, which bypasses row-level security " +
      "and cannot exercise the concurrent claim races these suites exist to verify.",
    migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, SCHEDULER_MIGRATIONS]),
  });
}
