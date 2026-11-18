import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey } from "drizzle-orm/sqlite-core";
import { count, id, newId, table } from "../columns.js";
import { kitchenCourses } from "../kitchen-courses.js";
import { menus, products } from "../menus.js";
import { menuItems } from "./menu.js";

// The menu write paths ensure lines and dish settings belong to a set menu.
export const setMenuLines = table(
  "set_menu_lines",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    menuId: id("menu_id").notNull(),
    position: count("position").notNull(),
    count: count("count").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.menuId], foreignColumns: [menus.id] }).onDelete("cascade"),
    index("set_menu_lines_position_idx").on(t.menuId, t.position),
    check("set_menu_lines_count_ck", sql`${t.count} between 1 and 99`),
  ],
);

export const setMenuLineCourses = table(
  "set_menu_line_courses",
  {
    lineId: id("line_id").notNull(),
    courseId: id("course_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.lineId, t.courseId] }),
    foreignKey({ columns: [t.lineId], foreignColumns: [setMenuLines.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.courseId], foreignColumns: [kitchenCourses.id] }),
  ],
);

export const setMenuVariantExclusions = table(
  "set_menu_variant_exclusions",
  {
    menuItemId: id("menu_item_id").notNull(),
    productId: id("product_id").notNull(),
    variantId: id("variant_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.menuItemId, t.variantId] }),
    foreignKey({
      columns: [t.menuItemId, t.productId],
      foreignColumns: [menuItems.id, menuItems.productId],
      name: "set_menu_variant_exclusions_offer_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.productId, t.variantId],
      foreignColumns: [products.parentId, products.id],
      name: "set_menu_variant_exclusions_variant_fk",
    }).onDelete("restrict"),
  ],
);

export const setMenuDishCourses = table(
  "set_menu_dish_courses",
  {
    menuItemId: id("menu_item_id").primaryKey(),
    courseId: id("course_id").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.menuItemId], foreignColumns: [menuItems.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.courseId], foreignColumns: [kitchenCourses.id] }),
  ],
);
