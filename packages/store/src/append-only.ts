import { type SQL, sql } from "drizzle-orm";

/** The one thing this module needs from a handle: somewhere to send a statement. */
export interface StatementTarget {
  run: (query: SQL) => unknown;
}

/**
 * A plain SQL identifier. The trigger statements below cannot be parameterised — SQLite will not
 * bind a table name — so the name is checked and refused rather than escaped, which is the shape
 * `CLAUDE.md` §3 asks for when a utility statement has to be built as text.
 */
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** What a caller sees when it tries to change a row that is already written. */
const suffix = "is append-only";

/**
 * Makes every named table refuse an update and a delete, for good.
 *
 * `RAISE(ABORT, …)` in a `BEFORE` trigger stops the statement and rolls back to the enclosing
 * savepoint, so the row the caller tried to change is still the row that was written. The pair of
 * triggers covers four shapes between them, measured on Node v26.7.0 against `node:sqlite`, one
 * real refusal per shape: a plain `UPDATE`, a plain `DELETE`, `INSERT OR REPLACE` (whose internal
 * delete fires the delete trigger) and `INSERT … ON CONFLICT DO UPDATE` (the update trigger).
 * `INSERT` and `INSERT … ON CONFLICT DO NOTHING` are untouched, which is what append-only means.
 *
 * **`PRAGMA recursive_triggers` must be on**, and `packages/store/src/index.ts` turns it on beside
 * `foreign_keys`. Without it the delete `INSERT OR REPLACE` performs internally does not fire a
 * `BEFORE DELETE` trigger and the row is silently rewritten; the other three shapes are refused
 * either way, so a suite that omits the replace case passes while that hole is open.
 *
 * **What this cannot refuse: `DROP TABLE`.** SQLite has no trigger event for it and no `TRUNCATE`
 * statement at all, so the truncate-blocking trigger the PostgreSQL schema carried has no
 * equivalent here. A caller that can issue DDL can drop the table; nothing in the engine stops it.
 *
 * The names come from the caller — the modules' `ledger` classification, assembled at the
 * composition root — so a new ledger table is protected by being classified, with nobody having to
 * remember this function exists.
 *
 * Running it again over a database that already carries the triggers is a no-op, so it can sit on
 * the boot path after migrations rather than in a one-shot install. **Nothing calls it there yet**
 * — the code that knows when migrations finished is still the PostgreSQL one
 * (`packages/migrations/src/apply.ts`), so today the callers are this package's own tests and
 * `scripts/append-only-triggers.test.ts`. `docs/handoffs/2026-09-21-f1-the-flip.md` names the step
 * that owes the wiring.
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
