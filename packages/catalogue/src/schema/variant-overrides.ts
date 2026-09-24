import { sql } from "drizzle-orm";
import { check, foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { flag, id, money, products, table } from "@waitron/db";
import { menuItems } from "./menu.js";

/**
 * What one menu changes about a variant of the product it offers: its price
 * there, or that it is switched off there. A variant follows its parent onto every menu without a
 * row; a row exists only while it overrides something, which the second check enforces.
 */
export const menuItemVariantOverrides = table(
  "menu_item_variant_overrides",
  {
    menuItemId: id("menu_item_id").notNull(),
    productId: id("product_id").notNull(),
    variantId: id("variant_id").notNull(),
    // Null follows the variant's own price, then the parent's on this menu, then the parent's own.
    price: money("price"),
    offered: flag("offered").notNull().default(true),
  },
  (t) => [
    primaryKey({
      columns: [t.menuItemId, t.variantId],
      name: "menu_item_variant_overrides_pk",
    }),
    foreignKey({
      columns: [t.menuItemId, t.productId],
      foreignColumns: [menuItems.id, menuItems.productId],
      name: "menu_item_variant_overrides_offer_fk",
    }).onDelete("cascade"),
    // A variant OF the offer's product: `products_parent_id_key (parent_id, id)` is the target.
    foreignKey({
      columns: [t.productId, t.variantId],
      foreignColumns: [products.parentId, products.id],
      name: "menu_item_variant_overrides_variant_fk",
    }).onDelete("restrict"),
    check("menu_item_variant_overrides_price_ck", sql`${t.price} >= 0`),
    check(
      "menu_item_variant_overrides_overrides_ck",
      sql`${t.price} is not null or ${t.offered} = 0`,
    ),
  ],
);
