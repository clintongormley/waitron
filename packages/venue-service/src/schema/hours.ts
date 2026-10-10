import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { day, enumCheck, enumType, flag, id, label, locations, newId, table } from "@waitron/db";
import { NAMED_DAY_KINDS } from "../named-day-rules.js";

export const specialDates = table(
  "special_dates",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    date: day("date").notNull(),
    name: label("name").notNull(),
    kind: enumType(NAMED_DAY_KINDS)("kind").notNull().default("working_day"),
    repeatOn: label("repeat_on"),
    ownHours: flag("own_hours").notNull().default(false),
    closeWholeVenue: flag("close_whole_venue").notNull().default(false),
  },
  (t) => [
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "special_dates_location_fk",
    }),
    uniqueIndex("special_dates_location_date_key").on(t.locationId, t.date),
    check(
      "special_dates_date_ck",
      sql`${t.date} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    check("special_dates_name_ck", sql`trim(${t.name}) <> ''`),
    check("special_dates_kind_ck", enumCheck(t.kind)),
    check(
      "special_dates_repeat_ck",
      sql`${t.repeatOn} is null or ${t.repeatOn} = substr(${t.date}, 6, 5)`,
    ),
    uniqueIndex("special_dates_location_repeat_key")
      .on(t.locationId, t.repeatOn)
      .where(sql`${t.repeatOn} is not null`),
  ],
);
