import type { DatabaseSync, SQLInputValue, StatementResultingChanges } from "node:sqlite";
import { createTableRelationsHelpers, extractTablesRelationalConfig } from "drizzle-orm";
import { BetterSQLiteSession } from "drizzle-orm/better-sqlite3/session";
import { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core/db";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core/dialect";
import type { DrizzleConfig } from "drizzle-orm/utils";
import type { SQLWrapper } from "drizzle-orm";

/** The transaction modes SQLite names, which Drizzle selects by property name. */
const BEHAVIOURS = ["deferred", "immediate", "exclusive"] as const;

type Behaviour = (typeof BEHAVIOURS)[number];

/** A transaction wrapper: callable for the default mode, and indexable by mode name. */
type TransactionWrapper<A extends unknown[], R> = ((...args: A) => R) &
  Record<Behaviour, (...args: A) => R>;

/**
 * Names the next savepoint.
 *
 * A savepoint needs a name, and SQLite offers nothing to read the current depth from, so the name
 * comes from a counter rather than from the engine. The counter never restarts and never reuses a
 * value, so a name identifies exactly one savepoint however the depths interleave — which is what
 * makes `release`/`rollback to` unambiguous. It is module-level rather than per client because two
 * clients can be built over one connection, and it is the CONNECTION the names live on.
 *
 * The prefix is for reading a trace, not for correctness: Drizzle names the savepoints it emits
 * itself `sp0`, `sp1`, … (`drizzle-orm/better-sqlite3/session.js:46`, read against 0.45.2), and a
 * repeated name is resolved by SQLite to the most recent savepoint holding it, which under strict
 * nesting is always the right one (measured on node v26.7.0: with two savepoints named `same`, one
 * `release same` left the outer one standing and its rows intact).
 */
let savepointsTaken = 0;
const nextSavepoint = () => `wt_sp_${(savepointsTaken += 1)}`;

/**
 * Is this what a body returned, or what it will return later?
 *
 * The engine is synchronous and Drizzle's session is built for a synchronous driver, so its
 * transaction wrapper is written as though a body finishes when it returns. An `async` body returns
 * at its FIRST `await`, with its remaining work and its throw still ahead of it, so a wrapper that
 * believes the return commits early and never sees the throw at all. Checked at the six places that
 * open a transaction on a transaction-typed value — `tx.transaction(`, `grep`ped over `packages`
 * and `apps` — every one of them hands in a body that returns a promise.
 */
const isPending = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | undefined)?.then === "function";

/**
 * Lets Drizzle's SQLite session drive Node's own SQLite.
 *
 * Drizzle publishes no driver for `node:sqlite` (checked against 0.45.2, the installed and the
 * newest published version), and `better-sqlite3` would add a compiled module to the box image for
 * an engine Node already contains. What Drizzle's session calls on its client is a small surface,
 * and it differs from `node:sqlite` in two places: the array-result mode Drizzle switches on with
 * `raw()`, which maps onto `setReturnArrays`; and `transaction(fn)`, which `node:sqlite` has no
 * equivalent of.
 */
export function adaptNodeSqlite(db: DatabaseSync) {
  const bind = (params: unknown[]) => params as SQLInputValue[];
  const client = {
    prepare(query: string) {
      const stmt = db.prepare(query);
      const api = {
        run: (...params: unknown[]) => stmt.run(...bind(params)),
        all: (...params: unknown[]) => stmt.all(...bind(params)),
        get: (...params: unknown[]) => stmt.get(...bind(params)),
        /**
         * Rows as arrays rather than objects. Drizzle switches this on for any query it maps
         * against a column list of its own, and leaves it off for one it hands straight back.
         * It never switches back, so there is nothing to restore.
         */
        raw() {
          stmt.setReturnArrays(true);
          return api;
        },
      };
      return api;
    },
    close: () => db.close(),
    /**
     * Runs `fn` as a transaction, undoing its work if it throws.
     *
     * With nothing open that is `begin` / `commit` / `rollback`. With a transaction already open it
     * is `savepoint` / `release` / `rollback to`, because SQLite refuses a `begin` inside a
     * transaction — `cannot start a transaction within a transaction`. Both halves are reached in
     * this repository: a request arrives here with the connection already inside the
     * `begin immediate` that `createWriteQueue` opened (`./write-queue.ts`), and `withTransaction`
     * hands its body the DATABASE handle (`packages/db/src/tenancy.ts`), so a write path's
     * `tx.transaction(...)` is a nested call on this client.
     *
     * Openness is read from the engine (`DatabaseSync.isTransaction`, a wrapper around
     * `sqlite3_get_autocommit()`), never from a count kept here, so a transaction the engine ended
     * on its own is not one this client still believes in.
     *
     * A body that returns a promise finishes when the promise settles, not when it returns — see
     * {@link isPending}. That holds the transaction open across the wait, which is what the write
     * queue already does for the enclosing one (`./write-queue.ts` runs one body at a time). What
     * NOTHING here enforces is the order WITHIN one body: two transactions opened on this
     * connection concurrently — `Promise.all` over two `tx.transaction(...)` calls — would finish
     * out of order, and a savepoint released out of order takes every savepoint after it with it.
     * No caller does that today (the loops that nest here `await` in turn), and no guard says so.
     *
     * A savepoint the body left behind is released on both paths. `rollback to` undoes the work but
     * leaves the savepoint on the stack (measured on node v26.7.0: a second `rollback to` the same
     * name succeeds, and only after `release` does it read `no such savepoint`), and the retrying
     * callers — `appendToChain` in `packages/fiscal-verifactu/src/chain.ts` and in
     * `packages/workforce/src/chain.ts` — would otherwise leave one behind per failed attempt.
     *
     * The mode is the enclosing transaction's business: a savepoint has no mode of its own. The
     * returned wrapper still carries one property per SQLite transaction mode, because Drizzle's
     * session indexes it by name rather than calling it
     * (`drizzle-orm/better-sqlite3/session.js:40`: `nativeTx[config.behavior ?? "deferred"](tx)`),
     * so a wrapper that is only callable fails with a type error rather than a query error.
     */
    transaction<A extends unknown[], R>(fn: (...args: A) => R): TransactionWrapper<A, R> {
      const inMode =
        (behaviour: Behaviour) =>
        (...args: A): R => {
          const savepoint = db.isTransaction ? nextSavepoint() : undefined;
          db.exec(savepoint === undefined ? `begin ${behaviour}` : `savepoint ${savepoint}`);
          const keep = () => {
            db.exec(savepoint === undefined ? "commit" : `release ${savepoint}`);
          };
          const undo = () => {
            if (savepoint === undefined) db.exec("rollback");
            else {
              db.exec(`rollback to ${savepoint}`);
              db.exec(`release ${savepoint}`);
            }
          };
          let result: R;
          try {
            result = fn(...args);
          } catch (error) {
            undo();
            throw error;
          }
          if (!isPending(result)) {
            keep();
            return result;
          }
          return result.then(
            (value: unknown) => {
              keep();
              return value;
            },
            (error: unknown) => {
              undo();
              throw error;
            },
          ) as R;
        };
      const wrapper = inMode("deferred") as TransactionWrapper<A, R>;
      for (const behaviour of BEHAVIOURS) wrapper[behaviour] = inMode(behaviour);
      return wrapper;
    },
  };
  return client;
}

