import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { archiveTo } from "./archive.js";
import { drizzleNodeSqlite, type NodeSqliteDatabase } from "./node-sqlite-adapter.js";

export { installAppendOnlyTriggers } from "./append-only.js";
export type { StatementTarget } from "./append-only.js";
export { archiveTo } from "./archive.js";
export { drizzleNodeSqlite } from "./node-sqlite-adapter.js";
export type { NodeSqliteDatabase, RawResult } from "./node-sqlite-adapter.js";
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

/**
 * One file's handle: Drizzle over that connection, plus the two things a caller needs that are
 * properties of the FILE rather than of a query.
 *
 * `withWriteLock` is per file because the thing it protects is per file — one connection, which
 * SQLite will not let two transactions share. One queue across both files would also be correct
 * for safety and wrong for throughput: a node write (a session, a pairing code) would wait behind
 * a venue transaction it can never conflict with, and a node write nested inside a venue
 * transaction would deadlock outright.
 */
export type StoreHandle<TSchema extends Record<string, unknown>> = NodeSqliteDatabase<TSchema> & {
  /** Runs `body` as the only write transaction on this file at that moment. */
  withWriteLock: <T>(body: () => Promise<T>) => Promise<T>;
  /**
   * Copies this whole file to `path`. Not callable from inside {@link StoreHandle.withWriteLock} —
   * the engine refuses the copy while a transaction is open on the connection (`./archive.ts`).
   */
  archiveTo: (path: string) => Promise<void>;
  /** Closes this file's connection. {@link VenueStore.close} closes both. */
  close: () => Promise<void>;
};

export interface VenueStore<
  TVenueSchema extends Record<string, unknown>,
  TNodeSchema extends Record<string, unknown>,
> {
  venue: StoreHandle<TVenueSchema>;
  node: StoreHandle<TNodeSchema>;
  /** Runs `body` as the only write transaction on the venue file at that moment. */
  withWriteLock: <T>(body: () => Promise<T>) => Promise<T>;
  /** Copies the VENUE file to `path`; the node file carries only this box's own local rows. */
  archiveTo: (path: string) => Promise<void>;
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
 * `recursive_triggers` is what makes append-only enforcement whole: the delete that
 * `INSERT OR REPLACE` performs internally fires a `BEFORE DELETE` trigger only with this on, and
 * SQLite's default is off, so without it a ledger row is silently rewritten by that one statement
 * while the other three mutation shapes are still refused. `./append-only.ts` carries the detail.
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
  connection.exec("pragma recursive_triggers = on");
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
  const handle = <TSchema extends Record<string, unknown>>(
    connection: DatabaseSync,
    schema: TSchema,
  ): StoreHandle<TSchema> => {
    const writes = createWriteQueue(connection);
    const db = drizzleNodeSqlite(connection, { schema });
    let closed = false;
    return Object.assign(db, {
      withWriteLock: <T>(body: () => Promise<T>) => writes.run(body),
      archiveTo: (path: string) => archiveTo(db, path),
      // Idempotent: `node:sqlite` throws "database is not open" on a second close, and a caller
      // that closed one file still has to be able to close the store.
      close: async () => {
        if (closed) return;
        closed = true;
        connection.close();
      },
    });
  };
  const venue = handle(venueConnection, config.venueSchema);
  const node = handle(nodeConnection, config.nodeSchema);
  return {
    venue,
    node,
    withWriteLock: venue.withWriteLock,
    archiveTo: venue.archiveTo,
    close: async () => {
      await venue.close();
      await node.close();
    },
  };
}
