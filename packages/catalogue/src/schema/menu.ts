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
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { catalogues, optionGroupItems, optionGroups, products } from "@waitron/db";

/** The one content-language policy shared by the reusable catalogue and media: at most one row,
 * `id` pinned to 1 (the `deployment` / `mirror_config` / `node_membership` singleton shape in
 * `@waitron/db`). */
export const contentLanguages = pgTable(
  "content_languages",
  {
    id: integer("id").primaryKey().notNull().default(1),
    defaultLanguage: text("default_language").notNull(),
    languages: text("languages").array().notNull(),
  },
  (t) => [
    check("content_languages_singleton_ck", sql`${t.id} = 1`),
    check("content_languages_default_ck", sql`${t.defaultLanguage} = any(${t.languages})`),
    check(
      "content_languages_list_ck",
      sql`cardinality(${t.languages}) between 1 and 200 and array_position(${t.languages}, null) is null`,
    ),
  ],
);

/** A presentation heading within one menu. Product categories remain the reporting taxonomy. */
export const menuSections = pgTable(
  "menu_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    menuId: uuid("menu_id").notNull(),
    name: jsonb("name").$type<Record<string, string>>().notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    // The target of menu_items_section_fk: an offer's section belongs to the offer's own menu.
    unique("menu_sections_menu_id_key").on(t.menuId, t.id),
    foreignKey({
      columns: [t.menuId],
      foreignColumns: [catalogues.id],
      name: "menu_sections_menu_fk",
    }).onDelete("cascade"),
    index("menu_sections_menu_order_idx").on(t.menuId, t.displayOrder),
  ],
);

/** A product offered on one menu. This row owns the selling price and presentation order. */
export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    menuId: uuid("menu_id").notNull(),
    productId: uuid("product_id").notNull(),
    sectionId: uuid("section_id").notNull(),
    grossPrice: numeric("gross_price", { precision: 12, scale: 2 }).notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    // The target of menu_item_variants_offer_fk: a published variant belongs to the offer's product.
    unique("menu_items_id_product_key").on(t.id, t.productId),
    unique("menu_items_menu_product_key").on(t.menuId, t.productId),
    foreignKey({
      columns: [t.menuId],
      foreignColumns: [catalogues.id],
      name: "menu_items_menu_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "menu_items_product_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.menuId, t.sectionId],
      foreignColumns: [menuSections.menuId, menuSections.id],
      name: "menu_items_section_fk",
    }).onDelete("restrict"),
    check("menu_items_gross_price_ck", sql`${t.grossPrice} >= 0`),
    index("menu_items_menu_order_idx").on(t.menuId, t.displayOrder),
  ],
);

/** An option group published for one menu item; product attachment is checked by the authoring op. */
export const menuItemOptionGroups = pgTable(
  "menu_item_option_groups",
  {
    menuItemId: uuid("menu_item_id").notNull(),
    groupId: uuid("group_id").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (t) => [
    primaryKey({
      columns: [t.menuItemId, t.groupId],
      name: "menu_item_option_groups_pk",
    }),
    foreignKey({
      columns: [t.menuItemId],
      foreignColumns: [menuItems.id],
      name: "menu_item_option_groups_item_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.groupId],
      foreignColumns: [optionGroups.id],
      name: "menu_item_option_groups_group_fk",
    }).onDelete("cascade"),
  ],
);

/** A choice made available and priced for one offered group. */
export const menuItemOptions = pgTable(
  "menu_item_options",
  {
    menuItemId: uuid("menu_item_id").notNull(),
    groupId: uuid("group_id").notNull(),
    optionId: uuid("option_id").notNull(),
    priceDelta: numeric("price_delta", { precision: 12, scale: 2 }).notNull().default("0"),
  },
  (t) => [
    primaryKey({
      columns: [t.menuItemId, t.optionId],
      name: "menu_item_options_pk",
    }),
    foreignKey({
      columns: [t.menuItemId, t.groupId],
      foreignColumns: [menuItemOptionGroups.menuItemId, menuItemOptionGroups.groupId],
      name: "menu_item_options_group_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.optionId],
      foreignColumns: [optionGroupItems.id],
      name: "menu_item_options_option_fk",
    }).onDelete("cascade"),
  ],
);
