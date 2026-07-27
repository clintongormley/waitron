import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresDb, type Database } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "../migrations.js";

export interface RealPostgres {
  uri: string;
  connect(): Promise<Database>;
  /** A fresh Database authenticated as `role`, which the caller must already have created. The
   * container's default user is a superuser and bypasses RLS, so `connect()` cannot exercise a
   * policy. */
  connectAs(role: string, password: string): Promise<Database>;
  stop(): Promise<void>;
}

/** `uri` with its username/password swapped for `role`/`password` — the one place this connection
 * string's shape is assembled, so a future parameter (e.g. `sslmode`) has one call site to change.
 * `connectAs` below is `createPostgresDb(roleUrl(...))`; a caller that needs the connection
 * *string* itself, rather than a live `Database` — e.g. to pass as `DATABASE_URL` to a process it
 * spawns — calls this directly instead of re-deriving the same mutation. */
export function roleUrl(uri: string, role: string, password: string): string {
  const u = new URL(uri);
  u.username = role;
  u.password = password;
  return u.toString();
}

export async function startRealPostgres(): Promise<RealPostgres> {
  let container: StartedPostgreSqlContainer;
  try {
    container = await new PostgreSqlContainer("postgres:18-alpine").start();
  } catch (cause) {
    // Never degrade to a skip. A suite that disappears when Docker is absent reports green while
    // asserting nothing, and PGlite's superuser bypasses FORCE ROW LEVEL SECURITY outright — which
    // is exactly the property this host's capstone exists to test.
    throw new Error(
      "apps/server's real-Postgres suites require a running Docker daemon. They cannot be " +
        "skipped: PGlite runs every connection as a superuser, so it cannot show whether this " +
        "host works as the non-superuser deployment role.",
      { cause },
    );
  }
  const uri = container.getConnectionUri();
  // Guarded: `startRealPostgres` either returns a fully-migrated `RealPostgres` or throws before
  // returning at all — a caller's `pg = await startRealPostgres()` never observes a partially
  // constructed value, so its own `afterAll`'s `if (pg !== undefined)` guard cannot help here. Left
  // unguarded, a throw from `applyMigrations` (which opens and closes its own connection internally
  // — nothing left here for this function to leak) would leave the container running with nothing
  // left to stop it — and with `TESTCONTAINERS_RYUK_DISABLED=true` (mandatory locally, see the
  // project's real-Postgres suites) there is no reaper backstop either.
  try {
    // `applyMigrations` opens and closes its own connection from `uri` — see its own doc comment
    // in `migrations.ts` — so there is no separate migrator `Database` to open or close here.
    await applyMigrations(uri, migrationOptionsFor(manifestSets(), null));
  } catch (error) {
    await container.stop();
    throw error;
  }

  return {
    uri,
    connect: () => createPostgresDb(uri),
    connectAs: (role, password) => createPostgresDb(roleUrl(uri, role, password)),
    stop: async () => {
      await container.stop();
    },
  };
}
