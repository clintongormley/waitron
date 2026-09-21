import { migrate as migrateSqlite } from "drizzle-orm/better-sqlite3/migrator";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { Database } from "./client.js";

export interface MigrationOptions {
  /** Absolute path to a drizzle-kit output folder containing meta/_journal.json. */
  migrationsFolder: string;
  /**
   * The journal table for THIS package. Per-package by design: `packages/db`
   * and `packages/fiscal-verifactu` each generate into their own folder, and a
   * shared journal would interleave their histories so that neither could be
   * replayed alone. Drizzle's default is `__drizzle_migrations`, which is
   * exactly the shared table to avoid — so this option has no default.
   */
  migrationsTable: string;
}

/**
 * Applies one package's migrations.
 *
 * `drizzle-orm/better-sqlite3/migrator` is taken for the engine rather than for that package: its
 * whole body is `db.dialect.migrate(migrations, db.session, config)`, with no `better-sqlite3`
 * import anywhere in it — unlike `drizzle-orm/better-sqlite3`'s index, whose first line imports the
 * compiled module (`packages/store/src/node-sqlite-adapter.ts` records that reading). Drizzle
 * publishes no migrator under a dialect name, so one of the driver modules has to be named.
 *
 * It is synchronous, like everything else on this engine. The `async` signature is kept because
 * every caller awaits it and a caller has no reason to care.
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
