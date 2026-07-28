import { CORE_MIGRATIONS } from "@waitron/db";
import {
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
} from "@waitron/db/testing/postgres.js";
import { FISCAL_MIGRATIONS } from "../migrations.js";

export type { RealPostgres };

/**
 * Starts a real PostgreSQL server and runs both packages' migrations against it, core first —
 * migration ordering across packages is the runtime's responsibility and nothing enforces it, so
 * the order is explicit here, exactly as `@waitron/db`'s own `CORE_MIGRATIONS`/`FISCAL_MIGRATIONS`
 * pairing is documented to require elsewhere in this package (migrations.test.ts).
 */
export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired:
      "The chain-append concurrency suite requires a running Docker daemon. It cannot be " +
      "skipped: PGlite cannot substitute for it (see " +
      "src/chain.pglite-cannot-test-contention.test.ts for why).",
    migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, FISCAL_MIGRATIONS]),
  });
}
