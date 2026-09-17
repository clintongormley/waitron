import { sql } from "drizzle-orm";
import { check, foreignKey, primaryKey, unique } from "drizzle-orm/pg-core";
import { count, flag, id, json, label, money, products, table } from "@waitron/db";
import { menuItems } from "./menu.js";

export const productVariants = table(
  "product_variants",
  {
    id: id("id").primaryKey().defaultRandom(),
    productId: id("product_id").notNull(),
    // Staff-facing variant name — plain text, like the product's own name.
    name: label("name").notNull(),
    // Customer-facing translated name; null or a blank entry means "use `name`".
    customerName: json<Record<string, string>>("customer_name"),
    // Optional kitchen-ticket name for the variant.
    kitchenName: label("kitchen_name"),
    // Path reference to the variant photo — a content-addressed filename, the same plain-text shape
    // as products.image. There is no media FK: deletion protection is the application-level usage
    // scan in packages/media/src/images.ts, which covers this column. Null = no picture.
    image: label("image"),
    unitPrice: money("unit_price").notNull(),
    available: flag("available").notNull().default(true),
    displayOrder: count("display_order").notNull().default(0),
  },
  (t) => [
    // The target of menu_item_variants_variant_fk: a published variant belongs to the offer's product.
    unique("product_variants_product_id_key").on(t.productId, t.id),
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "product_variants_product_fk",
    }).onDelete("restrict"),
    check("product_variants_price_ck", sql`${t.unitPrice} >= 0`),
  ],
);

/** Publication owns its price; the product's current default never reprices an existing offer. */
export const menuItemVariants = table(
  "menu_item_variants",
  {
    menuItemId: id("menu_item_id").notNull(),
    productId: id("product_id").notNull(),
    variantId: id("variant_id").notNull(),
    unitPrice: money("unit_price").notNull(),
    available: flag("available").notNull().default(true),
    displayOrder: count("display_order").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.menuItemId, t.variantId], name: "menu_item_variants_pk" }),
    foreignKey({
      columns: [t.menuItemId, t.productId],
      foreignColumns: [menuItems.id, menuItems.productId],
      name: "menu_item_variants_offer_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.productId, t.variantId],
      foreignColumns: [productVariants.productId, productVariants.id],
      name: "menu_item_variants_variant_fk",
    }).onDelete("restrict"),
    check("menu_item_variants_price_ck", sql`${t.unitPrice} >= 0`),
  ],
);
