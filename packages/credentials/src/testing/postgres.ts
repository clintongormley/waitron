import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { CORE_MIGRATIONS, createPostgresDb, runMigrations, type Database } from "@waitron/db";
import { CREDENTIALS_MIGRATIONS } from "../migrations.js";

export interface RealPostgres {
  /** A fresh Database — its own pool, therefore its own backend process. */
  connect(): Promise<Database>;
  /** A fresh Database authenticated as `role`, which the caller must already have created. The
   * container's default user is a superuser and bypasses RLS, so `connect()` cannot exercise a
   * policy. */
  connectAs(role: string, password: string): Promise<Database>;
  stop(): Promise<void>;
}

/**
 * Starts a real PostgreSQL server and runs both migration sets against it, core first — ordering
 * across packages is the runtime's responsibility and nothing enforces it, so it is explicit here.
 */
export async function startRealPostgres(): Promise<RealPostgres> {
  let container: StartedPostgreSqlContainer;
  try {
    container = await new PostgreSqlContainer("postgres:18-alpine").start();
  } catch (cause) {
    // Never degrade to a skip. A suite that disappears when Docker is absent reports green while
    // asserting nothing, and PGlite's superuser bypasses FORCE ROW LEVEL SECURITY outright.
    throw new Error(
      "The credentials RLS suite requires a running Docker daemon. It cannot be skipped: PGlite " +
        "runs every connection as a superuser, which bypasses row-level security and cannot " +
        "exercise the SECURITY DEFINER seam this suite exists to verify.",
      { cause },
    );
  }

  const uri = container.getConnectionUri();
  const migrator = await createPostgresDb(uri);
  await runMigrations(migrator, CORE_MIGRATIONS);
  await runMigrations(migrator, CREDENTIALS_MIGRATIONS);
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
