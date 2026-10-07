import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { catalogues, count, floorZones, id, label, newId, table, timeOfDay } from "@waitron/db";
import { specialDates } from "./hours.js";
import { departments } from "./service.js";

/** The menus every zone of a department may sell from, in the department's order. */
export const departmentMenus = table(
  "department_menus",
  {
    departmentId: id("department_id").notNull(),
    menuId: id("menu_id").notNull(),
    displayOrder: count("display_order").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.departmentId, t.menuId], name: "department_menus_pk" }),
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "department_menus_department_fk",
    }),
    foreignKey({
      columns: [t.menuId],
      foreignColumns: [catalogues.id],
      name: "department_menus_menu_fk",
    }),
    // Not unique: two of a department's rows share a position only when one was given explicitly
    // (`addDepartmentMenu`'s `displayOrder`, or an imported row); readers order a tie by menu id.
    index("department_menus_order_idx").on(t.departmentId, t.displayOrder),
  ],
);

/** The menu a department's zones start on outside any timed period; no row means none is set. */
export const departmentAllDayMenus = table(
  "department_all_day_menus",
  {
    departmentId: id("department_id").primaryKey(),
    menuId: id("menu_id").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.departmentId, t.menuId],
      foreignColumns: [departmentMenus.departmentId, departmentMenus.menuId],
      name: "department_all_day_menus_member_fk",
    }),
  ],
);

/**
 * A zone's own all-day menu in place of its department's; no row inherits the department's. The
 * key ties the menu to `department_id`'s list but not `department_id` to the zone's department:
 * every writer and the import check that, and `configureZone` deletes the row when the zone moves.
 */
export const zoneAllDayMenus = table(
  "zone_all_day_menus",
  {
    zoneId: id("zone_id").primaryKey(),
    departmentId: id("department_id").notNull(),
    menuId: id("menu_id").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "zone_all_day_menus_zone_fk",
    }),
    foreignKey({
      columns: [t.departmentId, t.menuId],
      foreignColumns: [departmentMenus.departmentId, departmentMenus.menuId],
      name: "zone_all_day_menus_member_fk",
    }),
  ],
);

/** A department's named period, such as "Mañanas", with the menu its zones start on in it. */
export const menuPeriods = table(
  "menu_periods",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    departmentId: id("department_id").notNull(),
    name: label("name").notNull(),
    menuId: id("menu_id").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "menu_periods_department_fk",
    }),
    foreignKey({
      columns: [t.departmentId, t.menuId],
      foreignColumns: [departmentMenus.departmentId, departmentMenus.menuId],
      name: "menu_periods_member_fk",
    }),
    uniqueIndex("menu_periods_department_name_key").on(t.departmentId, t.name),
    // The target of the keys that tie a slot's or a zone menu's department to its period's.
    uniqueIndex("menu_periods_department_key").on(t.id, t.departmentId),
    check("menu_periods_name_ck", sql`trim(${t.name}) <> ''`),
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
    check("menu_slots_distinct_ck", sql`${t.startsAt} <> ${t.endsAt}`),
    index("menu_slots_timetable_idx").on(t.timetableId, t.startsAt),
  ],
);

/**
 * A zone's own menu for one named period, wherever the period is placed. The keys tie the menu to
 * the period's department but not that department to the zone's: every writer and the import check
 * it, and `configureZone` deletes the row when the zone moves.
 */
export const zonePeriodMenus = table(
  "zone_period_menus",
  {
    zoneId: id("zone_id").notNull(),
    periodId: id("period_id").notNull(),
    departmentId: id("department_id").notNull(),
    menuId: id("menu_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.zoneId, t.periodId], name: "zone_period_menus_pk" }),
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [floorZones.id],
      name: "zone_period_menus_zone_fk",
    }),
    foreignKey({
      columns: [t.periodId, t.departmentId],
      foreignColumns: [menuPeriods.id, menuPeriods.departmentId],
      name: "zone_period_menus_period_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.departmentId, t.menuId],
      foreignColumns: [departmentMenus.departmentId, departmentMenus.menuId],
      name: "zone_period_menus_member_fk",
    }),
  ],
);
