import type {
  DatabaseSync,
  SQLInputValue,
  StatementResultingChanges,
  StatementSync,
} from "node:sqlite";
import { type Connections, isReadOnlyRefusal, settle, totalChanges } from "./connections.js";
import { createTableRelationsHelpers, extractTablesRelationalConfig } from "drizzle-orm";
import { BetterSQLiteSession } from "drizzle-orm/better-sqlite3/session";
import { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core/db";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core/dialect";
import type { SQLiteTransactionConfig } from "drizzle-orm/sqlite-core";
import type { DrizzleConfig } from "drizzle-orm/utils";
import type { SQLWrapper } from "drizzle-orm";

/** The transaction modes SQLite names, which Drizzle selects by property name. */
const BEHAVIOURS = ["deferred", "immediate", "exclusive"] as const;

type Behaviour = (typeof BEHAVIOURS)[number];

/** A transaction wrapper: callable for the default mode, and indexable by mode name. */
type TransactionWrapper<A extends unknown[], R> = ((...args: A) => R) &
  Record<Behaviour, (...args: A) => R>;

/**
 * The counter never restarts and never reuses a value, so a name identifies exactly one savepoint
 * however the depths interleave. It is module-level rather than per client because two clients can
 * be built over one connection, and it is the CONNECTION the names live on.
 */
let savepointsTaken = 0;
const nextSavepoint = () => `wt_sp_${(savepointsTaken += 1)}`;

/**
 * Lets Drizzle's SQLite session drive Node's own SQLite. Drizzle 0.45.2 publishes no driver for
 * `node:sqlite`, and `better-sqlite3` would add a compiled module to the box image for an engine
 * Node already contains.
 */
export function adaptNodeSqlite(connections: Connections) {
  const bind = (params: unknown[]) => params as SQLInputValue[];
  const client = {
    /**
     * Compiles `query` against whichever connection it belongs on at the moment it RUNS: the
     * routing in `./connections.ts` answers a question about the instant of execution, and
     * Drizzle's session prepares and then runs as two steps. So a prepared query a caller HOLDS
     * recompiles on every execution.
     *
     * **A statement the read connection refuses because it is read-only is re-run on the write
     * connection.** That case is a write issued from an asynchronous context outside a transaction
     * while some other transaction is open; re-run there, it joins that transaction and commits or
     * rolls back with it, rather than meeting a refusal no caller in this tree is written to
     * expect. It is safe to re-run because the refusal arrives before any work — see
     * `SQLITE_READONLY` in `./connections.ts`. Nothing else is retried.
     */
    prepare(query: string) {
      let asArrays = false;
      const compile = (connection: DatabaseSync) => {
        const stmt = connection.prepare(query);
        if (asArrays) stmt.setReturnArrays(true);
        return stmt;
      };
      /**
       * A statement on the writer with no transaction open commits by itself. Whether it changed a
       * row is read off SQLite's own counter, so a read, or DDL, which the counter does not count,
       * tells nobody.
       */
      const onWriter = <T>(use: (stmt: StatementSync) => T): T => {
        const write = connections.write;
        const alone = !write.isTransaction && connections.listening();
        const before = alone ? totalChanges(write) : 0;
        const result = use(compile(write));
        if (alone && !write.isTransaction && totalChanges(write) !== before) {
          connections.committed();
        }
        return result;
      };
      const issue = <T>(use: (stmt: StatementSync) => T): T => {
        const target = connections.forStatement();
        if (target === connections.write) return onWriter(use);
        try {
          return use(compile(target));
        } catch (error) {
          if (!isReadOnlyRefusal(error)) throw error;
          return onWriter(use);
        }
      };
      const api = {
        run: (...params: unknown[]) => issue((stmt) => stmt.run(...bind(params))),
        all: (...params: unknown[]) => issue((stmt) => stmt.all(...bind(params))),
        get: (...params: unknown[]) => issue((stmt) => stmt.get(...bind(params))),
        /** Rows as arrays rather than objects. Drizzle never switches it back. */
        raw() {
          asArrays = true;
          return api;
        },
      };
      return api;
    },
    /**
     * Closes the write connection alone. The read connection beside it belongs to the store, which
     * opened both and closes both (`./index.ts`).
     */
    close: () => connections.write.close(),
    /**
     * Runs `fn` as a transaction, undoing its work if it throws.
     *
     * With nothing open that is `begin` / `commit` / `rollback`. With a transaction already open it
     * is `savepoint` / `release` / `rollback to`, because SQLite refuses a `begin` inside a
     * transaction. Openness is read from the engine (`DatabaseSync.isTransaction`), never from a
     * count kept here, so a transaction the engine ended on its own is not one this client still
     * believes in.
     *
     * A body that returns a promise finishes when the promise settles, not when it returns
     * (`settle`, `./connections.ts`). That has to hold at EVERY depth, and Drizzle emits a nested
     * transaction itself without calling this client — so {@link addExecute} routes that level
     * back through here. What NOTHING here enforces is the order WITHIN one body: two
     * transactions opened on this connection concurrently — `Promise.all` over two
     * `tx.transaction(...)` calls — would finish out of order, and a savepoint released out of
     * order takes every savepoint after it with it. No guard says so.
     *
     * `rollback to` leaves the savepoint on the stack, so it is released on both paths; a caller
     * that retries would otherwise leave one behind per failed attempt.
     *
     * A savepoint has no mode of its own. The returned wrapper still carries one property per
     * SQLite transaction mode, because Drizzle's session indexes it by name rather than calling it
     * (`nativeTx[config.behavior ?? "deferred"](tx)` in `drizzle-orm/better-sqlite3/session.js`).
     */
    transaction<A extends unknown[], R>(fn: (...args: A) => R): TransactionWrapper<A, R> {
      const inMode =
        (behaviour: Behaviour) =>
        (...args: A): R =>
          // The marking wraps the WHOLE transaction, `keep`/`undo` included, rather than the body
          // alone: a handler registered on the body's own promise can run between the body
          // settling and this transaction finishing, and must not read the writer's uncommitted
          // rows.
          connections.asTransactionBody(() => {
            const write = connections.write;
            const savepoint = write.isTransaction ? nextSavepoint() : undefined;
            write.exec(savepoint === undefined ? `begin ${behaviour}` : `savepoint ${savepoint}`);
            let before = 0;
            /**
             * Finish the transaction — and undo it if FINISHING is what fails. A refused `commit`
             * (a foreign key deferred with `pragma defer_foreign_keys` is checked AT COMMIT) leaves
             * the transaction OPEN, and the next `begin` in an unrelated caller would be refused.
             * The compensating rollback's own failure is discarded so the original error is thrown.
             */
            const keep = () => {
              let changed: boolean;
              try {
                changed = savepoint === undefined && totalChanges(write) !== before;
                write.exec(savepoint === undefined ? "commit" : `release ${savepoint}`);
              } catch (error) {
                try {
                  undo();
                } catch {
                  // The refusal above is what the caller needs; this one would hide it.
                }
                throw error;
              }
              if (changed) connections.committed();
            };
            const undo = () => {
              if (savepoint === undefined) write.exec("rollback");
              else {
                write.exec(`rollback to ${savepoint}`);
                write.exec(`release ${savepoint}`);
              }
            };
            let result: R;
            try {
              if (savepoint === undefined) before = totalChanges(write);
              result = fn(...args);
            } catch (error) {
              undo();
              throw error;
            }
            return settle(result, keep, undo);
          });
      const wrapper = inMode("deferred") as TransactionWrapper<A, R>;
      for (const behaviour of BEHAVIOURS) wrapper[behaviour] = inMode(behaviour);
      return wrapper;
    },
  };
  return client;
}

/** What a statement written as raw SQL hands back. */
export interface RawResult<TRow> {
  rows: TRow[];
}

/**
 * The handle `drizzleNodeSqlite` hands back: Drizzle's synchronous SQLite database, plus
 * {@link RawResult}-shaped `execute`. `execute` returns its rows rather than a promise of them,
 * because this engine is synchronous; a caller that `await`s it reads the same value.
 */
export type NodeSqliteDatabase<TSchema extends Record<string, unknown> = Record<string, never>> =
  Omit<BaseSQLiteDatabase<"sync", StatementResultingChanges, TSchema>, "transaction"> & {
    execute<TRow extends Record<string, unknown> = Record<string, unknown>>(
      query: SQLWrapper | string,
    ): RawResult<TRow>;
    /**
     * A transaction body is handed this same type, not Drizzle's bare `SQLiteTransaction`:
     * {@link addExecute} decorates the transaction object at runtime, so the value really does
     * carry `execute`. `@waitron/db` also declares one `Transaction` type for a database and a
     * transaction alike, so a write path taking a `tx` can be handed either.
     */
    transaction<T>(
      body: (tx: NodeSqliteDatabase<TSchema>) => T,
      config?: SQLiteTransactionConfig,
    ): T;
  };

/**
 * Drizzle over `node:sqlite`, assembled from Drizzle's parts rather than through
 * `drizzle-orm/better-sqlite3`, whose driver statically imports `better-sqlite3`.
 */
export function drizzleNodeSqlite<TSchema extends Record<string, unknown>>(
  connections: Connections,
  config: { schema: TSchema; casing?: DrizzleConfig<TSchema>["casing"] },
): NodeSqliteDatabase<TSchema> {
  const dialect = new SQLiteSyncDialect({ casing: config.casing });
  const tables = extractTablesRelationalConfig(config.schema, createTableRelationsHelpers);
  const schema = {
    fullSchema: config.schema,
    schema: tables.tables,
    tableNamesMap: tables.tableNamesMap,
  };
  const client = adaptNodeSqlite(connections);
  const session = new BetterSQLiteSession(client, dialect, schema);
  const handle = new BaseSQLiteDatabase("sync", dialect, session, schema);
  // Through `unknown`: `Executable` names only the two members the decoration touches, so it does
  // not overlap the full database type enough for a direct assertion.
  return addExecute(
    handle as unknown as Executable,
    client.transaction,
  ) as unknown as NodeSqliteDatabase<TSchema>;
}

/**
 * Loose on purpose: Drizzle's database and its transaction do not share a public type that names
 * both `all` and `transaction`.
 */
type Executable = {
  all: (query: SQLWrapper | string) => unknown;
  transaction: (body: (tx: unknown) => unknown, config?: unknown) => unknown;
};

/**
 * Puts `execute` on a database or transaction object, and on every transaction opened from it.
 * `all` answers every statement kind on this driver, with `[]` for one that returns no rows.
 *
 * It has to RECURSE because Drizzle hands a transaction body a fresh `SQLiteTransaction` rather
 * than the database.
 *
 * **A transaction opened ON A TRANSACTION does not go through Drizzle at all**, and that is the
 * point of `openNested`. Drizzle's own nested transaction releases its savepoint the moment the
 * body RETURNS, so an `async` body's earlier writes would be released rather than rolled back when
 * it later throws. Routing that level through the client shim gives one `settle`-aware savepoint
 * discipline at every level. The nested body is handed the object it was called on, which keeps the
 * recursion finite.
 */
function addExecute<T extends Executable>(target: T, openNested: NestedOpener, nested = false): T {
  const openTransaction = target.transaction.bind(target);
  const decorated = Object.assign(target, {
    execute<TRow extends Record<string, unknown> = Record<string, unknown>>(
      query: SQLWrapper | string,
    ): RawResult<TRow> {
      return { rows: target.all(query) as TRow[] };
    },
    transaction(body: (tx: unknown) => unknown, config?: unknown) {
      if (nested) return openNested(() => body(decorated))();
      return openTransaction(
        (inner) => body(addExecute(inner as Executable, openNested, true)),
        config,
      );
    },
  });
  return decorated;
}

/** The client's own savepoint-aware transaction wrapper, as {@link addExecute} needs it. */
type NestedOpener = <R>(fn: () => R) => (() => R) & Record<Behaviour, () => R>;
