/**
 * The `persons` unique indexes this package translates a refusal on, each by the NAME the database
 * reports.
 *
 * **Why a name and not a key.** All three are declared over an EXPRESSION — each one a `case`
 * that reads the row's folded column when it has one and falls back to `lower(...)` when it does
 * not (`schema/persons.ts`, `foldedKey`) — and this engine reports a refusal on such an index as
 * `UNIQUE constraint failed: index '<the index's name>'`: the index's own name, and no
 * columns at all. `constraintTarget` (`packages/db/src/constraint-target.ts`) therefore answers
 * `undefined` for every one of them, so the question a caller can actually ask is `indexViolated`,
 * which asks for the name. The control in the other direction is on `persons` too and is driven in
 * `person-constraints.db.test.ts`: `persons_tenant_google_subject_uq` is over a PLAIN COLUMN and
 * reports `UNIQUE constraint failed: persons.google_subject` — a table and a key and no name — so
 * `indexViolated` is false for it and it comes back raw.
 *
 * **A name here is the migration's, not this file's.** Each value below is the identifier in the
 * `CREATE UNIQUE INDEX` statement the migrations run: `drizzle/0000_baseline.sql` created all
 * three, and `drizzle/0001_person_case_fold.sql` dropped and recreated them over the folded
 * columns under the same three names. Both files are generated from the declarations in
 * `schema/persons.ts`. Renaming an index without changing the
 * value here would silently stop a translation: nothing but the database's own words connects the
 * two. What checks the connection is `person-constraints.db.test.ts`, which drives one real
 * collision per index against the migrated database and reads the name back off the refusal.
 *
 * The names still read `tenant`, from the column this repository dropped on 2026-09-14; renaming
 * them is its own slice (`docs/backlog.md`).
 */

/** One login address across the venue, case-insensitively, among the people who have one. Over
 * `case when email_folded is null then lower(email) else email_folded end`, where `email IS NOT
 * NULL`. */
export const PERSONS_EMAIL = "persons_tenant_email_uq";

/** One live display name, case- and whitespace-insensitively, among the people who can still log
 * in. Over `case when display_name_folded is null then lower(trim(display_name)) else
 * display_name_folded end`, where `status <> 'suspended'`. */
export const PERSONS_LIVE_DISPLAY_NAME = "persons_tenant_live_display_name_uq";

/** One unproven replacement address at a time across the venue. Over `case when
 * pending_email_folded is null then lower(pending_email) else pending_email_folded end`, where
 * `pending_email IS NOT NULL`. */
export const PERSONS_PENDING_EMAIL = "persons_tenant_pending_email_uq";
