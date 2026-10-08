import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import { count, id, newId, table, timeOfDay } from "@waitron/db";
import { specialDates } from "./hours.js";
import { zoneServicePolicies } from "./service.js";

export const zoneClosedTimes = table(
  "zone_closed_times",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    zoneId: id("zone_id").notNull(),
    weekday: count("weekday"),
    specialDateId: id("special_date_id"),
    startsAt: timeOfDay("starts_at").notNull(),
    endsAt: timeOfDay("ends_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [zoneServicePolicies.zoneId],
      name: "zone_closed_times_zone_fk",
    }),
    foreignKey({
      columns: [t.specialDateId],
      foreignColumns: [specialDates.id],
      name: "zone_closed_times_date_fk",
    }).onDelete("cascade"),
    check(
      "zone_closed_times_one_day_ck",
      sql`(${t.weekday} is null) <> (${t.specialDateId} is null)`,
    ),
    check(
      "zone_closed_times_weekday_ck",
      sql`${t.weekday} is null or ${t.weekday} between 0 and 6`,
    ),
    check(
      "zone_closed_times_step_ck",
      sql`substr(${t.startsAt}, 4, 2) in ('00', '15', '30', '45')
      and substr(${t.endsAt}, 4, 2) in ('00', '15', '30', '45')`,
    ),
    index("zone_closed_times_week_idx").on(t.zoneId, t.weekday),
    index("zone_closed_times_date_idx").on(t.specialDateId, t.zoneId),
  ],
);
