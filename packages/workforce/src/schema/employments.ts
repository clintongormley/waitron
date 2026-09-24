import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import { count, day, id, label, money, newId, nowIso, table, tsString } from "@waitron/db";
import { persons } from "@waitron/identity";

/**
 * The labour relationship, separate from `persons` because a contract can end and another begin for
 * the same person. An employment ends by setting `end_date`, never by deleting the row; nothing in
 * the database refuses the delete, so that rule is the callers'.
 */
export const employments = table(
  "employments",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    personId: id("person_id").notNull(),
    /** Ordinary weekly working time — the overtime baseline (art. 35.5). */
    contractedMinutesPerWeek: count("contracted_minutes_per_week").notNull(),
    contractType: label("contract_type").notNull(),
    startDate: day("start_date").notNull(),
    /** Null while the employment is current. */
    endDate: day("end_date"),
    payRate: money("pay_rate").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
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
