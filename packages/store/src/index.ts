import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { archiveTo } from "./archive.js";
import { type CommitListener, type Connections, connectionPair } from "./connections.js";
import { drizzleNodeSqlite, type NodeSqliteDatabase } from "./node-sqlite-adapter.js";
import { closeQuietly, isLocked, lockVenueDirectory, type VenueLock } from "./venue-lock.js";
import { watchdogStopped } from "./venue-liveness.js";

export { installAppendOnlyTriggers } from "./append-only.js";
export type { StatementTarget } from "./append-only.js";
export { archiveTo } from "./archive.js";
export type { CommitListener } from "./connections.js";
export { drizzleNodeSqlite } from "./node-sqlite-adapter.js";
export type { NodeSqliteDatabase, RawResult } from "./node-sqlite-adapter.js";
export { isLocked, lockVenueDirectory, VENUE_LOCK_FILE, VenueInUseError } from "./venue-lock.js";
export type { VenueLock } from "./venue-lock.js";
export {
  isVenueHolderFresh,
  readVenueHolder,
  readVenueHolderAsync,
  VENUE_HOLDER_KINDS,
} from "./venue-holder.js";
export type { VenueHolder, VenueHolderKind } from "./venue-holder.js";
export {
  setVenueCrashReportDirectory,
  setVenueHolderKind,
  setVenueWatchdogLogFile,
} from "./venue-liveness.js";
import { createWriteQueue } from "./write-queue.js";

const VENUE_FILE = "venue.db";
const NODE_FILE = "node.db";

export interface VenueStoreConfig<
  TVenueSchema extends Record<string, unknown>,
  TNodeSchema extends Record<string, unknown>,
> {
  /** Where the two files live. Created if it does not exist. */
  directory: string;
  venueSchema: TVenueSchema;
  nodeSchema: TNodeSchema;
  /**
   * Whether this open holds the venue folder against other processes (`./venue-lock.ts`). True
   * unless set to false. False is for a short-lived tool documented to run beside a running
   * server: it takes no lock, so it neither refuses nor is refused.
   */
  exclusive?: boolean;
}

/**
 * `withWriteLock` is per file because the thing it protects is per file — the one WRITE connection.
 * One queue across both files would make a write to one file wait behind a transaction on the
 * other, and would refuse a node write nested inside a venue transaction as re-entering the lock
 * (`./write-queue.ts`).
 */
export type StoreHandle<TSchema extends Record<string, unknown>> = NodeSqliteDatabase<TSchema> & {
  /** Runs `body` as the only write transaction on this file at that moment. */
  withWriteLock: <T>(body: () => Promise<T>) => Promise<T>;
  /**
   * Copies this whole file to `path`. Not callable from inside {@link StoreHandle.withWriteLock} —
   * the engine refuses the copy while a transaction is open on the connection (`./archive.ts`).
   */
  archiveTo: (path: string) => Promise<void>;
  /**
   * Folds this file's write-ahead side file back into it and truncates the side file to nothing.
   * `reclaimed` is false when another connection was still reading it; nothing waits in that case,
   * and the caller tries again later. Not callable from inside {@link StoreHandle.withWriteLock};
   * it waits for those transactions but not for one opened with `transaction()`, and rejects
   * `database table is locked` while one of those is open.
   */
  checkpointTruncate: () => Promise<{ reclaimed: boolean }>;
  /**
   * Registers `listener` for every commit on this file that changed at least one row and changed
   * the write-ahead side file since the last commit reported, `checkpointTruncate`, or the first
   * listener's registration; returns the unsubscribe. A write transaction that began while no
   * listener was registered is not reported to anyone. A commit that only changed the schema is
   * not reported, nor one made by issuing `begin` and `commit` as statements, as Drizzle's migrator
   * does. One that set rows to the values they held is not reported either, except straight after
   * a schema-only commit.
   * `Connections.reportIfChanged` in `./connections.ts` has what the side-file comparison can miss.
   */
  onCommit: (listener: CommitListener) => () => void;
  /** Closes both of this file's connections. {@link VenueStore.close} closes both files. */
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
  /** Copies the VENUE file to `path`, and not the node file. */
  archiveTo: (path: string) => Promise<void>;
  close: () => Promise<void>;
}

/** How long a statement blocked on another connection waits, and how long the switch below retries. */
const BUSY_TIMEOUT_MS = 5000;

const WAL_RETRY_INTERVAL_MS = 25;

/**
 * Switches the file into write-ahead mode, waiting out whoever else holds it. `busy_timeout` is no
 * substitute: under a held write, switching a file not yet in write-ahead mode was refused at once
 * with `busy_timeout` at 5000 (measured on Node v26.7.0 against `node:sqlite`). The wait is pinned
 * by `openVenueStore under contention` in `./index.test.ts`.
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
 * `busy_timeout` is set FIRST because a statement issued before it has none. `foreign_keys` is
 * stated rather than inherited: this driver happens to enable it, where the SQLite library it wraps
 * defaults it off, and without it every `REFERENCES` clause in the schema is decoration.
 *
 * `recursive_triggers` is what makes append-only enforcement whole: the delete that
 * `INSERT OR REPLACE` performs internally fires a `BEFORE DELETE` trigger only with this on, and
 * SQLite's default is off (`./append-only.ts`).
 *
 * Automatic checkpointing stays at SQLite's own default: every 1000 pages, and always PASSIVE, which
 * never invokes the busy handler (https://www.sqlite.org/pragma.html), so it never waits on
 * Litestream. With streaming off nothing else checkpoints, so switching it off would let the
 * write-ahead file grow without limit. Slice-2 spec §4.5
 * (docs/superpowers/specs/2026-09-23-sqlite-slice2-stream-and-cold-restore-design.md).
 */
