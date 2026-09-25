import { sql } from "drizzle-orm";
import { check, foreignKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  catalogues,
  count,
  flag,
  id,
  label,
  labelList,
  money,
  newId,
  products,
  table,
} from "@waitron/db";
import { sections } from "./sections.js";

/** The one content-language policy shared by the reusable catalogue and media: at most one row,
 * `id` pinned to 1. */
export const contentLanguages = table(
  "content_languages",
  {
    id: count("id").primaryKey().notNull().default(1),
    defaultLanguage: label("default_language").notNull(),
    languages: labelList("languages").notNull(),
  },
  (t) => [
    check("content_languages_singleton_ck", sql`${t.id} = 1`),
    // Membership in the list, matched on the QUOTED token so a code cannot match a prefix of a
    // longer one. The match is exact only while a language code carries no `"` and needs no JSON
    // escape — true of BCP-47 tags, and nothing below this line enforces it.
    check(
      "content_languages_default_ck",
      sql`instr(${t.languages}, '"' || ${t.defaultLanguage} || '"') > 0`,
    ),
    // A JSON array holding a null entry, `[null]`, is accepted here. What refuses a null entry
    // today is the column's own `string[]` type and the writer above it; the database does not.
    check("content_languages_list_ck", sql`json_array_length(${t.languages}) between 1 and 200`),
  ],
);

/** A menu's top-level list and its default home layout: two sections the menu owns. */
export const menuDetails = table(
  "menu_details",
  {
    menuId: id("menu_id").primaryKey(),
    rootSectionId: id("root_section_id").notNull(),
    defaultHomeLayoutId: id("default_home_layout_id").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.menuId],
      foreignColumns: [catalogues.id],
      name: "menu_details_menu_fk",
    }),
    foreignKey({
      columns: [t.rootSectionId],
      foreignColumns: [sections.id],
      name: "menu_details_root_fk",
    }),
    foreignKey({
      columns: [t.defaultHomeLayoutId],
      foreignColumns: [sections.id],
      name: "menu_details_default_layout_fk",
    }),
    uniqueIndex("menu_details_root_uq").on(t.rootSectionId),
  ],
);

/**
 * A menu's settings for one product: its price and its own switch. `syncMenuOffers`
 * (menu-structure.ts) adds a row when the menu's structure reaches the product and resets it when
 * the structure stops reaching it. A blank `gross_price` means the product's own price
 * (`resolveOfferPrice`, `offer-price.ts`).
 */
export const menuItems = table(
  "menu_items",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    menuId: id("menu_id").notNull(),
    productId: id("product_id").notNull(),
    grossPrice: money("gross_price"),
    active: flag("active").notNull().default(true),
  },
  (t) => [
    // The target of menu_item_variant_overrides_offer_fk: an override names the offer's product.
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
    check("menu_items_gross_price_ck", sql`${t.grossPrice} >= 0`),
  ],
);
