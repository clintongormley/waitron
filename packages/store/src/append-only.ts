import { type SQL, sql } from "drizzle-orm";

/** The one thing this module needs from a handle: somewhere to send a statement. */
export interface StatementTarget {
  run: (query: SQL) => unknown;
}

/**
 * The trigger statements below cannot be parameterised — SQLite will not bind a table name — so
 * the name is checked and refused rather than escaped.
 */
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** What a caller sees when it tries to change a row that is already written. */
const suffix = "is append-only";

/**
 * Makes every named table refuse an update and a delete, for good.
 *
 * `RAISE(ABORT, …)` in a `BEFORE` trigger backs out the STATEMENT it refused and nothing else: the
 * enclosing transaction stays open and usable, and earlier writes inside a savepoint are not rolled
 * back (measured on Node v26.7.0: a marker row written inside a savepoint, before an update that
 * this trigger refuses, is still there afterwards) — confining those is the savepoint's job. The
 * pair of triggers covers four shapes between them: a plain `UPDATE`, a plain `DELETE`,
 * `INSERT OR REPLACE` (whose internal delete fires the delete trigger) and
 * `INSERT … ON CONFLICT DO UPDATE` (the update trigger). Measured on Node v26.7.0 against
 * `node:sqlite`, one real refusal per shape. `INSERT` and `INSERT … ON CONFLICT DO NOTHING` are
 * untouched, which is what append-only means.
 *
 * **`PRAGMA recursive_triggers` must be on**, and `packages/store/src/index.ts` turns it on beside
 * `foreign_keys`. Without it the delete `INSERT OR REPLACE` performs internally does not fire a
 * `BEFORE DELETE` trigger and the row is silently rewritten; the other three shapes are refused
 * either way, so a suite that omits the replace case passes while that hole is open.
 *
 * **What this cannot refuse: `DROP TABLE`.** SQLite has no trigger event for it (and no
 * `TRUNCATE` statement at all). A caller that can issue DDL can drop the table; nothing in the
 * engine stops it.
 *
 * The names come from the caller: the tables a module declared with `appendOnly()`
 * (`@waitron/sync-enrolment`), carried set by set through `MigrationSet.appendOnlyTables` — NOT
 * every `ledger` table (`ClassifiedTable.appendOnly` says why). Running it again over a database
 * that already carries the triggers is a no-op.
 */
export function installAppendOnlyTriggers(
  target: StatementTarget,
  tables: readonly string[],
): void {
  for (const table of tables) {
    if (!PLAIN_IDENTIFIER.test(table)) {
      throw new Error(`append-only trigger: ${table} is not a plain table name`);
    }
    for (const event of ["update", "delete"] as const) {
      target.run(
        sql.raw(
          `create trigger if not exists "${table}_append_only_${event}" ` +
            `before ${event} on "${table}" for each row ` +
            `begin select raise(abort, '${table} ${suffix}'); end`,
        ),
      );
    }
  }
}
