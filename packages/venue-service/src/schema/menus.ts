import { foreignKey, index, primaryKey } from "drizzle-orm/sqlite-core";
import { catalogues, count, floorZones, id, table } from "@waitron/db";
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
    // Not unique: a list write upserts each row where it stands, so two rows share a position
    // midway through a reorder.
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
