import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, flag, id, json, label, money, newId, products, quantity, table } from "@waitron/db";
import { optionLists } from "./options.js";

/** A reusable, named list of products a diner may add to a dish, with rules on how many. Its items
 * carry nothing they would duplicate from the product they name: no VAT, allergens or dietary
 * labels. */
export const extraLists = table(
  "extra_lists",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // Staff-facing list name — plain text, like the product's own name.
    name: label("name").notNull(),
    // Customer-facing translated name; null or a blank entry means "use `name`".
    customerName: json<Record<string, string>>("customer_name"),
    // Optional kitchen-ticket name for the list.
    kitchenName: label("kitchen_name"),
    // Total picks required across the list: 0 leaves it optional, 1 or more makes it required.
    minPicks: count("min_picks").notNull().default(0),
    // Total picks allowed; null is uncapped.
    maxPicks: count("max_picks"),
    sort: count("sort").notNull().default(0),
    active: flag("active").notNull().default(true),
  },
  (t) => [
    // The backstop under `parseExtraListInput` (extra-contract.ts), which refuses the same pair with
    // a field an editor can use. The parser also refuses a maximum of 0, which this CHECK allows.
    check(
      "extra_lists_picks_ck",
      sql`${t.minPicks} >= 0 and (${t.maxPicks} is null or ${t.maxPicks} >= ${t.minPicks})`,
    ),
  ],
);

export const extraListItems = table(
  "extra_list_items",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    listId: id("list_id").notNull(),
    productId: id("product_id").notNull(),
    sort: count("sort").notNull().default(0),
    maxQuantity: count("max_quantity").default(1),
    preselected: flag("preselected").notNull().default(false),
    price: money("price"),
    portion: quantity("portion").notNull().default(1000),
  },
  (t) => [
    foreignKey({
      columns: [t.listId],
      foreignColumns: [extraLists.id],
      name: "extra_list_items_list_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "extra_list_items_product_fk",
    }).onDelete("restrict"),
    check("extra_list_items_qty_ck", sql`${t.maxQuantity} >= 1`),
    // An item's price reaches a fiscal record: the backstop under `isProductPrice`.
    check("extra_list_items_price_ck", sql`${t.price} >= 0`),
    check("extra_list_items_portion_ck", sql`${t.portion} > 0`),
    // One offer per product per list: `validateExtraSelections` matches a diner's pick to an item BY
    // PRODUCT ID and could not tell two rows apart. The backstop under `parseExtraListInput`.
    uniqueIndex("extra_list_items_list_product_uq").on(t.listId, t.productId),
    index("extra_list_items_list_sort_idx").on(t.listId, t.sort),
  ],
);

/** The ONE ordered list a product exposes at the till: each row attaches exactly one extras list or
 * one options list, and `sort` is the position the till draws it in.
 *
 * The key is a surrogate `id` because each row leaves one of the two references null; the pair of
 * unique indexes below stands in for the natural key. */
export const productModifiers = table(
  "product_modifiers",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    productId: id("product_id").notNull(),
    sort: count("sort").notNull().default(0),
    extraListId: id("extra_list_id"),
    optionListId: id("option_list_id"),
  },
  (t) => [
    // All three are `cascade`, not `restrict`: an attachment is a link and carries nothing of its
    // own, so removing either end takes the link with it.
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "product_modifiers_product_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.extraListId],
      foreignColumns: [extraLists.id],
      name: "product_modifiers_extra_list_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.optionListId],
      foreignColumns: [optionLists.id],
      name: "product_modifiers_option_list_fk",
    }).onDelete("cascade"),
    check(
      "product_modifiers_one_reference_ck",
      sql`(${t.extraListId} is null) <> (${t.optionListId} is null)`,
    ),
    index("product_modifiers_product_sort_idx").on(t.productId, t.sort),
    // One attachment per list per product. A unique index treats two nulls as DIFFERENT values, so
    // the options index ignores every extras-only row and the other way round.
    uniqueIndex("product_modifiers_product_extra_uq").on(t.productId, t.extraListId),
    uniqueIndex("product_modifiers_product_option_uq").on(t.productId, t.optionListId),
  ],
);
