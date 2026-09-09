import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { catalogues, optionGroupItems, optionGroups, products, tenants } from "@waitron/db";

/** A presentation heading within one menu. Product categories remain the reporting taxonomy. */
export const menuSections = pgTable(
  "menu_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    name: jsonb("name").$type<Record<string, string>>().notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    unique("menu_sections_tenant_id_key").on(t.tenantId, t.id),
    unique("menu_sections_tenant_menu_id_key").on(t.tenantId, t.menuId, t.id),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "menu_sections_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.menuId],
      foreignColumns: [catalogues.tenantId, catalogues.id],
      name: "menu_sections_menu_fk",
    }).onDelete("cascade"),
    index("menu_sections_menu_order_idx").on(t.tenantId, t.menuId, t.displayOrder),
  ],
);

/** A product offered on one menu. This row owns the selling price and presentation order. */
export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    productId: uuid("product_id").notNull(),
    sectionId: uuid("section_id").notNull(),
    grossPrice: numeric("gross_price", { precision: 12, scale: 2 }).notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    unique("menu_items_tenant_id_key").on(t.tenantId, t.id),
    unique("menu_items_menu_product_key").on(t.tenantId, t.menuId, t.productId),
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "menu_items_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.menuId],
      foreignColumns: [catalogues.tenantId, catalogues.id],
      name: "menu_items_menu_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "menu_items_product_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.menuId, t.sectionId],
      foreignColumns: [menuSections.tenantId, menuSections.menuId, menuSections.id],
      name: "menu_items_section_fk",
    }).onDelete("restrict"),
    check("menu_items_gross_price_ck", sql`${t.grossPrice} >= 0`),
    index("menu_items_menu_order_idx").on(t.tenantId, t.menuId, t.displayOrder),
  ],
);

/** An option group published for one menu item; product attachment is checked by the authoring op. */
export const menuItemOptionGroups = pgTable(
  "menu_item_option_groups",
  {
    tenantId: uuid("tenant_id").notNull(),
    menuItemId: uuid("menu_item_id").notNull(),
    groupId: uuid("group_id").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (t) => [
    primaryKey({
      columns: [t.tenantId, t.menuItemId, t.groupId],
      name: "menu_item_option_groups_pk",
    }),
    foreignKey({
      columns: [t.tenantId, t.menuItemId],
      foreignColumns: [menuItems.tenantId, menuItems.id],
      name: "menu_item_option_groups_item_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.groupId],
      foreignColumns: [optionGroups.tenantId, optionGroups.id],
      name: "menu_item_option_groups_group_fk",
    }).onDelete("restrict"),
  ],
);

/** A choice made available and priced for one offered group. */
export const menuItemOptions = pgTable(
  "menu_item_options",
  {
    tenantId: uuid("tenant_id").notNull(),
    menuItemId: uuid("menu_item_id").notNull(),
    groupId: uuid("group_id").notNull(),
    optionId: uuid("option_id").notNull(),
    priceDelta: numeric("price_delta", { precision: 12, scale: 2 }).notNull().default("0"),
  },
  (t) => [
    primaryKey({
      columns: [t.tenantId, t.menuItemId, t.optionId],
      name: "menu_item_options_pk",
    }),
    foreignKey({
      columns: [t.tenantId, t.menuItemId, t.groupId],
      foreignColumns: [
        menuItemOptionGroups.tenantId,
        menuItemOptionGroups.menuItemId,
        menuItemOptionGroups.groupId,
      ],
      name: "menu_item_options_group_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.optionId],
      foreignColumns: [optionGroupItems.tenantId, optionGroupItems.id],
      name: "menu_item_options_option_fk",
    }).onDelete("restrict"),
  ],
);
