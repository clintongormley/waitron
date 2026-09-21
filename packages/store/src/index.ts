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

/** How long a statement blocked on another connection waits, and how long the switch below retries. */
const BUSY_TIMEOUT_MS = 5000;

/** Gap between attempts at the switch into write-ahead mode. */
const WAL_RETRY_INTERVAL_MS = 25;

/**
 * SQLite's `SQLITE_BUSY`, which `node:sqlite` puts on the thrown error's `errcode`. The driver
 * throws an `Error` carrying that property; a refusal for any other reason — a file that is not a
 * database reads 26 — is not something waiting can fix.
 */
const SQLITE_BUSY = 5;

const isLocked = (error: unknown): boolean =>
  (error as { errcode?: number }).errcode === SQLITE_BUSY;

/**
 * Switches the file into write-ahead mode, waiting out whoever else holds it.
 *
 * The retry is the invariant, and `busy_timeout` is no substitute for it: converting a file into
 * write-ahead mode needs an exclusive lock, and that is the one lock SQLite takes without
 * consulting the busy handler, so the pragma is refused at once however long the timeout is. The
 * reading is in `./index.test.ts` under `openVenueStore under contention`, which fails without
 * this loop.
 *
 * Only a file not already in write-ahead mode is exposed, which is a fresh venue directory: against
 * a file already converted the pragma is a no-op that succeeds even under a held write transaction.
 */
async function enterWriteAheadMode(connection: DatabaseSync): Promise<void> {
  const deadline = Date.now() + BUSY_TIMEOUT_MS;
  for (;;) {
    try {
      connection.exec("pragma journal_mode = wal");
      return;
    } catch (error) {
      if (!isLocked(error) || Date.now() >= deadline) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, WAL_RETRY_INTERVAL_MS));
  }
}

/**
 * Opens a connection with the settings the engine needs.
 *
 * `busy_timeout` is set FIRST because a statement issued before it has none. Write-ahead mode lets
 * a reader run while the writer works, and `busy_timeout` makes a blocked statement wait rather
 * than fail at once — every statement but the switch into write-ahead mode itself, which is why
 * {@link enterWriteAheadMode} exists. `foreign_keys` is stated rather than inherited: this
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
async function openConnection(path: string): Promise<DatabaseSync> {
  const connection = new DatabaseSync(path);
  connection.exec(`pragma busy_timeout = ${BUSY_TIMEOUT_MS}`);
  await enterWriteAheadMode(connection);
  // Connection settings rather than file operations, so no lock stands between these and success.
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
  const venueConnection = await openConnection(join(config.directory, VENUE_FILE));
  const nodeConnection = await openConnection(join(config.directory, NODE_FILE));
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
