import { CORE_MIGRATIONS } from "@waitron/db";
import {
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
} from "@waitron/db/testing/postgres.js";
import { CREDENTIALS_MIGRATIONS } from "../migrations.js";

export type { RealPostgres };

/**
 * Starts a real PostgreSQL server and runs both migration sets against it, core first — ordering
 * across packages is the runtime's responsibility and nothing enforces it, so it is explicit here.
 */
export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired:
      "The credentials RLS suite requires a running Docker daemon. It cannot be skipped: PGlite " +
      "runs every connection as a superuser, which bypasses row-level security and cannot " +
      "exercise the SECURITY DEFINER seam this suite exists to verify.",
    migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS]),
  });
}
