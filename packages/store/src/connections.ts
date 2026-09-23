import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseSync } from "node:sqlite";

/**
 * Is this what a body returned, or what it will return later?
 *
 * The engine is synchronous and Drizzle's session is built for a synchronous driver, so its
 * transaction wrapper is written as though a body finishes when it returns. An `async` body returns
 * at its FIRST `await`, with its remaining work and its throw still ahead of it, so a wrapper that
 * believes the return finishes it commits early and never sees the throw at all. Both this module
 * and `./node-sqlite-adapter.ts` have to tell the two apart, for the same reason.
 */
const isPending = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | undefined)?.then === "function";

/**
 * Runs `onOk` when `result` is finished and `onFail` when it fails, whichever way round it
 * finishes — and whether it finished on return or will finish later ({@link isPending}).
 *
 * `result` is handed back so a caller can return it, and a pending one is handed back WRAPPED, so
 * whatever the caller chains onto it runs after `onOk`/`onFail` rather than racing them. That
 * ordering is the point at both call sites: the transaction's `commit` and this pair's
 * bookkeeping both have to happen before anyone downstream is told the body is over.
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

/**
 * The connections one database file is opened on, and the rule deciding where a statement goes.
 *
 * SQLite admits one writer per file, so there is one write connection and the queue in
 * `./write-queue.ts` serialises transactions on it. Write-ahead mode lets a reader run on a second
 * connection while that writer works, and the second connection is what gives a CONCURRENT reader
 * a committed view: on the writer's own connection the same read sits inside the open transaction
 * and returns rows a rollback may still remove.
 *
 * Measured 2026-09-21 during the flip and again 2026-09-23 on Node v26.7.0, with the second
 * connection as the control: with one row committed and a second inserted inside an open
 * transaction, the write connection counts 2 and the read connection 1; after the rollback both
 * count 1. Pinned by the `committed rows only` case in `./index.test.ts`.
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
   * in `./node-sqlite-adapter.ts` its `begin`/`savepoint` — so the mark is registered a moment
   * before the transaction it stands for exists. Neither call site awaits anything in between, and
   * a read that did land in that gap would get the reader's committed view, which is the same
   * direction a token whose body has ENDED falls back to.
   *
   * Reads issued inside `body` — at any depth, and after any `await` — go to the writer. Reads
   * whose context began outside it go to the reader for as long as `body` lasts.
   */
  asTransactionBody: <T>(body: () => T) => T;
  /** Which connection a statement issued at this moment belongs on. */
  forStatement: () => DatabaseSync;
}

/**
 * Pairs a file's two connections.
 *
 * **The read connection is taken only while a body passed to
 * {@link Connections.asTransactionBody} is running and this caller is not inside THAT body.** That
 * is the one window in which the two connections answer differently; everywhere else the writer is
 * used, so DDL, archives, migrations and writes outside a transaction behave exactly as they did on
 * one connection.
 *
 * **A transaction this pair was not told about does not open the window**, and that is deliberate
 * rather than an omission. Drizzle's own migrator issues `begin`, `commit` and `rollback` as
 * ordinary statements through the session rather than through the transaction shim
 * (`drizzle-orm/sqlite-core/dialect.js` → `migrate`), so asking the ENGINE whether a transaction is
 * open — `DatabaseSync.isTransaction` — sends the migrator's own statements to a read-only
 * connection, and its `rollback` is then refused `cannot rollback - no transaction is active`
 * rather than errcode 8, so nothing could route it back. Measured: 54 of `packages/db`'s 65 test
 * files failed that way on the day this was written. What a caller like that gets is one
 * connection's behaviour, unchanged.
 *
 * **Each body gets its own token, and the answer is about THAT token, not about being inside some
 * body once.** A boolean cannot tell a caller inside the running body from a callback DETACHED
 * inside an earlier one and settling now — asynchronous context is inherited and never expires, so
 * the stale callback would be read as inside whatever transaction happens to be open when it
 * finally runs, and would see a stranger's uncommitted rows. Pinned by the
 * `work detached from a finished transaction` case in `./index.test.ts`, which fails with a
 * boolean. A token whose body has ended falls through to the same answer an outsider gets, which
 * is the committed view — the safe direction.
 *
 * **"Inside" is asynchronous context and cannot be a flag**, for the same reason
 * `./write-queue.ts` gives at its own: a flag cannot tell a caller nested inside a running body
 * from a caller merely running alongside one, and alongside is precisely what this routes. Both
 * places that open a transaction on the write connection call `asTransactionBody` — the write
 * queue, and the transaction shim in `./node-sqlite-adapter.ts` — because a body reads its own
 * uncommitted rows whichever of the two opened it.
 *
 * The suites that are not about routing hand the same connection in twice. Two connections to
 * `:memory:` would be two separate databases, and what those suites test is the adapter and the
 * queue rather than where a statement lands.
 */
export function connectionPair(write: DatabaseSync, read: DatabaseSync): Connections {
  const context = new AsyncLocalStorage<symbol>();
  /**
   * The bodies running right now, one token each.
   *
   * A set rather than a flag or a count because bodies nest AND overlap: `tx.transaction(...)`
   * inside a write lock is ordinary in this tree, and two files' worth of callers can be mid-body
   * at once, so the question is never "is one running" alone but "is THIS one still running".
   */
  const running = new Set<symbol>();
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
      // Nothing of ours is open, so there is nothing to be outside of. Checked first because it is
      // the common path and it skips reading the asynchronous context altogether.
      if (running.size === 0) return write;
      const token = context.getStore();
      return token !== undefined && running.has(token) ? write : read;
    },
  };
}

/**
 * SQLite's `SQLITE_READONLY`, which `node:sqlite` puts on the thrown error's `errcode`.
 *
 * It is what a write attempted on the read connection is refused with, and the refusal arrives at
 * RUN rather than at prepare — measured 2026-09-23 on Node v26.7.0, where `insert`, `update`,
 * `delete`, `create table`, `with … insert` and a writing pragma each prepared successfully on a
 * read-only connection and threw errcode 8 on the first call. Nothing is written before the throw,
 * which is what lets `./node-sqlite-adapter.ts` re-run such a statement on the write connection.
 */
const SQLITE_READONLY = 8;

/**
 * Deliberately reads `errcode` off the thrown value itself and does NOT walk the `cause` chain, so
 * it is narrower than the readers that do — `refusalCode` in
 * `packages/db/src/constraint-target.ts`, and `sqliteFailureOf` in
 * `packages/shared/src/engine-failure.ts`. It is called from the `catch` that wraps
 * `stmt.run`/`all`/`get` directly, with nothing in between to wrap the driver's error — and this
 * package imports nothing from the workspace (`./index.ts`), so none of them is in reach anyway.
 */
export const isReadOnlyRefusal = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { errcode?: number }).errcode === SQLITE_READONLY;
