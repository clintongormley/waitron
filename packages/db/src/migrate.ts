import { migrate as migrateSqlite } from "drizzle-orm/better-sqlite3/migrator";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { Database } from "./client.js";

export interface MigrationOptions {
  /** Absolute path to a drizzle-kit output folder containing meta/_journal.json. */
  migrationsFolder: string;
  /** The journal table for THIS package. */
  migrationsTable: string;
}

/**
 * Applies one package's migrations.
 *
 * `drizzle-orm/better-sqlite3/migrator` is taken for the engine rather than for that package: its
 * whole body is `db.dialect.migrate(migrations, db.session, config)`, with no `better-sqlite3`
 * import anywhere in it. Drizzle publishes no migrator under a dialect name, so one of the driver
 * modules has to be named.
 *
 * Ordering across packages is the caller's responsibility — nothing here enforces that core
 * migrations run before a module's.
 */
export async function runMigrations(db: Database, options: MigrationOptions): Promise<void> {
  // The migrator's parameter is Drizzle's own SQLite database. `Database` is that type plus this
  // repository's two additions, so the cast narrows nothing away; it is here only because the
  // migrator's declared parameter fixes the schema type parameter and ours is the schema barrel.
  migrateSqlite(db as unknown as BaseSQLiteDatabase<"sync", unknown>, {
    migrationsFolder: options.migrationsFolder,
    migrationsTable: options.migrationsTable,
  });
}
