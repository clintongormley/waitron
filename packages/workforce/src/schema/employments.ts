import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";
import { persons } from "./persons.js";

/**
 * The labour relationship — deliberately separate from `persons` (design D1): a contract can end and
 * another begin for the same person, and a finiquito (D3) needs that boundary. Its Slice-2 job is to
 * carry `contracted_minutes_per_week`, the ordinary-jornada baseline the overtime computation
 * subtracts from (art. 35.5: overtime = actual − ordinary jornada). MUTABLE — a contract's terms
 * change and an employment ends by setting `end_date`, never by deleting the row (the time history
 * in `time_entries` must keep its referent) — so the app role holds SELECT, INSERT, UPDATE and no
 * DELETE (drizzle/0003_workforce_d1a_rls.sql), the same shape as `persons`.
 *
 * No `convenio_ref`: the 2026-08-02 plan §3 listed one, but `convenio` is a Spanish token in
 * `SPANISH_WORDS` (Slice 1) that the English-only guard forbids in this generic package, and it has
 * no Slice-2 consumer — the convenio figures live in `convenio_config` (D2, packages/workforce-es).
 * A D2 slice adds an English-named reference column then, if one is needed.
 */
export const employments = pgTable(
  "employments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    personId: uuid("person_id").notNull(),
    /** Ordinary weekly jornada, in minutes — the overtime baseline (art. 35.5). Minutes, not hours,
     * so the projection never carries a fractional-hour rounding error. */
    contractedMinutesPerWeek: integer("contracted_minutes_per_week").notNull(),
    contractType: text("contract_type").notNull(),
    startDate: date("start_date").notNull(),
    /** Null while the employment is current; set on termination (the finiquito boundary, D3). */
    endDate: date("end_date"),
    /** Tenant currency, no currency column (single-currency-per-tenant convention, `sales.total`). */
    payRate: numeric("pay_rate", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => …)`: the thunk makes v8 count a
    // never-invoked arrow as an uncovered function (drizzle-kit resolves it in a separate CLI
    // process, never during vitest run). restrict, not cascade: an employment must not be silently
    // orphaned or discarded by a tenant/person delete.
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "employments_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "employments_person_fk",
    }).onDelete("restrict"),
    index("employments_tenant_id_idx").on(t.tenantId),
    index("employments_tenant_person_idx").on(t.tenantId, t.personId),
    check("employments_contracted_minutes_ck", sql`${t.contractedMinutesPerWeek} >= 0`),
    check("employments_dates_ck", sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
  ],
).enableRLS();
