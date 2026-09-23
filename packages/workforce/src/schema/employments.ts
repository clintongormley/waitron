import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import { count, day, id, label, money, newId, nowIso, table, tsString } from "@waitron/db";
import { persons } from "@waitron/identity";

/**
 * The labour relationship — deliberately separate from `persons` (design D1): a contract can end and
 * another begin for the same person, and a final settlement (D3) needs that boundary. Its Slice-2 job is to
 * carry `contracted_minutes_per_week`, the ordinary-working-time baseline the overtime computation
 * subtracts from (art. 35.5: overtime = actual − ordinary working time). MUTABLE — a contract's terms
 * change and an employment ends by setting `end_date`, never by deleting the row (the time history
 * in `time_entries` must keep its referent). The grant that withheld DELETE went with PostgreSQL, and
 * no foreign key stands in for it — nothing in the schema references `employments` — so the
 * never-delete rule is now the callers', the same shape as `persons`.
 *
 * No `convenio_ref`: the 2026-08-02 plan §3 listed one, but `convenio` is workforce-es's declared
 * vocabulary, which the English-only guard forbids in this generic package, and it has
 * no Slice-2 consumer — the collective-agreement figures live in `convenio_config` (D2, packages/workforce-es).
 * A D2 slice adds an English-named reference column then, if one is needed.
 */
export const employments = table(
  "employments",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    personId: id("person_id").notNull(),
    /** Ordinary weekly working time, in minutes — the overtime baseline (art. 35.5). Minutes, not hours,
     * so the projection never carries a fractional-hour rounding error. */
    contractedMinutesPerWeek: count("contracted_minutes_per_week").notNull(),
    contractType: label("contract_type").notNull(),
    startDate: day("start_date").notNull(),
    /** Null while the employment is current; set on termination (the final-settlement boundary, D3). */
    endDate: day("end_date"),
    /** Tenant currency, no currency column (single-currency-per-tenant convention, `sales.total`). */
    payRate: money("pay_rate").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => …)`: the thunk makes v8 count a
    // never-invoked arrow as an uncovered function (drizzle-kit resolves it in a separate CLI
    // process, never during vitest run). restrict, not cascade: an employment must not be silently
    // orphaned or discarded by a person delete.
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "employments_person_fk",
    }).onDelete("restrict"),
    index("employments_person_idx").on(t.personId),
    check("employments_contracted_minutes_ck", sql`${t.contractedMinutesPerWeek} >= 0`),
    check("employments_dates_ck", sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
  ],
);
