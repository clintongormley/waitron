import { openVenueStore, type NodeSqliteDatabase, type StoreHandle } from "@waitron/store";
import * as schema from "./schema/index.js";

export type Schema = typeof schema;

/**
 * The handle every write-path function takes.
 *
 * Drizzle over one SQLite file, and nothing else: no `close`, and no `withWriteLock`. A function
 * given one of these can read and write, and cannot decide when the transaction around it ends —
 * which is the convention `CLAUDE.md` §3 states, that a write-path function takes a `tx` and never
 * opens its own.
 *
 * It is a naming convention rather than a compiler guarantee, exactly as it was on PostgreSQL:
 * {@link Database} is assignable to this type, because a `Database` is a `Transaction` with two
 * more properties. What has changed is the direction the leak runs. Before the storage switch the
 * handle a transaction callback received was a genuinely different object, so passing a
 * `Transaction` where a `Database` was wanted failed to compile. Now `withTransaction` hands the
 * caller's body the SAME handle it was given — SQLite has one connection per file and the
 * transaction is a `begin` on it, not a second session — so a body that kept its `tx` could call
 * `withWriteLock` on it at runtime. Nothing does; the type is what says it must not.
 */
export type Transaction = NodeSqliteDatabase<Schema>;

/**
 * One open database file: a {@link Transaction} plus the two things that belong to the FILE rather
 * than to a query — the write lock every transaction goes through, and closing it.
 *
 * `driver` is gone. It existed so `runMigrations` could pick between two PostgreSQL migrators;
 * there is one engine now, and the tag would only be a name for it.
 */
export type Database = StoreHandle<Schema>;

/** This node's two open files. */
export interface VenueDatabase {
  /** Every table classified `ledger` or `state`: what the venue did, and how it is configured. */
  venue: Database;
  /** Every table classified `local`: this node's identity, sessions, pairing codes, keys. */
  node: Database;
  /** Closes both files. */
  close(): Promise<void>;
}

/**
 * Opens this node's two database files under `directory`.
 *
 * **Both handles are typed on the whole schema barrel, and that is deliberate.** The barrel is one
 * flat namespace, and splitting it in two would rewrite every import in the tree for a type-level
 * distinction. What actually keeps a table on one side of the split is the migration set that
 * created it, so a query naming a venue table on the node handle finds no such table and is
 * refused by the engine rather than by the compiler. The FILE is the boundary; the schema object
 * is the relational-query map. A later task that wants the compiler to hold this line too would
 * split the barrel, not this function.
 */
export async function openVenueDatabase(directory: string): Promise<VenueDatabase> {
  const store = await openVenueStore({ directory, venueSchema: schema, nodeSchema: schema });
  return { venue: store.venue, node: store.node, close: store.close };
}
