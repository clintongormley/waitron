import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { tenants, tills } from "./tenants.js";

/**
 * Invoice numbering series.
 *
 * A till may own N series and has exactly ONE chain (findings §1). Nothing
 * here relates a series to a chain: no chain column, and deliberately no
 * unique constraint on (tenant_id, till_id), which would silently reimpose
 * one series per till.
 *
 * `next_number` is the live counter and the single source of truth: a plain
 * integer column, advanced in place by the allocating UPDATE under the row
 * lock that statement takes. There is no sequence and no second copy of the
 * value to drift out of step with it.
 *
 * Allocation is transactional, so a rollback returns the number and no gap
 * appears. That is correct — the regulation requires strictly-increasing and
 * never-reused numbering and permits gaps without requiring them. "Never
 * reused once used" is enforced on `sales` by
 * UNIQUE (tenant_id, series_id, invoice_number), not here.
 */
export const invoiceSeries = pgTable(
  "invoice_series",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The `() => tenants.id` / `() => tills.id` reference thunks below are
    // stored by drizzle-orm and called only when something resolves foreign
    // key metadata (drizzle-kit's own generate/introspection, run in a
    // separate CLI process) — never by ordinary query building, since
    // Postgres enforces the constraint server-side. No test in this suite
    // exercises that resolution path, and — verified live — passing the
    // second `{ onDelete: ... }` argument is what makes v8 track each thunk
    // as its own never-invoked function; the identical one-argument
    // `.references(() => tenants.id)` calls in ./tenants.ts are not tracked as
    // functions at all. `v8 ignore` here, rather than dropping the explicit
    // `onDelete`, keeps the FK behaviour self-documenting.
    tenantId: uuid("tenant_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    tillId: uuid("till_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tills.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    purpose: text("purpose").notNull().default("standard"),
    nextNumber: integer("next_number").notNull().default(1),
  },
  (t) => [
    unique("invoice_series_till_code_key").on(t.tenantId, t.tillId, t.code),
    // Composite target for tenant-consistent foreign keys from `sales`: a
    // child row cannot point at a parent belonging to another tenant.
    unique("invoice_series_tenant_id_key").on(t.tenantId, t.id),
    index("invoice_series_tenant_idx").on(t.tenantId),
    // A CHECK rather than a pgEnum, deliberately: the permitted set depends on
    // asesor Q5(b), which is unverified. Widening a CHECK is one line of
    // migration; widening an enum needs ALTER TYPE.
    check("invoice_series_purpose_ck", sql`${t.purpose} in ('standard', 'rectificative')`),
    check("invoice_series_next_number_ck", sql`${t.nextNumber} >= 1`),
    check("invoice_series_code_ck", sql`${t.code} <> ''`),
  ],
).enableRLS();
