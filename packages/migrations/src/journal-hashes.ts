import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { type Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { type MigrationSetSource, resolveExistingMigrationsFolder } from "./manifest.js";
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
export function imageMigrationHashes(set: MigrationSetSource, root: string | null): string[] {
  const folder = resolveExistingMigrationsFolder(set, root);
  return readMigrationFiles({ migrationsFolder: folder }).map((migration) => migration.hash);
}

/**
 * The migration hashes a DATABASE carries for a set — or `null` when the set's journal table does
 * not exist.
 *
 * `null`, not `[]`: "never migrated" and "migrated, nothing recorded" are different facts, and a
 * caller comparing against the image's files must not read an absent table as "the database has no
 * migration this image lacks". Any driver error is rethrown, never swallowed, for the reason
 * `appliedSchemaVersion` gives: a connection failure reported as "no journal" would let a caller
 * conclude a fully-migrated database is virgin.
 *
 * **The catalogue is asked, rather than a refusal being caught** — the same shape, and for the same
 * reason, as `appliedSchemaVersion` next door. This function caught SQLSTATE `42P01` until
 * 2026-09-22; `node:sqlite` produces no such value, so on this engine the absent table arrived as
 * `no such table: __drizzle_migrations_<set>` with `code: "ERR_SQLITE_ERROR"`, `errcode: 1` — the
 * same three values a syntax error carries — and was RETHROWN. It reached the container
 * entrypoint's ahead check, where a virgin venue directory made every first boot fail with an
 * unclassified driver error.
 *
 * NO `order by`. The hashes are compared as a SET by the only caller (`unknownHashes`), and there
 * is nothing to order by: drizzle creates this table with `id SERIAL PRIMARY KEY`
 * (`drizzle-orm@0.45.2/sqlite-core/dialect.js:646`), and `SERIAL` is not a SQLite type, so the
 * column is an ordinary one with no default — measured through this tree's own handle, every row's
 * `id` is `NULL`. The `order by "id"` that stood here sorted by a constant.
 *
 * Only `hash` is read. `created_at` is deliberately untouched: drizzle compares only that column
 * when it decides what to apply, so a hash comparison is both the safer arithmetic and the stricter
 * check, catching an EDITED migration file that keeps its `when`.
 */
export async function journalHashes(
  db: Pick<Database, "execute">,
  set: MigrationSetSource,
): Promise<string[] | null> {
  if (!DRIZZLE_MIGRATIONS_TABLE.test(set.table)) {
    throw new AppError("migrations.invalid_table", { table: set.table });
  }
  // The table name is a VALUE here, so it binds; it is the `from "<table>"` below that cannot.
  const present = await db.execute<{ n: number }>(
    sql`select cast(count(*) as int) as n from sqlite_master where type = 'table' and name = ${set.table}`,
  );
  if (present.rows[0]!.n === 0) return null;
  const result = await db.execute<{ hash: string }>(sql.raw(`select "hash" from "${set.table}"`));
  return result.rows.map((row) => row.hash);
}
