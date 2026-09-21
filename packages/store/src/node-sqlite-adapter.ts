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
     * Runs `fn` between `begin` and `commit`, rolling back if it throws.
     *
     * The returned wrapper carries one property per SQLite transaction mode because Drizzle's
     * session indexes it by name rather than calling it
     * (`drizzle-orm/better-sqlite3/session.js:40`: `nativeTx[config.behavior ?? "deferred"](tx)`),
     * so a wrapper that is only callable fails with a type error rather than a query error.
     */
    transaction<A extends unknown[], R>(fn: (...args: A) => R): TransactionWrapper<A, R> {
      const inMode =
        (behaviour: Behaviour) =>
        (...args: A): R => {
          db.exec(`begin ${behaviour}`);
          try {
            const result = fn(...args);
            db.exec("commit");
            return result;
          } catch (error) {
            db.exec("rollback");
            throw error;
          }
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
