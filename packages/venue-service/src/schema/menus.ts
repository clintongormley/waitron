import { sql } from "drizzle-orm";
import { check, foreignKey, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  catalogues,
  count,
  enumCheck,
  enumType,
  floorPlanSets,
  id,
  label,
  newId,
  table,
} from "@waitron/db";
import { CALENDAR_COLOURS } from "../hours-types.js";
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
    /**
     * A set of this period's own department. The key names core's floor_plan_sets, so the
     * database takes any department's set; the period routes refuse another department's with
     * menu_period.invalid (floorPlanSetId) and the configuration import with
     * menu_periods.floor_plan_set_id. A composite key to department_floor_plan_sets would rebuild
     * menu_periods, whose rebuild empties menu_period_staff_menus (its key cascades).
     */
    floorPlanSetId: id("floor_plan_set_id").references(() => floorPlanSets.id),
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
