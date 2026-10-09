import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  day,
  enumCheck,
  enumType,
  flag,
  id,
  kitchenStations,
  label,
  locations,
  newId,
  table,
  timeOfDay,
} from "@waitron/db";
import { NAMED_DAY_KINDS } from "../named-day-rules.js";
import { departments } from "./service.js";

/**
 * A stored cell is Closed, open all day, or open in periods. "No hours set" and "inherit the
 * standard week" are both stored as no row at all.
 */
export const HOURS_CELL_MODES = ["closed", "all_day", "periods"] as const;
const hoursCellMode = enumType(HOURS_CELL_MODES);

// The owner columns of a cell refer to a department or a station that the SQL cannot tie to the
// cell's venue; the writers in `../hours.ts` resolve each owner within the venue.
export const hoursWeekCells = table(
  "hours_week_cells",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    departmentId: id("department_id"),
    stationId: id("station_id"),
    weekday: count("weekday").notNull(),
    mode: hoursCellMode("mode").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "hours_week_cells_department_fk",
    }),
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "hours_week_cells_station_fk",
    }),
    check("hours_week_cells_weekday_ck", sql`${t.weekday} between 0 and 6`),
    check(
      "hours_week_cells_one_owner_ck",
      sql`(${t.departmentId} is null) <> (${t.stationId} is null)`,
    ),
    check("hours_week_cells_mode_ck", enumCheck(t.mode)),
    uniqueIndex("hours_week_cells_department_day_key")
      .on(t.departmentId, t.weekday)
      .where(sql`${t.departmentId} is not null`),
    uniqueIndex("hours_week_cells_station_day_key")
      .on(t.stationId, t.weekday)
      .where(sql`${t.stationId} is not null`),
  ],
);

export const hoursWeekPeriods = table(
  "hours_week_periods",
  {
    id: id("id").primaryKey(),
    cellId: id("cell_id").notNull(),
    position: count("position").notNull(),
    opensAt: timeOfDay("opens_at").notNull(),
    closesAt: timeOfDay("closes_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.cellId],
      foreignColumns: [hoursWeekCells.id],
      name: "hours_week_periods_cell_fk",
    }).onDelete("cascade"),
    uniqueIndex("hours_week_periods_position_key").on(t.cellId, t.position),
    check("hours_week_periods_distinct_ck", sql`${t.opensAt} <> ${t.closesAt}`),
  ],
);

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

export const specialDateHours = table(
  "special_date_hours",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    specialDateId: id("special_date_id").notNull(),
    departmentId: id("department_id"),
    stationId: id("station_id"),
    mode: hoursCellMode("mode").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.specialDateId],
      foreignColumns: [specialDates.id],
      name: "special_date_hours_date_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "special_date_hours_department_fk",
    }),
    foreignKey({
      columns: [t.stationId],
      foreignColumns: [kitchenStations.id],
      name: "special_date_hours_station_fk",
    }),
    check(
      "special_date_hours_one_owner_ck",
      sql`(${t.departmentId} is null) <> (${t.stationId} is null)`,
    ),
    check("special_date_hours_mode_ck", enumCheck(t.mode)),
    uniqueIndex("special_date_hours_department_key")
      .on(t.specialDateId, t.departmentId)
      .where(sql`${t.departmentId} is not null`),
    uniqueIndex("special_date_hours_station_key")
      .on(t.specialDateId, t.stationId)
      .where(sql`${t.stationId} is not null`),
  ],
);

export const specialDateHoursPeriods = table(
  "special_date_hours_periods",
  {
    id: id("id").primaryKey(),
    cellId: id("cell_id").notNull(),
    position: count("position").notNull(),
    opensAt: timeOfDay("opens_at").notNull(),
    closesAt: timeOfDay("closes_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.cellId],
      foreignColumns: [specialDateHours.id],
      name: "special_date_hours_periods_cell_fk",
    }).onDelete("cascade"),
    uniqueIndex("special_date_hours_periods_position_key").on(t.cellId, t.position),
    check("special_date_hours_periods_distinct_ck", sql`${t.opensAt} <> ${t.closesAt}`),
  ],
);
