import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Database, Schema } from "./client.js";

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
 * Drizzle ships a separate migrator per driver and no dialect-level one, so
 * this dispatches on the driver tag the client attached. That tag is the sole
 * reason `Database` carries `driver` at all: it confines driver knowledge to
 * this one function instead of leaking a union type through every consumer.
 *
 * Ordering across packages is the caller's responsibility — nothing here
 * enforces that core migrations run before a module's.
 */
export async function runMigrations(db: Database, options: MigrationOptions): Promise<void> {
  const config = {
    migrationsFolder: options.migrationsFolder,
    migrationsTable: options.migrationsTable,
    // Drizzle's own default is the "drizzle" schema, not "public" — undocumented
    // in MigrationConfig's JSDoc, and easy to miss because it doesn't surface as
    // an error: the journal table is created successfully, just outside the
    // default search_path, so an unqualified lookup like `to_regclass` or a
    // plain `select from "table"` reports it as absent. Hardcoded to "public"
    // rather than exposed as a caller option, matching the one schema
    // `drizzle.config.ts` already fixes for this project's generated migrations.
    migrationsSchema: "public",
  };
  if (db.driver === "pglite") {
    await migratePglite(db as unknown as PgliteDatabase<Schema>, config);
    return;
  }
  await migratePg(db as unknown as NodePgDatabase<Schema>, config);
}
