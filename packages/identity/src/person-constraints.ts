/**
 * The `persons` unique indexes this package translates a refusal on, each by the NAME the database
 * reports. All three are over an expression (`schema/persons.ts`, `foldedKey`), and this engine
 * reports a refusal on such an index as `UNIQUE constraint failed: index '<name>'`, with no
 * columns, so a caller asks `indexViolated` rather than `constraintTarget`.
 *
 * Each value must match the index name the migrations create; renaming an index without changing
 * it here would silently stop a translation. `person-constraints.db.test.ts` drives one real
 * collision per index and reads the name back off the refusal. The names still read `tenant`, from
 * the dropped column; renaming them is its own slice (`docs/backlog.md`).
 */

export const PERSONS_EMAIL = "persons_tenant_email_uq";

export const PERSONS_LIVE_DISPLAY_NAME = "persons_tenant_live_display_name_uq";

export const PERSONS_PENDING_EMAIL = "persons_tenant_pending_email_uq";
