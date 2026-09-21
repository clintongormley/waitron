import type { ConstraintTarget } from "@waitron/db";

/**
 * The `persons` keys this package translates a refusal on, each as the table and columns the
 * database reports rather than the index's name.
 *
 * A column here is the expression the index is declared over, spelled the way PostgreSQL renders it
 * into the refusal's detail. Each of the three below was read back off a real refusal driven through
 * a real PostgreSQL in `persons.constraint-target.pg.test.ts`, which fails if a rendering differs
 * from what is written here.
 */

/** `persons_tenant_email_uq`: UNIQUE (lower(email)) WHERE email IS NOT NULL — one login address
 * across the venue, case-insensitively. `packages/identity/drizzle/0001_identity_baseline_sql.sql:48`. */
export const PERSONS_EMAIL: ConstraintTarget = {
  table: "persons",
  columns: ["lower(email)"],
};

/** `persons_tenant_live_display_name_uq`: UNIQUE (lower(btrim(display_name))) WHERE status <>
 * 'suspended' — one live display name, case- and whitespace-insensitively.
 * `packages/identity/drizzle/0001_identity_baseline_sql.sql:53`. */
export const PERSONS_LIVE_DISPLAY_NAME: ConstraintTarget = {
  table: "persons",
  columns: ["lower(btrim(display_name))"],
};

/** `persons_tenant_pending_email_uq`: UNIQUE (lower(pending_email)) WHERE pending_email IS NOT NULL
 * — one unproven replacement address at a time across the venue.
 * `packages/identity/drizzle/0000_identity_baseline.sql:129`. */
export const PERSONS_PENDING_EMAIL: ConstraintTarget = {
  table: "persons",
  columns: ["lower(pending_email)"],
};