async function openConnection(path: string): Promise<DatabaseSync> {
  const connection = new DatabaseSync(path);
  try {
    connection.exec(`pragma busy_timeout = ${BUSY_TIMEOUT_MS}`);
    await enterWriteAheadMode(connection);
    // Connection settings rather than file operations, so no lock stands between these and success.
    connection.exec("pragma foreign_keys = on");
    connection.exec("pragma recursive_triggers = on");
  } catch (error) {
    // A file whose bytes are not a database is first refused by the switch into write-ahead mode,
    // with the handle already open; a boot that retries would keep a descriptor per attempt.
    closeQuietly(connection);
    throw error;
  }
  return connection;
}

/**
 * Opens the read-only connection that runs beside a file's writer.
 *
 * **A misrouted write is refused here**, errcode 8 with nothing written, and
 * `./node-sqlite-adapter.ts` then sends it to the writer instead.
 *
 * **What it refuses is a write to the database FILE, which is narrower than "a write".** A
 * statement that changes the CONNECTION instead — `create temp table`, an `ATTACH` of a file that
 * exists, a connection-scoped pragma — succeeds here, so it lands on this connection and stays
 * there rather than being routed back.
 *
 * `foreign_keys` and `recursive_triggers` are not set here because both govern writes to the
 * database file, which this connection cannot make.
 */
function openReadConnection(path: string): DatabaseSync {
  const connection = new DatabaseSync(path, { readOnly: true });
  connection.exec(`pragma busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return connection;
}

/**
 * Opens this node's two database files.
 *
 * **Two Drizzle instances, one per file**: a Drizzle SQLite table cannot name a table in an
 * `ATTACH`ed file, because it quotes `node.sessions` as one identifier. An `ATTACH` issued THROUGH
 * THE HANDLE lands on whichever connection the routing picks at that instant, so an attachment
 * belongs on a connection a caller holds itself.
 *
 * **The schemas arrive as arguments rather than as imports.** This package imports nothing from
 * the workspace, because `@waitron/db` imports it; `scripts/workspace-cycles.test.ts` fails on the
 * loop an import back would close.
 *
 * **Two connections per file, and one Drizzle instance over the pair**, so that while
 * `withWriteLock` holds a transaction open, a read whose asynchronous context began outside the
 * body sees committed rows only (`./connections.ts`).
 */
export async function openVenueStore<
  TVenueSchema extends Record<string, unknown>,
  TNodeSchema extends Record<string, unknown>,
>(
  config: VenueStoreConfig<TVenueSchema, TNodeSchema>,
): Promise<VenueStore<TVenueSchema, TNodeSchema>> {
  await mkdir(config.directory, { recursive: true });
  // Before either file is opened, so a refused open leaves the databases untouched.
  const lock: VenueLock =
    config.exclusive === false ? { release: () => {} } : await lockVenueDirectory(config.directory);
  // Whatever is open when an open FAILS has to be closed, or a boot that retries keeps a descriptor
  // per attempt.
  const standing: DatabaseSync[] = [];
  const openBoth = async (path: string): Promise<Connections> => {
    // The writer first: it is what creates a fresh file and converts it into write-ahead mode, and
    // a read-only connection can do neither.
    const write = await openConnection(path);
    standing.push(write);
    const read = openReadConnection(path);
    standing.push(read);
    return connectionPair(write, read);
  };
  let venueFile: Connections;
  let nodeFile: Connections;
  try {
    venueFile = await openBoth(join(config.directory, VENUE_FILE));
    nodeFile = await openBoth(join(config.directory, NODE_FILE));
  } catch (error) {
    // The refusal is what the caller needs to see, never a failure from closing up after it.
    for (const connection of standing) closeQuietly(connection);
    lock.release();
    await watchdogStopped();
    throw error;
  }
  const handle = <TSchema extends Record<string, unknown>>(
    connections: Connections,
    schema: TSchema,
  ): StoreHandle<TSchema> => {
    const writes = createWriteQueue(connections);
    const db = drizzleNodeSqlite(connections, { schema });
    let closed = false;
    return Object.assign(db, {
      withWriteLock: <T>(body: () => Promise<T>) => writes.run(body),
      archiveTo: (path: string) => archiveTo(db, path),
      onCommit: (listener: CommitListener) => connections.onCommit(listener),
      // With the store's busy wait the checkpoint blocks on the busy handler, and on this
      // synchronous engine the whole process blocks with it.
      checkpointTruncate: () =>
        writes.exclusive(() => {
          connections.write.exec("pragma busy_timeout = 0");
          try {
            const row = connections.write.prepare("pragma wal_checkpoint(truncate)").get() as {
              busy: number;
            };
            connections.sideFileReset();
            return { reclaimed: row.busy === 0 };
          } finally {
            connections.write.exec(`pragma busy_timeout = ${BUSY_TIMEOUT_MS}`);
          }
        }),
      // Idempotent: `node:sqlite` throws "database is not open" on a second close, and a caller
      // that closed one file still has to be able to close the store.
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          connections.read.close();
        } finally {
          connections.write.close();
        }
      },
    });
  };
  const venue = handle(venueFile, config.venueSchema);
  const node = handle(nodeFile, config.nodeSchema);
  return {
    venue,
    node,
    withWriteLock: venue.withWriteLock,
    archiveTo: venue.archiveTo,
    close: async () => {
      try {
        await venue.close();
        await node.close();
      } finally {
        lock.release();
        await watchdogStopped();
      }
    },
  };
}
