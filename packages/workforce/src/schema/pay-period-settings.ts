import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { count, day, enumType, enumCheck, table } from "@waitron/db";

export const DEFAULT_CLOSE_GRACE_DAYS = 3;
export const MAX_CLOSE_GRACE_DAYS = 10;

const frequency = enumType(["monthly", "weekly", "fortnightly"]);
export const payPeriodSettings = table(
  "pay_period_settings",
  {
    id: count("id").primaryKey().default(1),
    frequency: frequency("frequency").notNull().default("monthly"),
    anchorDate: day("anchor_date"),
    closeGraceDays: count("close_grace_days").notNull().default(DEFAULT_CLOSE_GRACE_DAYS),
  },
  (t) => [
    check("pay_period_settings_singleton_ck", sql`${t.id} = 1`),
    check("pay_period_settings_frequency_ck", enumCheck(t.frequency)),
    check(
      "pay_period_settings_close_grace_ck",
      sql`typeof(${t.closeGraceDays}) = 'integer' and ${t.closeGraceDays} between 0 and 10`,
    ),
    check(
      "pay_period_settings_anchor_ck",
      sql`(${t.frequency} <> 'fortnightly' and ${t.anchorDate} is null)
    or (${t.frequency} = 'fortnightly' and ${t.anchorDate} is not null
      and date(${t.anchorDate}, '+0 days') is not null
      and date(${t.anchorDate}, '+0 days') = ${t.anchorDate} and strftime('%w', ${t.anchorDate}) = '1')`,
    ),
  ],
);
