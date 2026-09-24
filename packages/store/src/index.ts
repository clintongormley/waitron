import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { archiveTo } from "./archive.js";
import { type Connections, connectionPair } from "./connections.js";
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
  /** The schema Drizzle maps over the venue file. */
  venueSchema: TVenueSchema;
  /** The schema Drizzle maps over the node file. */
  nodeSchema: TNodeSchema;
}

/**
 * One file's handle: Drizzle over that file's connections, plus the two things a caller needs that
 * are properties of the FILE rather than of a query.
 *
 * `withWriteLock` is per file because the thing it protects is per file — the one WRITE connection,
 * which SQLite will not let two transactions share. One queue across both files would also be correct
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

/** Closes a connection where the failure being handled is the one the caller has to see. */
const closeQuietly = (connection: DatabaseSync): void => {
  try {
    connection.close();
  } catch {
    // Already closed, or closing is what failed; either way the original error is the useful one.
  }
};

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
  try {
    connection.exec(`pragma busy_timeout = ${BUSY_TIMEOUT_MS}`);
    await enterWriteAheadMode(connection);
    // Connection settings rather than file operations, so no lock stands between these and success.
    connection.exec("pragma foreign_keys = on");
    connection.exec("pragma recursive_triggers = on");
  } catch (error) {
    // The constructor and `busy_timeout` both succeed on a file whose bytes are not a database —
    // the refusal comes later, from the switch into write-ahead mode, with the handle still open.
    // Without this the caller's failure keeps a descriptor, and a boot that retries keeps one per
    // attempt.
    closeQuietly(connection);
    throw error;
  }
  return connection;
}

/**
 * Opens the read-only connection that runs beside a file's writer.
 *
 * No switch into write-ahead mode. The write connection has already made it, so the pragma would
 * be a no-op here — measured 2026-09-23 on Node v26.7.0, and it is a no-op that SUCCEEDS on a
 * read-only connection, returning `wal`. What that connection cannot do is the conversion itself:
 * the same pragma on a file still in rollback-journal mode is refused errcode 8, measured the same
 * day, which is why the writer is opened first.
 *
 * It opens on a file with neither sidecar present and reads tables the write connection creates
 * afterwards — measured the same day. `readOnly: true` does not stop it CREATING those sidecars:
 * measured 2026-09-23 on Node v26.7.0, a writer made a write-ahead database and closed (which
 * removed both), and a lone `new DatabaseSync(path, { readOnly: true })` reading `sqlite_master`
 * brought `-wal` and `-shm` back. The control in the other direction names what the constraint
 * really is — the DIRECTORY's permissions, not this flag: with the directory at 0555 that same
 * read is refused errcode 1544, `SQLITE_READONLY_DIRECTORY`. A directory in that state never
 * reaches this connection, because the WRITER opened just before it is refused 1544 as well, at
 * its own switch into write-ahead mode — measured the same day.
 *
 * `./index.test.ts` runs a read through this connection with the write lock held, as a smoke
 * test; that case records what it does not establish.
 *
 * `foreign_keys` and `recursive_triggers` are not set here because both govern writes, which this
 * connection cannot make. `busy_timeout` is, rather than left at the driver's default of 0
 * (measured the same day on a bare `new DatabaseSync(":memory:")`), so a read that does meet a
 * lock waits rather than failing at once. Whether a reader in write-ahead mode meets one at all
 * was not measured.
 *
 * **Read-only is what makes a misrouted write loud.** On a second read-WRITE connection such a
 * statement would commit quietly, outside the queue and outside whatever transaction is open; here
 * it is refused errcode 8 with nothing written, which `./node-sqlite-adapter.ts` then sends to the
 * writer instead.
 *
 * **What it refuses is a write to the database FILE, which is narrower than "a write".** Measured
 * 2026-09-23 on Node v26.7.0: `create temp table t (id)` SUCCEEDS on a connection opened this way,
 * because SQLite keeps a temporary table outside the file it was told to open read-only. Such a
 * statement would therefore land on this connection and stay there rather than being routed back.
 * Nothing in this tree writes one — a `create temp`/`create temporary` grep over every package's
 * and app's source tree and over `scripts` counted 0 on 2026-09-23 — and whoever writes the first
 * one needs to know it is outside the guarantee above. (The glob is spelled out rather than
 * written, because a star followed by a slash ends this comment: `CLAUDE.md` section 3 records the
 * same trap breaking the English-only guard.)
 */
function openReadConnection(path: string): DatabaseSync {
  const connection = new DatabaseSync(path, { readOnly: true });
  connection.exec(`pragma busy_timeout = ${BUSY_TIMEOUT_MS}`);
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
 * same connection: an ordinary table name selects normally. `ATTACH` is still available for
 * hand-written SQL that genuinely needs both files at once — but a statement issued THROUGH THE
 * HANDLE lands on whichever connection the routing picks at that instant, and the statement after
 * it may land on the other, so an attachment belongs on a connection a caller holds itself.
 * `ATTACH` and a connection-scoped pragma are the same class as the temporary table above: they
 * change a CONNECTION rather than the file, so nothing refuses them on the reader and nothing
 * routes them back. Nothing in this tree attaches today: on 2026-09-23 a search of `packages`,
 * `apps`, `scripts` and `bench` for an `attach database` or `attach '…'` statement inside a `sql`
 * template or a driver call counted 0. A BARE `attach` grep is not that search and must not be
 * offered as one — it matches a domain word, attaching a product to a category
 * (`packages/catalogue/src/categories.db.test.ts`).
 *
 * **The schemas arrive as arguments rather than as imports.** This package imports nothing from
 * the workspace, because `@waitron/db` is what will import it; `scripts/workspace-cycles.test.ts`
 * fails on the loop an import back would close.
 *
 * **Two connections per file, and one Drizzle instance over the pair.** The writer is the single
 * one the queue serialises; the reader beside it is opened read-only, and a statement goes to
 * whichever the rule in `./connections.ts` names. What that buys is the committed view a
 * concurrent read used to get from node-postgres's pool: while `withWriteLock` holds a
 * transaction open, a read whose asynchronous context began outside the body sees committed rows
 * only, where on one connection it saw the open transaction's — including rows a rollback then
 * removed.
 */
export async function openVenueStore<
  TVenueSchema extends Record<string, unknown>,
  TNodeSchema extends Record<string, unknown>,
>(
  config: VenueStoreConfig<TVenueSchema, TNodeSchema>,
): Promise<VenueStore<TVenueSchema, TNodeSchema>> {
  await mkdir(config.directory, { recursive: true });
  // Whatever is open when an open FAILS has to be closed, or a boot that retries keeps a descriptor
  // per attempt. One list and one cleanup rather than a handler per connection: by the time the
  // node file is being opened, three connections may be standing. Pinned by the descriptor-count
  // case in ./index.test.ts, which also records why the sidecar files — the obvious thing to look
  // at — cannot tell an open connection from a closed one here.
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
      // Idempotent: `node:sqlite` throws "database is not open" on a second close, and a caller
      // that closed one file still has to be able to close the store. The writer is closed
      // whatever the reader does, so a refusal from one cannot leave the other open.
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
      await venue.close();
      await node.close();
    },
  };
}
