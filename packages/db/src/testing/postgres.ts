import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresDb, type Database } from "../client.js";
import { runMigrations, type MigrationOptions } from "../migrate.js";

/**
 * The one place any TEST suite in this repo writes down the PostgreSQL image tag.
 * `bench/pglite-throughput/src/bench.ts` still carries its own literal, deliberately: it is a
 * standalone benchmark harness, not a test suite, and pulling this package in to share one string
 * would be a bad trade.
 */
export const POSTGRES_IMAGE = "postgres:18-alpine";

/**
 * The slice of a started container this package's test helpers actually use, and the seam a test
 * fakes.
 *
 * `StartedPostgreSqlContainer` does not satisfy this structurally, on either member: it exposes
 * `getConnectionUri()` rather than a `uri` field, and its `stop()` resolves to a
 * `StoppedTestContainer` (TypeScript's void-return relaxation covers `() => T` against
 * `() => void`, never `Promise<T>` against `Promise<void>`). `startPostgresContainer` therefore
 * adapts the real container rather than handing it back.
 *
 * `uri` is a field, not a getter, because a started container's URI never changes — every caller
 * reads it and holds it. The seam exists so the Docker-absent and failed-migration paths can be
 * proven without a daemon, the same reason `harness.ts` keeps `resolveTargets` pure and separate
 * from `describeEachTarget`.
 */
export interface StartedContainer {
  uri: string;
  stop(): Promise<void>;
}

export interface RealPostgres {
  /** The container's own connection URI, authenticated as its default (superuser) role. */
  uri: string;
  /**
   * A fresh Database — its own pool, therefore its own backend process.
   *
   * A NEW `Database` per call, never one shared pool: two callers must land on two backend
   * processes for `FOR UPDATE` to have anything to block against, and a pool sized below the
   * caller count would silently reduce the concurrency under test.
   * `packages/fiscal-verifactu/src/chain.concurrency.test.ts`'s first test — "runs its writers on
   * distinct backend processes" — is the check that this promise holds downstream.
   *
   * Separate pools also keep session settings on an application connection from leaking into
   * an owner's fixture connection.
   */
  connect(): Promise<Database>;
  /**
   * A fresh Database authenticated as `role`, which the caller must already have created. The
   * container's default user is a superuser, so use connectAs when testing restricted privileges.
   */
  connectAs(role: string, password: string): Promise<Database>;
  stop(): Promise<void>;
}

export interface MigratedPostgresOptions {
  /**
   * Why this suite cannot degrade to a skip, thrown verbatim when the container will not start.
   *
   * Required, never defaulted. Each caller's message explains why THAT suite has no soft mode, and
   * several cite the file that documents the reason; a default would produce a generic message at
   * exactly the moment someone needs the specific one.
   *
   * A caller that needs real PostgreSQL for concurrency or deployment-role behaviour supplies
   * its reason here. The real-container block in `postgres.test.ts` gates on `dockerAvailable()`;
   * the package global setup can still require Docker before that block runs.
   */
  dockerRequired: string;
  /** Applies every migration set this suite needs, core first. */
  migrate(uri: string): Promise<void>;
  /** Seam — see `StartedContainer`. Defaults to a real Testcontainers PostgreSQL. */
  start?(): Promise<StartedContainer>;
}

/**
 * Starts a real PostgreSQL container on `POSTGRES_IMAGE`, adapted to `StartedContainer`.
 *
 * The one place any SHARED test helper here constructs a container: `./harness.ts` calls this for
 * its own dual-target suites rather than reaching for `PostgreSqlContainer` itself. The two have
 * different lifecycles — one container per suite with a fresh database per test, versus one
 * connect-migrate-stop — but only one way to start one.
 *
 * `client.test.ts` and `migrate.test.ts` still construct their own directly. They are testing
 * `createPostgresDb` and `runMigrations` against a bare server, so routing them through a helper
 * built on top of both would make each suite depend on the thing it exists to check.
 */
