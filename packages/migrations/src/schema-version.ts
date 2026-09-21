import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { type MigrationSet, resolveExistingMigrationsFolder } from "./manifest.js";
import "./errors.js";

/**
 * A drizzle journal table is named by the set's own `table` field — usually `__drizzle_migrations_<name>`
 * but not always (the `core` set's table is `__drizzle_migrations_db`, not `_core`), which is exactly why
 * we read `set.table` rather than deriving it from the name. `set.table` reaches a `count(*) from
 * "<table>"` as TEXT — Postgres binds no
 * placeholder for a relation name (§3) — so it is validated here rather than trusted, and the
 * character class is deliberately tight (`[a-z_]`) so nothing that could need quoting slips through.
 */
const DRIZZLE_MIGRATIONS_TABLE = /^__drizzle_migrations_[a-z_]+$/;

/**
 * The schema version the module's CODE ships — its drizzle journal head, `entries.length` from
 * `<folder>/meta/_journal.json` (equivalently the latest `idx + 1`). A static property of the
 * shipped folder, resolved (and journal-guarded) the same way `migrationOptionsFor` resolves it, via
 * {@link resolveExistingMigrationsFolder}; `root === null` means "running from source".
 *
 * Read synchronously: it is called from planning code, not a hot path, and a journal that cannot be
 * read is a packaging fault that should fail loudly and immediately, not resolve to a wrong number.
 */
export function expectedSchemaVersion(set: MigrationSet, root: string | null): number {
  // Shared with `migrationOptionsFor`: the same journal-existence guard and the same classified
  // `migrations.set_missing`, so a set whose journal is absent fails LOUD here rather than throwing
  // a bare `ENOENT` out of `readFileSync`. (A journal that is PRESENT but unparseable still escapes
  // as a `SyntaxError` — that is a corrupt shipped artefact, not the "set is missing" this code
  // names, and it too fails loud.)
  const folder = resolveExistingMigrationsFolder(set, root);
  const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as {
    entries: unknown[];
  };
  return journal.entries.length;
}

/**
 * The schema version a node's DATABASE has — the row count of the module's drizzle journal table
 * (`set.table`), since drizzle writes exactly one row per applied migration. Returns 0 when the
 * table does not exist yet: an unmigrated module is at version 0, not an error.
 *
 * **The catalogue is asked, rather than a refusal being caught.** On PostgreSQL the absent table
 * arrived as SQLSTATE `42P01` and nothing else did. `node:sqlite` carries no such value: measured
 * on Node v26.7.0 through this tree's own handle, `no such table: __drizzle_migrations_absent`
 * arrives as `code: "ERR_SQLITE_ERROR"`, `errcode: 1`, `errstr: "SQL logic error"` — the SAME three
 * values as `unrecognized token: ":"` and as `no such column: "nope"`, taken as controls in the
 * same run. Only the message text separates them, so a catch would have to match prose. Asking
 * `sqlite_master` answers the question directly, and leaves every error from the count itself to
 * propagate.
 *
 * Any driver error is therefore rethrown, never swallowed as 0 — a closed connection reported as
 * "zero migrations applied" would let a caller conclude a fully-migrated database needs
 * re-migrating.
 */
export async function appliedSchemaVersion(
  db: Pick<Database, "execute">,
  set: MigrationSet,
): Promise<number> {
  if (!DRIZZLE_MIGRATIONS_TABLE.test(set.table)) {
    throw new AppError("migrations.invalid_table", { table: set.table });
  }
  // The table name is a VALUE here, so it binds; it is the `from "<table>"` below that cannot.
  const present = await db.execute<{ n: number }>(
    sql`select cast(count(*) as int) as n from sqlite_master where type = 'table' and name = ${set.table}`,
  );
  if (present.rows[0]!.n === 0) return 0;
  const result = await db.execute<{ n: number }>(
    sql.raw(`select cast(count(*) as int) as n from "${set.table}"`),
  );
  return result.rows[0]!.n;
}
