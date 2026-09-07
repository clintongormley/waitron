import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { createPostgresDb, type Database } from "@waitron/db";
import { POSTGRES_IMAGE, roleUrl } from "@waitron/db/testing/postgres.js";
import type { StartedNetwork } from "@waitron/db/testing/two-node.js";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { withDatabase } from "@waitron/provisioning";

/**
 * One PostgreSQL node provisioned the shape native logical replication requires: the migrator
 * (`waitron_migrator`) OWNS the database and therefore every migrated table, and the node boots with
 * logical WAL. This is the honest single-node fixture the swap S2 replication-provisioning suite is
 * built on, and the node Task 7's two-node subscription suite starts twice on a shared network.
 *
 * Why the migrator owns the tables: `CREATE PUBLICATION … FOR TABLE` needs the table OWNER (only
 * `FOR ALL TABLES` is superuser, prototype finding 1), and `ALTER DEFAULT PRIVILEGES FOR ROLE
 * waitron_migrator` (§13.3) only reaches objects that role creates. The instance provisioner does not
 * yet migrate as the migrator (Task 8's gap), so this fixture reproduces the prototype's shape by
 * hand: create a plain `login createrole` migrator, hand it the database as OWNER, and run every
 * migration set over a connection authenticated AS that role.
 *
 * `wal_level=logical` and `track_commit_timestamp=on` need a RESTART (`PGC_POSTMASTER`), so they are
 * passed as `postgres -c` args, not `ALTER SYSTEM`. `max_slot_wal_keep_size=4GB` is passed the same
 * way so the readiness bound (spec §6) is satisfied AT BOOT — the pre-bootstrap readiness check must
 * see only the replication-role and `pg_create_subscription` gaps, not a WAL-setting gap. The image
 * entrypoint runs `postgres "$@"` and PostgreSqlContainer's wait is `pg_isready`, not log-based, so
 * custom `-c` flags cannot break startup (same reasoning as db/src/testing/two-node.ts).
 */

const LOGICAL_REPLICATION_COMMAND = [
  "postgres",
  "-c",
  "wal_level=logical",
  "-c",
  "track_commit_timestamp=on",
  "-c",
  "max_slot_wal_keep_size=4GB",
];

/** The migrator's password. A fixture literal — the node is thrown away with the container. */
const MIGRATOR_PASSWORD = "migrator_pw";

export interface ReplicationNode {
  /** The container SUPERUSER — runs the bootstrap (`replicationBootstrapStatements`) and reads. */
  superuser: Database;
  /** `waitron_migrator`, the table OWNER — creates publications and later tables (§13.3). */
  owner: Database;
  /** The container's own superuser URI (host-published), for composing further connections. */
  superuserUri: string;
  /** The Docker-network alias a PEER dials (Task 7). The container hostname when no network is given. */
  networkAlias: string;
  /** The database `waitron_migrator` owns and every table lives in. */
  database: string;
  /** The migrator's password, so Task 7 can build the owner conninfo from these fields. */
  migratorPassword: string;
  stop(): Promise<void>;
}

export interface ReplicationNodeOptions {
  /** Join this shared network so a peer can dial the node by `alias` (Task 7). */
  network?: StartedNetwork;
  /** The network alias to answer to; required to be reachable from a peer. Defaults to `repl-node`. */
  alias?: string;
  /** The owned database name. Defaults to `waitron_repl_node`. */
  database?: string;
}

/**
 * Boot one node, create `waitron_migrator` as OWNER of a fresh database, and migrate the whole
 * manifest as that role so it owns every table. Cleanup, both paths: a failure after the container is
 * up stops it before re-throwing, so a half-built node never leaks (Ryuk is off locally, CLAUDE.md
 * §4; the container carries `com.waitron.reapable` for `pnpm reap`).
 */
export async function startReplicationNode(
  options: ReplicationNodeOptions = {},
): Promise<ReplicationNode> {
  const alias = options.alias ?? "repl-node";
  const database = options.database ?? "waitron_repl_node";

  let builder = new PostgreSqlContainer(POSTGRES_IMAGE)
    // Same reaper marker as startPostgresContainer: an interrupted Ryuk-off run leaves this for
    // `pnpm reap`, which removes ONLY containers carrying this label.
    .withLabels({ "com.waitron.reapable": "true" })
    .withCommand(LOGICAL_REPLICATION_COMMAND);
  if (options.network !== undefined) {
    builder = builder.withNetwork(options.network).withNetworkAliases(alias);
  }
  const container = await builder.start();

  // Everything acquired, in order; teardown reverses it and swallows each failure so one wedged close
  // can never strand the container.stop().
  const opened: Database[] = [];
  const stop = async () => {
    for (const db of [...opened].reverse()) await db.close().catch(() => {});
    await container.stop();
  };

  try {
    const superuserUri = container.getConnectionUri();

    // `CREATE ROLE`/`CREATE DATABASE` need a connection to a database that already exists (the
    // container's default), so they run over a throwaway admin handle closed once the target db is up.
    const admin = await createPostgresDb(superuserUri);
    try {
      // A PLAIN login role, NOT `in role app_user` — app_user is created BY the core migration and
      // does not exist yet. `createrole` + database OWNER is what lets it `CREATE` in `public` under
      // PG15+ and makes it own every migrated table.
      await admin.execute(
        sql.raw(`create role waitron_migrator login createrole password '${MIGRATOR_PASSWORD}'`),
      );
      await admin.execute(sql.raw(`create database ${database} owner waitron_migrator`));
    } finally {
      await admin.close();
    }

    // Migrate over a connection authenticated AS waitron_migrator, so it OWNS every migrated table.
    const migratorUri = roleUrl(
      withDatabase(superuserUri, database),
      "waitron_migrator",
      MIGRATOR_PASSWORD,
    );
    await applyMigrations(migratorUri, migrationOptionsFor(manifestSets(), null));

    // The RETURNED superuser handle connects to the TARGET database, not the container default: the
    // bootstrap mixes cluster-global statements (create role, grant pg_create_subscription, alter
    // system) with SCHEMA-LOCAL ones (`grant select on all tables in schema public`, `alter default
    // privileges … in schema public`). Run from the wrong database the global ones still succeed —
    // readiness would even pass — while the schema-local ones silently land in the default db's
    // `public`, leaving the target's tables uncovered. So the operator must run the whole bootstrap
    // connected to the target database, and this fixture does the same.
    const superuser = await createPostgresDb(withDatabase(superuserUri, database));
    opened.push(superuser);

    const owner = await createPostgresDb(migratorUri);
    opened.push(owner);

    return {
      superuser,
      owner,
      superuserUri,
      networkAlias: alias,
      database,
      migratorPassword: MIGRATOR_PASSWORD,
      stop,
    };
  } catch (error) {
    await stop().catch(() => {});
    throw error;
  }
}
