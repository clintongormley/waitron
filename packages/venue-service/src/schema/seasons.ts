import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  day,
  enumCheck,
  enumType,
  flag,
  id,
  label,
  locations,
  newId,
  table,
  timeOfDay,
} from "@waitron/db";
import { menuPeriods } from "./menus.js";
import { departments, zoneServicePolicies } from "./service.js";

export const ZONE_PAINT_KINDS = ["closed", "open"] as const;

export const seasons = table(
  "seasons",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id").notNull(),
    name: label("name").notNull(),
    startsOn: label("starts_on").notNull(), // MM-DD
  },
  (t) => [
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "seasons_location_fk",
    }),
    uniqueIndex("seasons_location_starts_key").on(t.locationId, t.startsOn),
    uniqueIndex("seasons_location_name_key").on(t.locationId, t.name),
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
    locationId: id("location_id").notNull(),
    name: label("name").notNull(),
    repeatsYearly: flag("repeats_yearly").notNull().default(false),
  },
  (t) => [
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "special_days_location_fk",
    }),
    check("special_days_name_ck", sql`trim(${t.name}) <> ''`),
  ],
);

export const specialDayDates = table(
  "special_day_dates",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    specialDayId: id("special_day_id").notNull(),
    locationId: id("location_id").notNull(),
    date: day("date").notNull(),
    closedAllDay: flag("closed_all_day").notNull().default(false),
  },
  (t) => [
    foreignKey({
      columns: [t.specialDayId],
      foreignColumns: [specialDays.id],
      name: "special_day_dates_day_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "special_day_dates_location_fk",
    }),
    uniqueIndex("special_day_dates_location_date_key").on(t.locationId, t.date),
    check(
      "special_day_dates_date_ck",
      sql`${t.date} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
  ],
);

export const departmentDays = table(
  "department_days",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    departmentId: id("department_id").notNull(),
    seasonId: id("season_id"),
    weekday: count("weekday"), // 0 = Sunday, as weekdayOf
    specialDayDateId: id("special_day_date_id"),
  },
  (t) => [
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "department_days_department_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.seasonId],
      foreignColumns: [seasons.id],
      name: "department_days_season_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.specialDayDateId],
      foreignColumns: [specialDayDates.id],
      name: "department_days_date_fk",
    }).onDelete("cascade"),
    check(
      "department_days_one_day_ck",
      sql`(${t.seasonId} is null) <> (${t.specialDayDateId} is null) and (${t.seasonId} is null) = (${t.weekday} is null)`,
    ),
    check("department_days_weekday_ck", sql`${t.weekday} is null or ${t.weekday} between 0 and 6`),
    uniqueIndex("department_days_season_key")
      .on(t.departmentId, t.seasonId, t.weekday)
      .where(sql`${t.seasonId} is not null`),
    uniqueIndex("department_days_date_key")
      .on(t.departmentId, t.specialDayDateId)
      .where(sql`${t.specialDayDateId} is not null`),
    // The target of department_day_ranges' composite key (a key with no unique index is refused
    // at the first write, CLAUDE.md §3).
    uniqueIndex("department_days_department_key").on(t.id, t.departmentId),
  ],
);

export const departmentDayRanges = table(
  "department_day_ranges",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    dayId: id("day_id").notNull(),
    departmentId: id("department_id").notNull(),
    periodId: id("period_id"), // null: Closed, written on special-day dates only (the writers check)
    startsAt: timeOfDay("starts_at").notNull(),
    endsAt: timeOfDay("ends_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.dayId, t.departmentId],
      foreignColumns: [departmentDays.id, departmentDays.departmentId],
      name: "department_day_ranges_day_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.periodId, t.departmentId],
      foreignColumns: [menuPeriods.id, menuPeriods.departmentId],
      name: "department_day_ranges_period_fk",
    }),
    check(
      "department_day_ranges_step_ck",
      sql`substr(${t.startsAt}, 4, 2) in ('00', '15', '30', '45') and substr(${t.endsAt}, 4, 2) in ('00', '15', '30', '45')`,
    ),
    index("department_day_ranges_day_idx").on(t.dayId, t.startsAt),
  ],
);

export const zoneDays = table(
  "zone_days",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    zoneId: id("zone_id").notNull(),
    seasonId: id("season_id"),
    weekday: count("weekday"), // 0 = Sunday, as weekdayOf
    specialDayDateId: id("special_day_date_id"),
  },
  (t) => [
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [zoneServicePolicies.zoneId],
      name: "zone_days_zone_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.seasonId],
      foreignColumns: [seasons.id],
      name: "zone_days_season_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.specialDayDateId],
      foreignColumns: [specialDayDates.id],
      name: "zone_days_date_fk",
    }).onDelete("cascade"),
    check(
      "zone_days_one_day_ck",
      sql`(${t.seasonId} is null) <> (${t.specialDayDateId} is null) and (${t.seasonId} is null) = (${t.weekday} is null)`,
    ),
    check("zone_days_weekday_ck", sql`${t.weekday} is null or ${t.weekday} between 0 and 6`),
    uniqueIndex("zone_days_season_key")
      .on(t.zoneId, t.seasonId, t.weekday)
      .where(sql`${t.seasonId} is not null`),
    uniqueIndex("zone_days_date_key")
      .on(t.zoneId, t.specialDayDateId)
      .where(sql`${t.specialDayDateId} is not null`),
  ],
);

export const zoneDayRanges = table(
  "zone_day_ranges",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    dayId: id("day_id").notNull(),
    // "open" only on special-day dates (the writers check).
    kind: enumType(ZONE_PAINT_KINDS)("kind").notNull().default("closed"),
    startsAt: timeOfDay("starts_at").notNull(),
    endsAt: timeOfDay("ends_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.dayId],
      foreignColumns: [zoneDays.id],
      name: "zone_day_ranges_day_fk",
    }).onDelete("cascade"),
    check("zone_day_ranges_kind_ck", enumCheck(t.kind)),
    check(
      "zone_day_ranges_step_ck",
      sql`substr(${t.startsAt}, 4, 2) in ('00', '15', '30', '45') and substr(${t.endsAt}, 4, 2) in ('00', '15', '30', '45')`,
    ),
    index("zone_day_ranges_day_idx").on(t.dayId, t.startsAt),
  ],
);
