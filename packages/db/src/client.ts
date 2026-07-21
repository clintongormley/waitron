import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Assume } from "drizzle-orm/utils";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;

export type Schema = typeof schema;

/** Which driver is underneath. The one thing `Database` may not erase. */
export type Driver = "pglite" | "postgres";

type RowsOf<TRow> = { rows: TRow[] };

/**
 * The query-result shape shared by both drivers' `execute()`.
 *
 * `drizzle-orm/pg-core`'s own `PgQueryResultHKT` is an abstract placeholder —
 * its `type` field is unconditionally `unknown`, present only so
 * `NodePgQueryResultHKT` and `PgliteQueryResultHKT` each have something to
 * extend. Passing the bare interface as `PgDatabase`'s `TQueryResult` (which
 * typechecks, since every concrete HKT structurally satisfies the abstract
 * one) leaves `type` unresolved, so `execute()` returns `unknown` and
 * `result.rows` fails to typecheck for every caller — caught by
 * `client.test.ts`, whose first assertion reads `result.rows[0]`.
 *
 * The fix is not `NodePgQueryResultHKT` or `PgliteQueryResultHKT`: choosing
 * either would type every `execute()` call as if it always ran under that one
 * driver — `QueryResult`'s `command`/`rowCount`/`oid` fields on a PGlite
 * result that never has them, or the reverse — which is the exact
 * one-driver-only blind spot the shared `Database` type exists to prevent.
 * `{ rows: TRow[] }` is the genuine structural intersection of pg's
 * `QueryResult` and PGlite's `Results`: both drivers' concrete result types
 * are assignable to it, so no cast is needed at either construction site, and
 * neither driver's result is typed as having fields the other cannot produce.
 */
interface SharedQueryResultHKT extends PgQueryResultHKT {
  type: RowsOf<Assume<this["row"], Record<string, unknown>>>;
}

/**
 * The single database type both deployment modes speak.
 *
 * `PgDatabase` is the real supertype of drizzle's `PgliteDatabase` and
 * `NodePgDatabase` — one dialect, two drivers — which is exactly the property
 * spec §3 bought by dropping SQLite. It must be shared, and the alternative
 * (a `PgliteDatabase | NodePgDatabase` union) must be rejected, because every
 * consumer of this type takes either a `Database` or, inside a callback, a
 * `Transaction`, as a parameter: `recordSale(tx, ...)`, `appendToChain(tx,
 * ...)`, `allocateInvoiceNumber(tx, ...)`. A `PgliteDatabase | NodePgDatabase`
 * union would force each of them to narrow on the driver before touching the
 * handle, and the natural way to stop narrowing is a cast — at which point
 * the two targets can diverge, one test suite runs against a type the other
 * never exercises, and the divergence surfaces in a deployment rather than in
 * CI.
 *
 * `Database` and `Transaction` are, deliberately, two distinct types, not one
 * interchangeable with the other: `Transaction` is NOT assignable to
 * `Database`, because it lacks `driver` and `close` — those are attached by
 * `Object.assign` only in `createPgliteDb`/`createPostgresDb`, never on the
 * handle a transaction callback receives. A function that must accept
 * whatever handle it is given, whether that is a top-level connection or an
 * open transaction, wants the explicit union `Database | Transaction`; a
 * later task adding one should reach for that rather than widening either
 * type to cover the other.
 *
 * `close` is added on top of `Database` so teardown is uniform: PGlite
 * closes, a pg Pool ends, and no caller should have to know which.
 */
export type Database = PgDatabase<
  SharedQueryResultHKT,
  Schema,
  ExtractTablesWithRelations<Schema>
> & {
  readonly driver: Driver;
  close(): Promise<void>;
};

/** The handle every write-path function takes. Derived, never hand-written. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Embedded PostgreSQL for the standalone deployment. With no `dataDir` the
 * database is in-memory, which is what every test uses; with one it persists,
 * and that directory is the whole of the backup story in spec §3.
 */
export async function createPgliteDb(dataDir?: string): Promise<Database> {
  const client = dataDir === undefined ? new PGlite() : new PGlite(dataDir);
  await client.waitReady;
  const db = drizzlePglite(client, { schema });
  return Object.assign(db, {
    driver: "pglite" as const,
    close: () => client.close(),
  });
}

/** Pooled real PostgreSQL for the cloud deployment and the Testcontainers suite. */
export async function createPostgresDb(connectionString: string): Promise<Database> {
  const pool = new Pool({ connectionString });
  // node-postgres requires a pool 'error' listener. An error on an IDLE client —
  // a server shutdown, a failover, or a network drop terminating a checked-in
  // connection (SQLSTATE 57P01) — is emitted on the pool, and with no listener
  // Node escalates it to an uncaught exception that crashes the process. The
  // query path surfaces its own errors to the awaiting caller; this handler only
  // concerns idle clients, which the pool discards and replaces on next use.
  // Swallowed rather than logged: the dominant trigger in this repo is a
  // Testcontainers container stopping at test teardown, expected noise rather
  // than a fault — surfacing genuine connection instability belongs to
  // app-level monitoring, not this constructor.
  /* v8 ignore next 2 */
  pool.on("error", () => {});
  // Fail here rather than at the first query: a bad connection string that
  // surfaces inside a transaction looks like a schema fault, not a config one.
  const probe = await pool.connect();
  probe.release();
  const db = drizzlePg(pool, { schema });
  return Object.assign(db, {
    driver: "postgres" as const,
    close: () => pool.end(),
  });
}
