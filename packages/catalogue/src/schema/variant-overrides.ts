import { sql } from "drizzle-orm";
import { check, foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { id, money, products, table } from "@waitron/db";
import { menuItems } from "./menu.js";

/** A row exists only to set this variant's price on this menu. */
export const menuItemVariantOverrides = table(
  "menu_item_variant_overrides",
  {
    menuItemId: id("menu_item_id").notNull(),
    productId: id("product_id").notNull(),
    variantId: id("variant_id").notNull(),
    // Null follows the variant's own price, then the parent's on this menu, then the parent's own.
    price: money("price"),
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
    check("menu_item_variant_overrides_overrides_ck", sql`${t.price} is not null`),
  ],
);
