import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { type Database, pgErrorCode } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { type MigrationSet, resolveExistingMigrationsFolder } from "./manifest.js";
import "./errors.js";

/** The same guard `appliedSchemaVersion` uses: the table name reaches SQL as TEXT, never a placeholder. */
const DRIZZLE_MIGRATIONS_TABLE = /^__drizzle_migrations_[a-z_]+$/;

/**
 * The migration hashes THIS IMAGE ships for a set, in journal order.
 *
 * Computed by drizzle's own `readMigrationFiles`, never by a local sha256 of our own: the value has
 * to equal what drizzle WROTE into the journal table for a comparison against the database to mean
 * anything, and a second copy of the rule is a second thing to keep in step. (The rule today is
 * sha256 of the whole `.sql` file text — `drizzle-orm@0.45.2/migrator.js` — and
 * `journal-hashes.test.ts` pins that against a hand-computed digest so a change in drizzle fails
 * loudly rather than reporting every migration as unknown.)
 */
export function imageMigrationHashes(set: MigrationSet, root: string | null): string[] {
  const folder = resolveExistingMigrationsFolder(set, root);
  return readMigrationFiles({ migrationsFolder: folder }).map((migration) => migration.hash);
}

/**
 * The migration hashes a DATABASE carries for a set, in application order — or `null` when the set's
 * journal table does not exist.
 *
 * `null`, not `[]`: "never migrated" and "migrated, nothing recorded" are different facts, and a
 * caller comparing against the image's files must not read an absent table as "the database has no
 * migration this image lacks". Any other driver error is rethrown, never swallowed, for the reason
 * `appliedSchemaVersion` gives: a connection failure reported as "no journal" would let a caller
 * conclude a fully-migrated database is virgin.
 *
 * Only `hash` is read. `created_at` is deliberately untouched: it is a `bigint`, which
 * `node-postgres` hands back as a STRING, and drizzle compares only that column when it decides what
 * to apply — so a hash comparison is both the safer arithmetic and the stricter check, catching an
 * EDITED migration file that keeps its `when`.
 */
export async function journalHashes(
  db: Pick<Database, "execute">,
  set: MigrationSet,
): Promise<string[] | null> {
  if (!DRIZZLE_MIGRATIONS_TABLE.test(set.table)) {
    throw new AppError("migrations.invalid_table", { table: set.table });
  }
  try {
    const result = await db.execute<{ hash: string }>(
      sql.raw(`select "hash" from "${set.table}" order by "id"`),
    );
    return result.rows.map((row) => row.hash);
  } catch (error) {
    if (pgErrorCode(error) === "42P01") return null;
    throw error;
  }
}
