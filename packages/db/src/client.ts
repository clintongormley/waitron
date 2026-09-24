import {
  lockVenueDirectory,
  openVenueStore,
  VenueInUseError,
  type NodeSqliteDatabase,
  type StoreHandle,
  type VenueLock,
} from "@waitron/store";
import { AppError } from "@waitron/shared";
import * as schema from "./schema/index.js";
import "./errors.js";

export type { VenueLock } from "@waitron/store";

export interface OpenVenueOptions {
  /**
   * False for a short-lived tool documented to run beside a running server: it takes no lock on the
   * folder. Default true.
   */
  readonly exclusive?: boolean;
}

export type Schema = typeof schema;

/**
 * The handle every write-path function takes.
 *
 * Drizzle over one SQLite file, and nothing else: no `close`, and no `withWriteLock`. A function
 * given one of these can read and write, and cannot decide when the transaction around it ends.
 *
 * It is a naming convention rather than a compiler guarantee: {@link Database} is assignable to
 * this type, and `withTransaction` hands the caller's body the SAME handle it was given, so a body
 * that kept its `tx` could call `withWriteLock` on it at runtime. Nothing does; the type is what
 * says it must not.
 */
export type Transaction = NodeSqliteDatabase<Schema>;

/**
 * One open database file: a {@link Transaction} plus the two things that belong to the FILE rather
 * than to a query — the write lock every transaction goes through, and closing it.
 */
export type Database = StoreHandle<Schema>;

/** This node's two open files. */
export interface VenueDatabase {
  /** `venue.db`, which every migration set is applied to (`packages/migrations/src/apply.ts`). */
  venue: Database;
  /** `node.db`, which no migration set is applied to; reserved for a later slice. */
  node: Database;
  /** Closes both files. */
  close(): Promise<void>;
}

/**
 * Opens this node's two database files under `directory`.
 *
 * **Both handles are typed on the whole schema barrel, and that is deliberate.** What keeps a table
 * on one side of the split is the migration set that created it, so a query naming a venue table on
 * the node handle finds no such table and is refused by the engine rather than by the compiler.
 */
export async function openVenueDatabase(
  directory: string,
  options: OpenVenueOptions = {},
): Promise<VenueDatabase> {
  const store = await inUseAsAppError(directory, () =>
    openVenueStore({
      directory,
      venueSchema: schema,
      nodeSchema: schema,
      exclusive: options.exclusive,
    }),
  );
  return { venue: store.venue, node: store.node, close: store.close };
}

/**
 * Holds the venue folder without opening it, for a command that changes the folder's files and
 * must be refused before it changes anything while another process holds the folder. Opens inside the same process
 * share the hold.
 */
export function lockVenueDatabase(directory: string): Promise<VenueLock> {
  return inUseAsAppError(directory, () => lockVenueDirectory(directory));
}

async function inUseAsAppError<T>(directory: string, open: () => Promise<T>): Promise<T> {
  try {
    return await open();
  } catch (error) {
    if (error instanceof VenueInUseError) {
      throw new AppError("provisioning.database_in_use", { database: directory });
    }
    throw error;
  }
}
