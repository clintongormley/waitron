import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  catalogues,
  count,
  enumCheck,
  enumType,
  id,
  label,
  newId,
  table,
  timeOfDay,
} from "@waitron/db";
import { CALENDAR_COLOURS } from "../hours-types.js";
import { specialDates } from "./hours.js";
import { departments } from "./service.js";

const calendarColour = enumType(CALENDAR_COLOURS);

/** A department's named period, such as "Mañanas", with the menu its zones start on in it. */
export const menuPeriods = table(
  "menu_periods",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    departmentId: id("department_id").notNull(),
    name: label("name").notNull(),
    colour: calendarColour("colour").notNull().default("grey"),
    menuId: id("menu_id").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "menu_periods_department_fk",
    }),
    foreignKey({
      columns: [t.menuId],
      foreignColumns: [catalogues.id],
      name: "menu_periods_menu_fk",
    }),
    uniqueIndex("menu_periods_department_name_key").on(t.departmentId, t.name),
    uniqueIndex("menu_periods_department_key").on(t.id, t.departmentId),
    check("menu_periods_name_ck", sql`trim(${t.name}) <> ''`),
    check("menu_periods_colour_ck", enumCheck(t.colour)),
  ],
);

export const menuPeriodStaffMenus = table(
  "menu_period_staff_menus",
  {
    periodId: id("period_id").notNull(),
    departmentId: id("department_id").notNull(),
    menuId: id("menu_id").notNull(),
    displayOrder: count("display_order").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.periodId, t.menuId], name: "menu_period_staff_menus_pk" }),
    foreignKey({
      columns: [t.periodId, t.departmentId],
      foreignColumns: [menuPeriods.id, menuPeriods.departmentId],
      name: "menu_period_staff_menus_period_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.menuId],
      foreignColumns: [catalogues.id],
      name: "menu_period_staff_menus_menu_fk",
    }),
  ],
);

/**
 * One department's day: a weekday of its week, or a special date that replaces the week for it.
 * A weekday with no row has no slots; a special date with no row for the department follows the
 * week. The SQL cannot tie `department_id` and `special_date_id` to one venue; the writers do.
 */
export const menuDayTimetables = table(
  "menu_day_timetables",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    departmentId: id("department_id").notNull(),
    weekday: count("weekday"),
    specialDateId: id("special_date_id"),
  },
  (t) => [
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "menu_day_timetables_department_fk",
    }),
    foreignKey({
      columns: [t.specialDateId],
      foreignColumns: [specialDates.id],
      name: "menu_day_timetables_date_fk",
    }).onDelete("cascade"),
    check(
      "menu_day_timetables_one_day_ck",
      sql`(${t.weekday} is null) <> (${t.specialDateId} is null)`,
    ),
    check(
      "menu_day_timetables_weekday_ck",
      sql`${t.weekday} is null or ${t.weekday} between 0 and 6`,
    ),
    uniqueIndex("menu_day_timetables_week_key")
      .on(t.departmentId, t.weekday)
      .where(sql`${t.weekday} is not null`),
    uniqueIndex("menu_day_timetables_date_key")
      .on(t.specialDateId, t.departmentId)
      .where(sql`${t.specialDateId} is not null`),
    uniqueIndex("menu_day_timetables_department_key").on(t.id, t.departmentId),
  ],
);

/** A named period placed on one day. Nothing references a slot, so a day's are replaced whole. */
export const menuSlots = table(
  "menu_slots",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    timetableId: id("timetable_id").notNull(),
    departmentId: id("department_id").notNull(),
    periodId: id("period_id").notNull(),
    startsAt: timeOfDay("starts_at").notNull(),
    endsAt: timeOfDay("ends_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.timetableId, t.departmentId],
      foreignColumns: [menuDayTimetables.id, menuDayTimetables.departmentId],
      name: "menu_slots_timetable_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.periodId, t.departmentId],
      foreignColumns: [menuPeriods.id, menuPeriods.departmentId],
      name: "menu_slots_period_fk",
    }),
    check(
      "menu_slots_step_ck",
      sql`substr(${t.startsAt}, 4, 2) in ('00', '15', '30', '45')
      and substr(${t.endsAt}, 4, 2) in ('00', '15', '30', '45')`,
    ),
    index("menu_slots_timetable_idx").on(t.timetableId, t.startsAt),
  ],
);
