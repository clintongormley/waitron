import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { day, table, timeOfDay } from "./columns.js";

export const dayCutoverChanges = table(
  "day_cutover_changes",
  {
    effectiveBusinessDay: day("effective_business_day").primaryKey(),
    dayCutover: timeOfDay("day_cutover").notNull(),
  },
  (t) => [
    check(
      "day_cutover_changes_date_ck",
      sql`length(${t.effectiveBusinessDay}) = 10 and ${t.effectiveBusinessDay} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    check(
      "day_cutover_changes_time_ck",
      sql`length(${t.dayCutover}) = 8 and ${t.dayCutover} glob '[0-2][0-9]:[0-5][0-9]:00' and substr(${t.dayCutover}, 1, 2) <= '23'`,
    ),
  ],
);
