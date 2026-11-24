import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { menus } from "../menus.js";
import { enumCheck, enumType, id, json, jsonShapeCheck, label, newId, table } from "../columns.js";
import { floorPlanSets } from "../floor-plans.js";
import { CALENDAR_COLOURS } from "@waitron/shared";
import { departments } from "./service.js";

const calendarColour = enumType(CALENDAR_COLOURS);

/** A department's named period with the menu its zones start on in it. */
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
     * menu_periods.floor_plan_set_id.
     */
    floorPlanSetId: id("floor_plan_set_id").references(() => floorPlanSets.id),
    // JSON has no menu key: writeMenuPeriod checks active choices and duplicates.
    // validateMenuTimetables checks bundle IDs; jsonReferences remaps them on import.
    // Menus are only deactivated.
    staffMenuIds: json<string[]>("staff_menu_ids").notNull().default([]),
    lastOrders: json<
      (
        | { kind: "station"; stationId: string; minutes: number }
        | { kind: "no_preparation"; minutes: number }
      )[]
    >("last_orders")
      .notNull()
      .default([]),
  },
  (t) => [
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "menu_periods_department_fk",
    }),
    foreignKey({
      columns: [t.menuId],
      foreignColumns: [menus.id],
      name: "menu_periods_menu_fk",
    }),
    uniqueIndex("menu_periods_department_name_key").on(t.departmentId, t.name),
    uniqueIndex("menu_periods_department_key").on(t.id, t.departmentId),
    check("menu_periods_name_ck", sql`trim(${t.name}) <> ''`),
    check("menu_periods_colour_ck", enumCheck(t.colour)),
    check("menu_periods_staff_menu_ids_ck", jsonShapeCheck(t.staffMenuIds, "array")),
    check("menu_periods_last_orders_ck", jsonShapeCheck(t.lastOrders, "array")),
  ],
);
