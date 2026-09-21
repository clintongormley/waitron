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
 * no columns at all. Driven on node:sqlite (Node v26.7.0) against the three index statements
 * `drizzle/0000_baseline.sql` generates, one real collision each (probe
 * /tmp/f1-persons-uq-probe.mjs, re-run 2026-09-21): every one answered errcode 2067 and
 * `UNIQUE constraint failed: index '<the index's name>'`. The control in the other direction, on
 * the same table in the same probe, is the PRIMARY KEY — a plain column, not an expression — which
 * answered errcode 1555 and `UNIQUE constraint failed: persons.id`, the shape that DOES carry a
 * key. `constraintTarget` in `packages/db/src/constraint-target.ts` returns `undefined` for the
 * expression form, so every caller comparing against these three sees no match.
 *
 * The values below therefore keep the spelling PostgreSQL used, `btrim` included. Restating them in
 * SQLite's words would change nothing an engine can answer and would read like a repair: a matcher
 * nothing can ever equal is not made reachable by rewording it. Whoever moves the callers to a
 * mechanism SQLite can answer owns replacing them; the storage swap's plan records the work.
 */

/** `persons_tenant_email_uq`: UNIQUE (lower(email)) WHERE email IS NOT NULL — one login address
 * across the venue, case-insensitively. Declared in `schema/persons.ts`. */
export const PERSONS_EMAIL: ConstraintTarget = {
  table: "persons",
  columns: ["lower(email)"],
};

/** `persons_tenant_live_display_name_uq`: UNIQUE (lower(trim(display_name))) WHERE status <>
 * 'suspended' — one live display name, case- and whitespace-insensitively. Declared in
 * `schema/persons.ts:82`; the value below keeps PostgreSQL's `btrim`, for the reason above. */
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
