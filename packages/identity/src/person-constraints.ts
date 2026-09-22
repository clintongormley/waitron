/**
 * The `persons` unique indexes this package translates a refusal on, each by the NAME the database
 * reports.
 *
 * **Why a name and not a key.** All three are declared over an EXPRESSION — `lower(email)`,
 * `lower(trim(display_name))`, `lower(pending_email)` — and this engine reports a refusal on such
 * an index as `UNIQUE constraint failed: index '<the index's name>'`: the index's own name, and no
 * columns at all. `constraintTarget` (`packages/db/src/constraint-target.ts`) therefore answers
 * `undefined` for every one of them, so the question a caller can actually ask is `indexViolated`,
 * which asks for the name. The control in the other direction is on `persons` too and is driven in
 * `person-constraints.db.test.ts`: `persons_tenant_google_subject_uq` is over a PLAIN COLUMN and
 * reports `UNIQUE constraint failed: persons.google_subject` — a table and a key and no name — so
 * `indexViolated` is false for it and it comes back raw.
 *
 * **A name here is the migration's, not this file's.** Each value below is the identifier in the
 * `CREATE UNIQUE INDEX` statement `drizzle/0000_baseline.sql` runs (lines 76, 77 and 79), which is
 * generated from the declarations in `schema/persons.ts`. Renaming an index without changing the
 * value here would silently stop a translation: nothing but the database's own words connects the
 * two. What checks the connection is `person-constraints.db.test.ts`, which drives one real
 * collision per index against the migrated database and reads the name back off the refusal.
 *
 * The names still read `tenant`, from the column this repository dropped on 2026-09-14; renaming
 * them is its own slice (`docs/backlog.md`).
 */

/** `UNIQUE (lower(email)) WHERE email IS NOT NULL` — one login address across the venue,
 * case-insensitively, among the people who have one. */
export const PERSONS_EMAIL = "persons_tenant_email_uq";

/** `UNIQUE (lower(trim(display_name))) WHERE status <> 'suspended'` — one live display name, case-
 * and whitespace-insensitively, among the people who can still log in. */
export const PERSONS_LIVE_DISPLAY_NAME = "persons_tenant_live_display_name_uq";

/** `UNIQUE (lower(pending_email)) WHERE pending_email IS NOT NULL` — one unproven replacement
 * address at a time across the venue. */
export const PERSONS_PENDING_EMAIL = "persons_tenant_pending_email_uq";
