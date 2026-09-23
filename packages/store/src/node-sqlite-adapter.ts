import type {
  DatabaseSync,
  SQLInputValue,
  StatementResultingChanges,
  StatementSync,
} from "node:sqlite";
import { type Connections, isReadOnlyRefusal, settle } from "./connections.js";
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
 * Lets Drizzle's SQLite session drive Node's own SQLite.
 *
 * Drizzle publishes no driver for `node:sqlite` (checked against 0.45.2, the installed and the
 * newest published version), and `better-sqlite3` would add a compiled module to the box image for
 * an engine Node already contains. What Drizzle's session calls on its client is a small surface,
 * and it differs from `node:sqlite` in two places: the array-result mode Drizzle switches on with
 * `raw()`, which maps onto `setReturnArrays`; and `transaction(fn)`, which `node:sqlite` has no
 * equivalent of.
 */
export function adaptNodeSqlite(connections: Connections) {
  const bind = (params: unknown[]) => params as SQLInputValue[];
  const client = {
    /**
     * Compiles `query` against whichever connection it belongs on at the moment it RUNS.
     *
     * The statement is prepared inside the call rather than here, because `./connections.ts`
     * answers a question about the instant of execution and Drizzle's session prepares and then
     * runs as two steps.
     *
     * It costs no extra compilation ON THE PATH THIS TREE USES. Measured rather than read, by
     * counting `prepare` calls on the connection (2026-09-23, Node v26.7.0, drizzle 0.45.2):
     * `db.select().all()`, `db.run(sql…)` and each `db.query.<table>.findMany().sync()` compile
     * once per execution, and one HELD prepared query compiles twice for two executions.
     *
     * The two halves arrive there by different routes, which matters to whoever changes this.
     * `db.select()` and `db.run(sql…)` ask for a ONE-TIME query, which calls `client.prepare`
     * afresh per execution (`sqlite-core/query-builders/select.js:610`'s
     * `_prepare(isOneTimeQuery = true)`, and `sqlite-core/session.js:154/164/171/178`). The
     * relational builders take the opposite branch — `query-builders/query.js:94`'s
     * `_prepare(isOneTimeQuery = false)` is the REUSABLE one — and cost the same only because
     * `findMany`/`findFirst` build a new query object per call (`query.js:18` and `:41`), so the
     * statement that object keeps is used once and goes with it.
     *
     * A prepared query a CALLER holds is where the cost lands: it keeps the statement across
     * executions, so under this shape it recompiles per call where it used to compile once — the
     * two compiles above. No call site in `apps`, `packages`, `scripts` or `bench` holds one —
     * grepped 2026-09-23, for `.prepare()` on a Drizzle builder and for `sql.placeholder` — and
     * the first one that does should reconsider this shape.
     *
     * **A statement the read connection refuses because it is read-only is re-run on the write
     * connection.** That case is a write issued from an asynchronous context outside a transaction
     * while some other transaction is open, and on one connection it silently joined that
     * transaction; re-running it there keeps exactly that behaviour instead of exchanging it for a
     * refusal no caller in this tree is written to expect. It is safe to re-run because the
     * refusal arrives before any work — see `SQLITE_READONLY` in `./connections.ts`. Nothing else
     * is retried: a refusal for any other reason is the caller's to see, once.
     */
    prepare(query: string) {
      let asArrays = false;
      const compile = (connection: DatabaseSync) => {
        const stmt = connection.prepare(query);
        if (asArrays) stmt.setReturnArrays(true);
        return stmt;
      };
      const issue = <T>(use: (stmt: StatementSync) => T): T => {
        const target = connections.forStatement();
        try {
          return use(compile(target));
        } catch (error) {
          if (target !== connections.read || !isReadOnlyRefusal(error)) throw error;
          return use(compile(connections.write));
        }
      };
      const api = {
        run: (...params: unknown[]) => issue((stmt) => stmt.run(...bind(params))),
        all: (...params: unknown[]) => issue((stmt) => stmt.all(...bind(params))),
        get: (...params: unknown[]) => issue((stmt) => stmt.get(...bind(params))),
        /**
         * Rows as arrays rather than objects. Drizzle switches this on for any query it maps
         * against a column list of its own, and leaves it off for one it hands straight back.
         * It never switches back, so there is nothing to restore.
         */
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
     *
     * Drizzle never calls this: `close` appears nowhere in 0.45.2's `better-sqlite3/` or
     * `sqlite-core/`, grepped 2026-09-23. It is part of the client SHAPE, and its one caller today
     * is `./node-sqlite-adapter.test.ts`.
     */
    close: () => connections.write.close(),
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
     * A body that returns a promise finishes when the promise settles, not when it returns — the
     * distinction `settle` carries (`./connections.ts`). That holds the transaction
     * open across the wait, which is what the write queue already does for the enclosing one
     * (`./write-queue.ts` runs one body at a time). It has to hold at EVERY depth, and Drizzle
     * emits a nested transaction itself without calling this client — so {@link addExecute} routes
     * that level back through here rather than letting it release its savepoint on return. What
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
        (...args: A): R =>
          // The marking wraps the WHOLE transaction, `keep`/`undo` included, rather than the body
          // alone: a handler registered on the body's own promise runs between the body settling
          // and this transaction finishing, and a window that closed with the body would send its
          // read to the writer's still-uncommitted rows. Pinned by the `a read registered on a
          // direct transaction's body promise` case in `./index.test.ts`, which records what
          // moving this marking onto `fn(...args)` alone prints. `./write-queue.ts` brackets its own
          // transaction the same way, for the same reason.
          connections.asTransactionBody(() => {
            const write = connections.write;
            const savepoint = write.isTransaction ? nextSavepoint() : undefined;
            write.exec(savepoint === undefined ? `begin ${behaviour}` : `savepoint ${savepoint}`);
            /**
             * Finish the transaction — and undo it if FINISHING is what fails.
             *
             * `commit` runs after the body has already succeeded, and it can still be refused: a
             * foreign key deferred with `pragma defer_foreign_keys` is checked AT COMMIT, so the
             * refusal comes from this statement rather than from anything the body wrote. Measured on
             * node v26.7.0: the transaction is then still OPEN, the refused rows read back on this
             * connection, and the next `begin` is refused `cannot start a transaction within a
             * transaction` — a failure surfacing in an unrelated caller. `rollback` at that point
             * succeeds and undoes the work, which is what this does.
             *
             * Only the `commit` branch has been seen to fail this way: measured the same day, a
             * `release <savepoint>` inside an open transaction is NOT refused for a deferred key,
             * because the check belongs to the outer commit. The savepoint branch takes the same
             * handling anyway rather than a claim that nothing else can refuse it.
             *
             * The compensating rollback must not replace the refusal the caller has to see, so its
             * own failure is discarded and the original error is the one thrown.
             */
            const keep = () => {
              try {
                write.exec(savepoint === undefined ? "commit" : `release ${savepoint}`);
              } catch (error) {
                try {
                  undo();
                } catch {
                  // The refusal above is what the caller needs; this one would hide it.
                }
                throw error;
              }
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
  Omit<BaseSQLiteDatabase<"sync", StatementResultingChanges, TSchema>, "transaction"> & {
    execute<TRow extends Record<string, unknown> = Record<string, unknown>>(
      query: SQLWrapper | string,
    ): RawResult<TRow>;
    /**
     * A transaction body is handed this same type, not Drizzle's bare `SQLiteTransaction`.
     *
     * Two reasons, and the first is not cosmetic: {@link addExecute} decorates the transaction
     * object at runtime, so the value really does carry `execute`, and Drizzle's own signature
     * would describe it wrongly. The second is that `@waitron/db` declares one `Transaction` type
     * for both a database and a transaction on purpose, so that a write path taking a `tx` can be
     * handed either; typing the body's parameter as anything narrower puts a cast at every call
     * site in the tree.
     *
     * Structurally honest rather than a convenience: `SQLiteTransaction` extends
     * `BaseSQLiteDatabase` and only ADDS `rollback`, so a decorated transaction satisfies
     * everything this type requires.
     */
    transaction<T>(
      body: (tx: NodeSqliteDatabase<TSchema>) => T,
      config?: SQLiteTransactionConfig,
    ): T;
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
 * What {@link addExecute} needs of the object it decorates.
 *
 * Deliberately structural and loose: the two things it decorates — Drizzle's database and its
 * transaction — do not share a public type that names both `all` and `transaction`, and the
 * function only ever reads those two.
 */
type Executable = {
  all: (query: SQLWrapper | string) => unknown;
  transaction: (body: (tx: unknown) => unknown, config?: unknown) => unknown;
};

/**
 * Puts `execute` on a database or transaction object, and on every transaction opened from it.
 *
 * `all` is what answers every statement kind on this driver, not only a selection: measured on
 * node v26.7.0 against `node:sqlite`, `prepare(…).all()` returns `[]` for CREATE TABLE, for an
 * INSERT without RETURNING and for a DELETE, and the rows for a SELECT, an INSERT … RETURNING and
 * a PRAGMA. So one method covers what `execute()` covered on PostgreSQL.
 *
 * It has to RECURSE because Drizzle builds a fresh object for a transaction body rather than
 * handing the body the database — `db.transaction(cb)` calls `cb` with a `SQLiteTransaction`, and
 * that object's own `transaction` opens a savepoint with another one. Decorating only the database
 * left every caller that runs raw SQL inside a transaction dying on `tx.execute is not a function`:
 * all sixteen cases of `packages/fiscal-verifactu/src/chain.test.ts` did, through
 * `src/testing/seed.ts`, and `appendToChain` retries inside `tx.transaction(...)`, so the savepoint
 * level is reached by the product and not only by a test.
 *
 * **A transaction opened ON A TRANSACTION does not go through Drizzle at all**, and that is the
 * point of `openNested`. Drizzle reaches the client's `transaction` shim only for the OUTERMOST
 * call; a nested one is emitted by `SQLiteTransaction.transaction` straight onto the session, in
 * code written for a synchronous driver, so it releases its savepoint the moment the body RETURNS.
 * An `async` body returns at its first `await` with its throw still ahead of it, so the losing
 * attempt's earlier writes were released rather than rolled back — measured, and pinned by the two
 * `ON A TRANSACTION` cases in `./node-sqlite-adapter.test.ts`. Routing this level through the same
 * client shim the outermost level uses makes the depth stop mattering: one savepoint discipline,
 * `settle`-aware, at every level.
 *
 * The body is handed the object it was called on rather than a fresh one. At savepoint level there
 * is nothing a fresh object would carry that this one does not — a savepoint has no session, no
 * mode and no state of its own — and it keeps the recursion finite.
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
