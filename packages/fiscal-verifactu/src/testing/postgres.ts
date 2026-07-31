import { CORE_MIGRATIONS } from "@waitron/db";
import {
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
} from "@waitron/db/testing/postgres.js";
import { FISCAL_MIGRATIONS } from "../migrations.js";

export type { RealPostgres };

/**
 * The setup budget a container suite needs, passed to `useRealPostgres`'s `timeoutMs`.
 *
 * It restates `vitest.config.ts`'s own `hookTimeout` (180s, chosen there for a container cold pull
 * on a slow CI runner) because `useRealPostgres` gives the `beforeAll` it registers an explicit
 * 60s default, and the per-hook argument wins over the config value — so a suite that passed
 * nothing would silently drop from 180s to 60s.
 *
 * The experiment behind that "wins over": a scratch suite in this package, under this config, with
 * `beforeAll(async () => { await sleep(300); }, 50)` — it failed after 54ms with vitest's
 * hook-timeout error, not after the config's 180s.
 */
export const CONTAINER_SETUP_TIMEOUT_MS = 180_000;

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
