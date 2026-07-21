import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { CORE_MIGRATIONS, createPostgresDb, runMigrations, type Database } from "@waitron/db";
import { FISCAL_MIGRATIONS } from "../migrations.js";

export interface RealPostgres {
  /** A fresh Database — its own pool, therefore its own backend process. */
  connect(): Promise<Database>;
  stop(): Promise<void>;
}

/**
 * Starts a real PostgreSQL server and runs both packages' migrations against it, core first —
 * migration ordering across packages is the runtime's responsibility and nothing enforces it, so
 * the order is explicit here, exactly as `@waitron/db`'s own `CORE_MIGRATIONS`/`FISCAL_MIGRATIONS`
 * pairing is documented to require elsewhere in this package (migrations.test.ts).
 *
 * `connect()` deliberately returns a NEW `Database` per call rather than handing back one shared
 * pool. Two callers must land on two backend processes for `FOR UPDATE` to have anything to block
 * against; sharing a pool sized below the caller count would silently reduce the concurrency under
 * test. `chain.concurrency.test.ts`'s own first test — "runs its writers on distinct backend
 * processes" — is the load-bearing check that this promise actually holds.
 */
export async function startRealPostgres(): Promise<RealPostgres> {
  let container: StartedPostgreSqlContainer;
  try {
    container = await new PostgreSqlContainer("postgres:18-alpine").start();
  } catch (cause) {
    // Never degrade to a skip. A concurrency suite that disappears when Docker is absent reports
    // green while asserting nothing — the exact failure mode
    // chain.pglite-cannot-test-contention.test.ts documents as unacceptable for this property.
    // packages/db/src/testing/harness.ts's `resolveTargets` takes a softer stance for ITS OWN
    // dual-target suites (warn and continue on PGlite alone, unless `REQUIRE_DOCKER=1`) because
    // most of that package's suites still prove something real on PGlite alone. This suite proves
    // NOTHING on PGlite — that is its entire subject — so it has no soft mode to fall back to.
    throw new Error(
      "The chain-append concurrency suite requires a running Docker daemon. It cannot be " +
        "skipped: PGlite cannot substitute for it (see " +
        "src/chain.pglite-cannot-test-contention.test.ts for why).",
      { cause },
    );
  }

  const uri = container.getConnectionUri();
  const migrator = await createPostgresDb(uri);
  await runMigrations(migrator, CORE_MIGRATIONS);
  await runMigrations(migrator, FISCAL_MIGRATIONS);
  await migrator.close();

  return {
    connect: () => createPostgresDb(uri),
    stop: async () => {
      await container.stop();
    },
  };
}
