import { sql } from "drizzle-orm";
import { check, primaryKey } from "drizzle-orm/sqlite-core";
import { count, day, id, table, timeOfDay } from "./columns.js";
import { locations } from "./tenants.js";

export const locationBusinessDaySettings = table(
  "location_business_day_settings",
  {
    locationId: id("location_id")
      .primaryKey()
      .references(() => locations.id),
    revision: count("revision").notNull(),
  },
  (t) => [
    check(
      "location_business_day_settings_revision_ck",
      sql`typeof(${t.revision}) = 'integer' and ${t.revision} >= 0`,
    ),
  ],
);

export const locationDayCutoverChanges = table(
  "location_day_cutover_changes",
  {
    locationId: id("location_id")
      .notNull()
      .references(() => locations.id),
    effectiveBusinessDay: day("effective_business_day").notNull(),
    dayCutover: timeOfDay("day_cutover").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.locationId, t.effectiveBusinessDay] }),
    check(
      "location_day_cutover_changes_date_ck",
      sql`length(${t.effectiveBusinessDay}) = 10 and ${t.effectiveBusinessDay} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    check(
      "location_day_cutover_changes_time_ck",
      sql`length(${t.dayCutover}) = 8 and ${t.dayCutover} glob '[0-2][0-9]:[0-5][0-9]:00' and substr(${t.dayCutover}, 1, 2) <= '23'`,
    ),
  ],
);