export async function startPostgresContainer(): Promise<StartedContainer> {
  // `com.waitron.reapable` is the marker the stale-container reaper (scripts/reap-testcontainers.mjs)
  // filters on: with `TESTCONTAINERS_RYUK_DISABLED=true` (CLAUDE.md §4) an interrupted run leaves this
  // container un-reaped, and the reaper removes ONLY containers carrying this label — never the generic
  // `org.testcontainers` label, which is on every project's containers including live ones. This string
  // must match the reaper's `--filter label=…`; postgres.test.ts pins that it does.
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withLabels({ "com.waitron.reapable": "true" })
    .start();
  return {
    uri: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}

/**
 * `uri` with its username/password swapped for `role`/`password` — the one place this connection
 * string's shape is assembled, so a future parameter (e.g. `sslmode`) has one call site to change.
 *
 * `connectAs` is `createPostgresDb(roleUrl(...))`; a caller that needs the connection *string*
 * itself, rather than a live `Database` — e.g. to pass as `DATABASE_URL` to a process it spawns —
 * calls this directly instead of re-deriving the same mutation.
 */
export function roleUrl(uri: string, role: string, password: string): string {
  const u = new URL(uri);
  u.username = role;
  u.password = password;
  return u.toString();
}

/**
 * `uri` with its database (the URL path) swapped for `database`, credentials and host untouched —
 * the sibling of {@link roleUrl}, and the one place a caller that must reach a DIFFERENT database
 * on the same cluster assembles that string. The shared-container helpers use it twice:
 * `startSharedContainer` migrates each template into its own database, and `useTemplateDb` clones
 * one per suite, so both derive a per-database URI from the container's admin URI through here
 * rather than re-deriving the same mutation.
 */
export function databaseUrl(uri: string, database: string): string {
  const u = new URL(uri);
  u.pathname = `/${database}`;
  return u.toString();
}

/**
 * Runs `sets` in order over one throwaway connection, closing it whether or not a set throws.
 *
 * Ordering across packages is the runtime's responsibility and nothing enforces it, so callers pass
 * the order explicitly — core first, since it carries `tenants` and every other set has a foreign
 * key to it. Closing the connection either way is not decoration: the five copies this replaces
 * closed their migrator only on success, so a failing migration leaked a pool as well as a
 * container.
 *
 * The close is best-effort only on the failure path — mirroring `startMigratedPostgres`'s stop: if
 * a set throws and `close()` then also rejects, the close failure must not replace the migration
 * error the caller needs to see. On the success path nothing is competing to be reported, so a
 * `close()` failure there is the only thing left to surface and propagates normally.
 */
export async function runMigrationSets(
  uri: string,
  sets: readonly MigrationOptions[],
): Promise<void> {
  const migrator = await createPostgresDb(uri);
  try {
    for (const set of sets) await runMigrations(migrator, set);
  } catch (error) {
    // Best-effort: a rejecting close() must not replace the migration error the caller needs to see.
    await migrator.close().catch(() => {});
    throw error;
  }
  await migrator.close();
}

/**
 * Starts a PostgreSQL container, migrates it, and returns the connections a suite needs.
 *
 * Either returns a fully-migrated `RealPostgres` or throws having already stopped the container: a
 * caller's `pg = await startRealPostgres()` never observes a partially constructed value, so its
 * own `afterAll`'s `if (pg !== undefined)` guard cannot help here. Left unguarded, a throw from
 * `migrate` would leave the container running with nothing left to stop it — and with
 * `TESTCONTAINERS_RYUK_DISABLED=true` (mandatory for this repo's local runs) there is no reaper
 * backstop either.
 */
export async function startMigratedPostgres(
  options: MigratedPostgresOptions,
): Promise<RealPostgres> {
  const start = options.start ?? startPostgresContainer;
  let container: StartedContainer;
  try {
    container = await start();
  } catch (cause) {
    // Never degrade to a skip. A suite that disappears when Docker is absent reports green while
    // asserting nothing, and PGlite's superuser bypasses FORCE ROW LEVEL SECURITY outright.
    throw new Error(options.dockerRequired, { cause });
  }

  const uri = container.uri;
  try {
    await options.migrate(uri);
  } catch (error) {
    // Best-effort: a rejecting stop() (wedged daemon, container already gone) must never replace
    // the migration error that actually caused this — that error is why the caller's suite fails,
    // and it is what "propagates the original error" below asserts.
    await container.stop().catch(() => {});
    throw error;
  }

  return {
    uri,
    connect: () => createPostgresDb(uri),
    connectAs: (role, password) => createPostgresDb(roleUrl(uri, role, password)),
    stop: () => container.stop(),
  };
}
