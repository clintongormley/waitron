import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { count, day, enumType, enumCheck, table } from "@waitron/db";

const frequency = enumType(["monthly", "weekly", "fortnightly"]);
export const payPeriodSettings = table(
  "pay_period_settings",
  {
    id: count("id").primaryKey().default(1),
    frequency: frequency("frequency").notNull().default("monthly"),
    anchorDate: day("anchor_date"),
  },
  (t) => [
    check("pay_period_settings_singleton_ck", sql`${t.id} = 1`),
    check("pay_period_settings_frequency_ck", enumCheck(t.frequency)),
    check(
      "pay_period_settings_anchor_ck",
      sql`(${t.frequency} <> 'fortnightly' and ${t.anchorDate} is null)
    or (${t.frequency} = 'fortnightly' and ${t.anchorDate} is not null
      and date(${t.anchorDate}, '+0 days') is not null
      and date(${t.anchorDate}, '+0 days') = ${t.anchorDate} and strftime('%w', ${t.anchorDate}) = '1')`,
    ),
  ],
);
