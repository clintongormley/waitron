import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { day, flag, id, label, newId, table } from "../columns.js";
import type { CalendarColour } from "@waitron/shared";

export const ZONE_PAINT_KINDS = ["closed", "open"] as const;

export const seasons = table(
  "seasons",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    startsOn: label("starts_on").notNull(), // MM-DD
    // No CHECK: adding one rebuilds seasons, and the rebuild's DROP cascades its weeks. Refused by
    // saveSeasons and validateSeasonWeeks instead.
    colour: label("colour").$type<CalendarColour>().notNull().default("grey"),
  },
  (t) => [
    uniqueIndex("seasons_starts_key").on(t.startsOn),
    uniqueIndex("seasons_name_key").on(t.name),
    check("seasons_name_ck", sql`trim(${t.name}) <> ''`),
    check(
      "seasons_starts_on_ck",
      sql`${t.startsOn} glob '[01][0-9]-[0-3][0-9]' and ${t.startsOn} <> '02-29'`,
    ),
  ],
);

export const specialDays = table(
  "special_days",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    name: label("name").notNull(),
    repeatsYearly: flag("repeats_yearly").notNull().default(false),
  },
  (t) => [check("special_days_name_ck", sql`trim(${t.name}) <> ''`)],
);

export const specialDayDates = table(
  "special_day_dates",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    specialDayId: id("special_day_id").notNull(),
    date: day("date").notNull(),
    closedAllDay: flag("closed_all_day").notNull().default(false),
    holidayName: label("holiday_name"),
  },
  (t) => [
    foreignKey({
      columns: [t.specialDayId],
      foreignColumns: [specialDays.id],
      name: "special_day_dates_day_fk",
    }).onDelete("cascade"),
    uniqueIndex("special_day_dates_date_key").on(t.date),
    check(
      "special_day_dates_date_ck",
      sql`${t.date} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
  ],
);
