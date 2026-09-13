import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { products } from "@waitron/db";
import { menuItems } from "./menu.js";

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    productId: uuid("product_id").notNull(),
    name: jsonb("name").$type<Record<string, string>>().notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    available: boolean("available").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (t) => [
    unique("product_variants_tenant_product_id_key").on(t.tenantId, t.productId, t.id),
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "product_variants_product_fk",
    }).onDelete("restrict"),
    check("product_variants_price_ck", sql`${t.unitPrice} >= 0`),
  ],
);

/** Publication owns its price; the product's current default never reprices an existing offer. */
export const menuItemVariants = pgTable(
  "menu_item_variants",
  {
    tenantId: uuid("tenant_id").notNull(),
    menuItemId: uuid("menu_item_id").notNull(),
    productId: uuid("product_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    available: boolean("available").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.menuItemId, t.variantId], name: "menu_item_variants_pk" }),
    foreignKey({
      columns: [t.tenantId, t.menuItemId, t.productId],
      foreignColumns: [menuItems.tenantId, menuItems.id, menuItems.productId],
      name: "menu_item_variants_offer_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.productId, t.variantId],
      foreignColumns: [productVariants.tenantId, productVariants.productId, productVariants.id],
      name: "menu_item_variants_variant_fk",
    }).onDelete("restrict"),
    check("menu_item_variants_price_ck", sql`${t.unitPrice} >= 0`),
  ],
);
