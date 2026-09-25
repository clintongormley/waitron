import { AsyncLocalStorage } from "node:async_hooks";
import { statSync } from "node:fs";
import type { DatabaseSync, StatementSync } from "node:sqlite";

/**
 * An `async` body returns at its FIRST `await`, with its remaining work and its throw still ahead
 * of it, so a wrapper that believes the return finishes it commits early and never sees the throw.
 */
const isPending = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | undefined)?.then === "function";

/**
 * A pending `result` is handed back WRAPPED, so whatever the caller chains onto it runs after
 * `onOk`/`onFail` rather than racing them: the transaction's `commit` and this pair's bookkeeping
 * both have to happen before anyone downstream is told the body is over.
 */
export const settle = <T>(result: T, onOk: () => void, onFail: () => void): T => {
  if (!isPending(result)) {
    onOk();
    return result;
  }
  return result.then(
    (value: unknown) => {
      onOk();
      return value;
    },
    (error: unknown) => {
      onFail();
      throw error;
    },
  ) as T;
};

/** Called on each commit on a file's write connection that the store reports. */
export type CommitListener = () => void;

/**
 * How many rows `connection` has inserted, updated or deleted since it opened. Prepared once per
 * connection, because while a listener is registered it runs up to twice for each transaction the
 * store opens and each statement issued outside one.
 */
const changeCounters = new WeakMap<DatabaseSync, StatementSync>();
const totalChanges = (connection: DatabaseSync): number => {
  let counter = changeCounters.get(connection);
  if (counter === undefined) {
    counter = connection.prepare("select total_changes() as n");
    changeCounters.set(connection, counter);
  }
  return (counter.get() as { n: number }).n;
};

/** The write-ahead side file as last seen: its size and modification time, or why there is none. */
export type WalMark = { size: bigint; mtimeNs: bigint } | "absent" | "unreadable";

export const walMark = (path: string): WalMark => {
  try {
    const stat = statSync(path, { bigint: true, throwIfNoEntry: false });
    return stat === undefined ? "absent" : { size: stat.size, mtimeNs: stat.mtimeNs };
  } catch {
    return "unreadable";
  }
};

export const sameWal = (a: WalMark, b: WalMark): boolean =>
  a === "unreadable" || b === "unreadable"
    ? false
    : a === "absent" || b === "absent"
      ? a === b
      : a.size === b.size && a.mtimeNs === b.mtimeNs;

/**
 * The connections one database file is opened on, and the rule deciding where a statement goes.
 *
 * SQLite admits one writer per file, so there is one write connection and the queue in
 * `./write-queue.ts` serialises transactions on it. The second connection is what gives a
 * CONCURRENT reader a committed view: on the writer's own connection the same read sits inside the
 * open transaction and returns rows a rollback may still remove. Receipts:
 * `docs/developers/conventions-data.md`, "A read taken while ANOTHER caller's write transaction is
 * open sees committed rows only".
 */
export interface Connections {
  /** The one writer. Every transaction, and every statement issued inside one, runs here. */
  readonly write: DatabaseSync;
  /**
   * Opened read-only, so it sees committed rows only and cannot write to the database FILE. It can
   * still write a TEMPORARY table, which SQLite keeps outside that file — see `./index.ts`.
   */
  readonly read: DatabaseSync;
  /**
   * Marks `body` as this pair's own transaction body, for as long as it runs.
   *
   * It opens and closes nothing. Both call sites open the transaction INSIDE the body they pass
   * here — `./write-queue.ts` runs `begin immediate` as the body's first statement, and the shim
   * in `./node-sqlite-adapter.ts` its `begin`/`savepoint`.
   *
   * Reads issued inside `body` — at any depth, and after any `await` — go to the writer. Reads
   * whose context began outside it go to the reader for as long as `body` lasts.
   */
  asTransactionBody: <T>(body: () => T) => T;
  /** Which connection a statement issued at this moment belongs on. */
  forStatement: () => DatabaseSync;
  /**
   * Registers `listener` for the commits the store reports; returns the unsubscribe. See
   * `StoreHandle.onCommit` in `./index.ts` for which commits those are. The first listener
   * registered while none is takes the side file as it is now as the comparison point.
   */
  onCommit: (listener: CommitListener) => () => void;
  /**
   * The writer's count of changed rows, taken before a transaction or a statement outside one;
   * null when no listener is registered, so a node nobody listens on runs no extra query. The first
   * listener, registered after a null mark, does not hear of that commit.
   */
  changeMark: () => number | null;
  /**
   * Call once the work `mark` was taken before has committed, and not after a rollback: the count
   * does not go back down when rows are rolled back. `commit` and `release` do not move it (both
   * measured on `node:sqlite`, Node v26.7.0, 2026-09-25).
   *
   * Tells every listener, if the count moved since `mark`, unless the file's side file is
   * unchanged since the last commit reported: such a commit (an UPDATE to the value a row already
   * holds) wrote nothing a copy of the file could show. The commit is already durable, so a
   * listener that throws, or returns a promise that rejects, is skipped rather than allowed to
   * reach the caller, who would otherwise be told a committed write failed.
   *
   * The side file is compared by size and modification time. After a checkpoint a commit rewrites
   * it from its beginning, at an unchanged size while it fits, so a commit landing in the same
   * modification-time tick as the one before is not reported. Measured on macOS APFS only, not on
   * the box's filesystem. A commit that changes the side file but no row (DDL) is not reported and does not move the comparison either, so a
   * same-value update right after one IS reported.
   */
  reportIfChanged: (mark: number | null) => void;
  /**
   * Takes the side file as it is now as the comparison point: for the store's own checkpoint,
   * which changes the file without a commit.
   */
  sideFileReset: () => void;
}

