import { sql } from "drizzle-orm";
import { check, foreignKey, unique } from "drizzle-orm/sqlite-core";
import { menus, products } from "../menus.js";
import { id, money, newId, table } from "../columns.js";
/**
 * On a set menu, `gross_price` is a surcharge and blank means included. On an ordinary menu,
 * blank means the product's own price.
 */
export const menuItems = table(
  "menu_items",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    menuId: id("menu_id").notNull(),
    productId: id("product_id").notNull(),
    grossPrice: money("gross_price"),
  },
  (t) => [
    // The target of menu_item_variant_overrides_offer_fk: an override names the offer's product.
    unique("menu_items_id_product_key").on(t.id, t.productId),
    unique("menu_items_menu_product_key").on(t.menuId, t.productId),
    foreignKey({
      columns: [t.menuId],
      foreignColumns: [menus.id],
      name: "menu_items_menu_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "menu_items_product_fk",
    }).onDelete("restrict"),
    check("menu_items_gross_price_ck", sql`${t.grossPrice} >= 0`),
  ],
);
