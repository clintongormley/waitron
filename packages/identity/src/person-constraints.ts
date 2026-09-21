import type { ConstraintTarget } from "@waitron/db";

/**
 * The `persons` keys this package translates a refusal on, each as the table and columns the
 * database reports rather than the index's name.
 *
 * A column here is the expression the index is declared over, spelled the way PostgreSQL rendered it
 * into the refusal's detail. Each of the three below was read back off a real refusal driven through
 * a real PostgreSQL in `persons.constraint-target.pg.test.ts`, which fails if a rendering differs
 * from what is written here.
 *
 * **None of the three can match on SQLite**, and the reason is the engine's, not this file's: all
 * three indexes are over an EXPRESSION, and SQLite's refusal for one of those names the INDEX and
 * no columns at all — `UNIQUE constraint failed: index 'persons_tenant_email_uq'`, driven on
 * node:sqlite (Node v26.7.0), probe /tmp/f1-ddl-probe/persons-uniques.mjs. `constraintTarget` in
 * `packages/db/src/constraint-target.ts` returns `undefined` for such a message, so every caller
 * comparing against these three sees no match. Whoever moves the callers to a mechanism SQLite can
 * answer owns replacing these values; the storage swap's plan records the work.
 */

/** `persons_tenant_email_uq`: UNIQUE (lower(email)) WHERE email IS NOT NULL — one login address
 * across the venue, case-insensitively. Declared in `schema/persons.ts`. */
export const PERSONS_EMAIL: ConstraintTarget = {
  table: "persons",
  columns: ["lower(email)"],
};

/** `persons_tenant_live_display_name_uq`: UNIQUE (lower(btrim(display_name))) WHERE status <>
 * 'suspended' — one live display name, case- and whitespace-insensitively. Declared in
 * `schema/persons.ts`, where SQLite spells `btrim` as `trim`. */
export const PERSONS_LIVE_DISPLAY_NAME: ConstraintTarget = {
  table: "persons",
  columns: ["lower(btrim(display_name))"],
};

/** `persons_tenant_pending_email_uq`: UNIQUE (lower(pending_email)) WHERE pending_email IS NOT NULL
 * — one unproven replacement address at a time across the venue. Declared in `schema/persons.ts`. */
export const PERSONS_PENDING_EMAIL: ConstraintTarget = {
  table: "persons",
  columns: ["lower(pending_email)"],
};