/**
 * Pairs a file's two connections.
 *
 * **The read connection is taken only while a body passed to
 * {@link Connections.asTransactionBody} is running and this caller is not inside THAT body.**
 * Everywhere else the writer is used.
 *
 * **A transaction this pair was not told about does not open the window**, deliberately. Drizzle's
 * own migrator issues `begin`, `commit` and `rollback` as ordinary statements through the session
 * (`drizzle-orm/sqlite-core/dialect.js` → `migrate`); routing on the ENGINE's
 * `DatabaseSync.isTransaction` would send the migrator's own statements to the read-only
 * connection, where its `rollback` is refused `cannot rollback - no transaction is active` rather
 * than errcode 8, so nothing could route it back.
 *
 * **Each body gets its own token**, because asynchronous context is inherited and never expires: a
 * boolean would read a callback DETACHED inside an earlier body as inside whatever transaction is
 * open when it finally runs, and show it a stranger's uncommitted rows. A token whose body has
 * ended falls through to the committed view an outsider gets.
 *
 * Both places that open a transaction on the write connection call `asTransactionBody` — the write
 * queue, and the transaction shim in `./node-sqlite-adapter.ts` — because a body reads its own
 * uncommitted rows whichever of the two opened it.
 *
 * Suites that are not about routing hand the same connection in twice: two connections to
 * `:memory:` would be two separate databases.
 */
export function connectionPair(write: DatabaseSync, read: DatabaseSync): Connections {
  const context = new AsyncLocalStorage<symbol>();
  /**
   * A set rather than a flag or a count because bodies nest AND overlap, so the question is never
   * "is one running" alone but "is THIS one still running".
   */
  const running = new Set<symbol>();
  const listeners = new Set<CommitListener>();
  const location = write.location();
  const walPath = location === null ? null : `${location}-wal`;
  let lastWal: WalMark = "unreadable";
  return {
    write,
    read,
    asTransactionBody: <T>(body: () => T): T => {
      const token = Symbol("transaction body");
      running.add(token);
      const ended = () => {
        running.delete(token);
      };
      let result: T;
      try {
        result = context.run(token, body);
      } catch (error) {
        ended();
        throw error;
      }
      return settle(result, ended, ended);
    },
    forStatement: () => {
      if (running.size === 0) return write;
      const token = context.getStore();
      return token !== undefined && running.has(token) ? write : read;
    },
    onCommit: (listener) => {
      if (listeners.size === 0 && walPath !== null) lastWal = walMark(walPath);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    changeMark: () => (listeners.size === 0 ? null : totalChanges(write)),
    sideFileReset: () => {
      if (walPath !== null) lastWal = walMark(walPath);
    },
    reportIfChanged: (mark) => {
      if (mark === null || totalChanges(write) === mark) return;
      if (walPath !== null) {
        const wal = walMark(walPath);
        if (sameWal(wal, lastWal)) return;
        lastWal = wal;
      }
      for (const listener of listeners) {
        try {
          const returned: unknown = listener();
          if (isPending(returned)) returned.then(undefined, () => {});
        } catch {
          // See `reportIfChanged` on the interface.
        }
      }
    },
  };
}

/**
 * SQLite's `SQLITE_READONLY`, which `node:sqlite` puts on the thrown error's `errcode` when the
 * read connection refuses a write. Nothing is written before the throw, which is what lets
 * `./node-sqlite-adapter.ts` re-run such a statement on the write connection.
 */
const SQLITE_READONLY = 8;

/**
 * Reads `errcode` off the thrown value itself and does NOT walk the `cause` chain: it is called
 * from the `catch` that wraps `stmt.run`/`all`/`get` directly, with nothing in between to wrap the
 * driver's error.
 */
export const isReadOnlyRefusal = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { errcode?: number }).errcode === SQLITE_READONLY;
