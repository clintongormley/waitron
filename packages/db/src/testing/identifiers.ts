/**
 * Identifier validation for the statements `venue-db.ts` and `schema-conformance.ts` build by hand.
 *
 * SQLite binds no identifier: `db.prepare('delete from ?')` throws `near "?": syntax error`, and
 * `delete from "?"` is a query against a table literally called `?`. The name therefore arrives as
 * text or not at all, which leaves the two options `CLAUDE.md` §3 allows: escape, or validate and
 * throw. This file is the second, because every name it sees is one SQLite itself recorded for a
 * schema a migration created — a name needing an escape is a bug worth failing on.
 */

/** Conservative, and deliberately narrower than SQL allows: what a migrated schema actually names. */
const SAFE_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertSafeIdentifier(kind: string, value: string): string {
  if (!SAFE_TOKEN.test(value)) {
    throw new Error(`assertSafeIdentifier: unsafe ${kind} ${JSON.stringify(value)}`);
  }
  return value;
}
