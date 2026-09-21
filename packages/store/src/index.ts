import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzleNodeSqlite, type NodeSqliteDatabase } from "./node-sqlite-adapter.js";
import { createWriteQueue } from "./write-queue.js";

/** The two database files, named after what each holds. */
const VENUE_FILE = "venue.db";
const NODE_FILE = "node.db";

export interface VenueStoreConfig<
  TVenueSchema extends Record<string, unknown>,
  TNodeSchema extends Record<string, unknown>,
> {
  /** Where the two files live. Created if it does not exist. */
  directory: string;
  /** Every table classified `ledger` or `state`. */
  venueSchema: TVenueSchema;
  /** Every table classified `local`: this node's identity, sessions, pairing codes, keys. */
  nodeSchema: TNodeSchema;
}

export interface VenueStore<
  TVenueSchema extends Record<string, unknown>,
  TNodeSchema extends Record<string, unknown>,
> {
  venue: NodeSqliteDatabase<TVenueSchema>;
  node: NodeSqliteDatabase<TNodeSchema>;
  /** Runs `body` as the only write transaction on the venue file at that moment. */
  withWriteLock: <T>(body: () => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
}

/**
 * Opens a connection with the settings the engine needs.
 *
 * Write-ahead mode lets a reader run while the writer works, and `busy_timeout` makes a blocked
 * statement wait rather than fail at once. `foreign_keys` is stated rather than inherited: this
 * driver happens to enable it (`node:sqlite` on Node v26.7.0 reads 1 without the pragma, and 0
 * when opened with `enableForeignKeyConstraints: false`), where the SQLite library it wraps
 * defaults it off, and without it every `REFERENCES` clause in the schema is decoration.
 *
 * Automatic checkpointing stays at SQLite's own default. The topology design
 * (`docs/superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md` §8.3) sets
 * `wal_autocheckpoint = 0`, which is right only once Litestream does the checkpointing instead —
 * and Litestream arrives in slice 2. Turning it off here, with nothing else checkpointing, would
 * let the write-ahead file grow without limit from day one.
 */
function openConnection(path: string): DatabaseSync {
  const connection = new DatabaseSync(path);
  connection.exec("pragma journal_mode = wal");
  connection.exec("pragma busy_timeout = 5000");
  connection.exec("pragma foreign_keys = on");
  return connection;
}

/**
 * Opens this node's two database files.
 *
 * **Two Drizzle instances, one per file, and one instance cannot serve both.** A Drizzle SQLite
 * table definition cannot name a table in an `ATTACH`ed file. Measured 2026-09-21 against a table
 * declared as `node.sessions`: Drizzle emits `select "id", "token" from "node.sessions"`, quoting
 * the whole string as one identifier, and SQLite answers `no such table: node.sessions` even with
 * the second file attached as `node` and the table created in it. Control in the other direction,
 * same connection: an ordinary table name selects normally. `ATTACH` is still available on either
 * connection for hand-written SQL that genuinely needs both files at once.
 *
 * **The schemas arrive as arguments rather than as imports.** This package imports nothing from
 * the workspace, because `@waitron/db` is what will import it; `scripts/workspace-cycles.test.ts`
 * fails on the loop an import back would close.
 *
 * One connection and one Drizzle instance per file, so a read taken while `withWriteLock` holds a
 * transaction open is a read on the writer's own connection and sees that transaction's
 * uncommitted rows — including rows a rollback then removes. Measured 2026-09-21, with a second
 * connection to the same file as the control; the commit message carries both readings. This
 * differs from PostgreSQL, where the pool handed such a reader a committed snapshot.
 */
export async function openVenueStore<
  TVenueSchema extends Record<string, unknown>,
  TNodeSchema extends Record<string, unknown>,
>(
  config: VenueStoreConfig<TVenueSchema, TNodeSchema>,
): Promise<VenueStore<TVenueSchema, TNodeSchema>> {
  await mkdir(config.directory, { recursive: true });
  const venueConnection = openConnection(join(config.directory, VENUE_FILE));
  const nodeConnection = openConnection(join(config.directory, NODE_FILE));
  // The lock is over the venue file, where every transactional business write lands. The node
  // file's connection has no queue yet; the transaction helper that needs one is step group 5.
  const writes = createWriteQueue(venueConnection);
  return {
    venue: drizzleNodeSqlite(venueConnection, { schema: config.venueSchema }),
    node: drizzleNodeSqlite(nodeConnection, { schema: config.nodeSchema }),
    withWriteLock: (body) => writes.run(body),
    close: async () => {
      venueConnection.close();
      nodeConnection.close();
    },
  };
}
