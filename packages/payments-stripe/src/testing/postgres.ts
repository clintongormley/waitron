import { CORE_MIGRATIONS } from "@waitron/db";
import {
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
} from "@waitron/db/testing/postgres.js";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";

export type { RealPostgres };

/**
 * Starts a real PostgreSQL server and runs both packages' migrations against it, core first —
 * migration ordering across packages is the runtime's responsibility and nothing enforces it, so
 * the order is explicit here, exactly as `@waitron/db`'s own `CORE_MIGRATIONS`/`PAYMENTS_MIGRATIONS`
 * pairing is documented to require elsewhere in this package (migrations.test.ts).
 */
export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired:
      "The payments-stripe RLS suite requires a running Docker daemon. It cannot be skipped: " +
      "PGlite's superuser bypasses row-level security, so it cannot exercise the grants and " +
      "tenant-isolation policies this suite exists to verify (see stripe.rls.test.ts).",
    migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS]),
  });
}
