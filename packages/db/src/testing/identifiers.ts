/**
 * Identifier validation for the statements `venue-db.ts` builds by hand.
 *
 * Its per-test reset drops every append-only trigger, empties every data table and recreates the
 * triggers from the text SQLite stored — so it interpolates a trigger name into `drop trigger "…"`
 * and a table name into `delete from "…"`, both read back out of `sqlite_master`. SQLite binds no
 * identifier: on Node v26.7.0, `db.prepare('delete from ?')` throws `near "?": syntax error`, and
 * `delete from "?"` is a query against a table literally called `?` (`no such table: ?`), measured
 * 2026-09-22. The name therefore arrives as text or not at all, which leaves the two options
 * `CLAUDE.md` §3 allows: escape, or validate and throw. This file is the second.
 *
 * Validate rather than escape, because every name it sees is one SQLite itself recorded for a
 * schema this package's own migrations created — a name needing an escape is a bug worth failing
 * on. `quoteIdent` is not an option here anyway: `packages/provisioning` owns it and depends on
 * `@waitron/db`, so the import would run the wrong way round.
 */

/** Conservative, and deliberately narrower than SQL allows: what a migrated schema actually names. */
const SAFE_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Returns `value` when it is a safe token; throws naming `kind` and quoting `value` when it is not.
 */
export function assertSafeIdentifier(kind: string, value: string): string {
  if (!SAFE_TOKEN.test(value)) {
    throw new Error(`assertSafeIdentifier: unsafe ${kind} ${JSON.stringify(value)}`);
  }
  return value;
}
