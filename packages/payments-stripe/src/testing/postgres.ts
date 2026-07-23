import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { CORE_MIGRATIONS, createPostgresDb, runMigrations, type Database } from "@waitron/db";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";

export interface RealPostgres {
  /** A fresh Database — its own pool, therefore its own backend process. */
  connect(): Promise<Database>;
  /**
   * A fresh Database authenticated as `role` (which the caller must already have created). Used by
   * RLS tests that need queries to run as a non-superuser member of `app_user` — the container's
   * default user is a superuser and bypasses RLS, so `connect()` cannot exercise a policy.
   */
  connectAs(role: string, password: string): Promise<Database>;
  stop(): Promise<void>;
}

/**
 * Starts a real PostgreSQL server and runs both packages' migrations against it, core first —
 * migration ordering across packages is the runtime's responsibility and nothing enforces it, so
 * the order is explicit here, exactly as `@waitron/db`'s own `CORE_MIGRATIONS`/`PAYMENTS_MIGRATIONS`
 * pairing is documented to require elsewhere in this package (migrations.test.ts).
 *
 * `connect()` returns the container's default (superuser) connection — the payments-stripe RLS suite
 * uses it to SEED rows with RLS bypassed — while `connectAs(role, password)` returns a fresh connection
 * authenticated as a non-superuser role, the only kind that actually exercises the FORCE ROW LEVEL
 * SECURITY policies. A fresh `Database` per call keeps the two on separate backend processes, so the
 * probe's `SET app.tenant_id` can never leak into the seeding connection.
 */
export async function startRealPostgres(): Promise<RealPostgres> {
  let container: StartedPostgreSqlContainer;
  try {
    container = await new PostgreSqlContainer("postgres:18-alpine").start();
  } catch (cause) {
    // Never degrade to a skip. An RLS suite that disappears when Docker is absent reports green
    // while asserting nothing — PGlite's bundled server runs every connection as a superuser, which
    // bypasses FORCE ROW LEVEL SECURITY and table grants outright, so it cannot substitute for this
    // suite's entire subject. packages/db/src/testing/harness.ts's `resolveTargets` takes a softer
    // stance for ITS OWN dual-target suites (warn and continue on PGlite alone, unless
    // `REQUIRE_DOCKER=1`) because most of those still prove something real on PGlite. This one does
    // not — so it has no soft mode to fall back to.
    throw new Error(
      "The payments-stripe RLS suite requires a running Docker daemon. It cannot be skipped: " +
        "PGlite's superuser bypasses row-level security, so it cannot exercise the grants and " +
        "tenant-isolation policies this suite exists to verify (see stripe.rls.test.ts).",
      { cause },
    );
  }

  const uri = container.getConnectionUri();
  const migrator = await createPostgresDb(uri);
  await runMigrations(migrator, CORE_MIGRATIONS);
  await runMigrations(migrator, PAYMENTS_MIGRATIONS);
  await migrator.close();

  return {
    connect: () => createPostgresDb(uri),
    connectAs: (role, password) => {
      const u = new URL(uri);
      u.username = role;
      u.password = password;
      return createPostgresDb(u.toString());
    },
    stop: async () => {
      await container.stop();
    },
  };
}