/**
 * What a statement written as raw SQL hands back.
 *
 * `{ rows }` is the shape the tree's write paths already read, because it is what both PostgreSQL
 * drivers' `execute()` returned. Keeping it means the engine change does not also rewrite every
 * caller that reads `.rows`.
 */
export interface RawResult<TRow> {
  rows: TRow[];
}

/**
 * The handle `drizzleNodeSqlite` hands back: Drizzle's synchronous SQLite database, plus
 * {@link RawResult}-shaped `execute`.
 *
 * Drizzle's SQLite database has no `execute` of its own — `run`, `all`, `get` and `values` are the
 * whole surface (`drizzle-orm/sqlite-core/db.d.ts:247-250`, read against 0.45.2). `execute` is
 * added here rather than at each call site so that the hundred-odd statements already written as
 * `await handle.execute(sql`…`)` keep compiling and keep meaning the same thing.
 *
 * It returns its rows rather than a promise of them, because this engine is synchronous. A caller
 * that `await`s it still reads the same value; nothing in this repository's lint configuration
 * objects to awaiting a non-promise (`eslint.config.js` takes `tseslint.configs.recommended`,
 * which is not type-aware, so `await-thenable` is not in force).
 */
export type NodeSqliteDatabase<TSchema extends Record<string, unknown> = Record<string, never>> =
  BaseSQLiteDatabase<"sync", StatementResultingChanges, TSchema> & {
    execute<TRow extends Record<string, unknown> = Record<string, unknown>>(
      query: SQLWrapper | string,
    ): RawResult<TRow>;
  };

/**
 * Drizzle over `node:sqlite`.
 *
 * Assembled here rather than through `drizzle-orm/better-sqlite3`, because that module's first line
 * is `import Client from "better-sqlite3"` — a static import, so importing it fails outright with
 * `Cannot find package 'better-sqlite3'` even when a client is supplied and no `new Client()` is
 * ever reached. The session, the dialect and the database class it assembles are all published
 * separately and carry no such import.
 */
export function drizzleNodeSqlite<TSchema extends Record<string, unknown>>(
  db: DatabaseSync,
  config: { schema: TSchema; casing?: DrizzleConfig<TSchema>["casing"] },
): NodeSqliteDatabase<TSchema> {
  const dialect = new SQLiteSyncDialect({ casing: config.casing });
  const tables = extractTablesRelationalConfig(config.schema, createTableRelationsHelpers);
  const schema = {
    fullSchema: config.schema,
    schema: tables.tables,
    tableNamesMap: tables.tableNamesMap,
  };
  const session = new BetterSQLiteSession(adaptNodeSqlite(db), dialect, schema);
  const handle = new BaseSQLiteDatabase("sync", dialect, session, schema);
  // `all` is what answers every statement kind on this driver, not only a selection: measured on
  // node v26.7.0 against `node:sqlite`, `prepare(…).all()` returns `[]` for CREATE TABLE, for an
  // INSERT without RETURNING and for a DELETE, and the rows for a SELECT, an INSERT … RETURNING
  // and a PRAGMA. So one method covers what `execute()` covered on PostgreSQL.
  return Object.assign(handle, {
    execute<TRow extends Record<string, unknown> = Record<string, unknown>>(
      query: SQLWrapper | string,
    ): RawResult<TRow> {
      return { rows: handle.all<TRow>(query) };
    },
  }) as NodeSqliteDatabase<TSchema>;
}
