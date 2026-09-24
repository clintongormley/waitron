import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, flag, id, json, label, money, newId, products, table } from "@waitron/db";
import { menuItems } from "./menu.js";
import { optionLists } from "./options.js";

/** A reusable, named list of products a diner may add to a dish, with rules on how many. Its items
 * carry nothing they would duplicate from the product they name: no price, VAT, allergens or
 * dietary labels. */
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
    // a field an editor can use.
    check(
      "extra_lists_picks_ck",
      sql`${t.minPicks} >= 0 and (${t.maxPicks} is null or ${t.maxPicks} >= ${t.minPicks})`,
    ),
  ],
);

/** One product a list offers, on the terms of the OFFER alone: how many of it one dish may take,
 * whether it starts picked, and a price that overrides the product's own. A null `price` means
 * "charge the product's `unit_price`" (`resolveExtraPrice`, extras.ts). */
export const extraListItems = table(
  "extra_list_items",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    listId: id("list_id").notNull(),
    productId: id("product_id").notNull(),
    sort: count("sort").notNull().default(0),
    maxQuantity: count("max_quantity").notNull().default(1),
    preselected: flag("preselected").notNull().default(false),
    price: money("price"),
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
    // One offer per product per list: `validateExtraSelections` matches a diner's pick to an item BY
    // PRODUCT ID and could not tell two rows apart. The backstop under `parseExtraListInput`.
    uniqueIndex("extra_list_items_list_product_uq").on(t.listId, t.productId),
    index("extra_list_items_list_sort_idx").on(t.listId, t.sort),
  ],
);

/** An extras list published on one menu offer, in one position; what the list offers is the list's
 * own rows, narrowed and repriced below.
 *
 * A row is written only for a list the dish's PRODUCT carries in `product_modifiers`
 * (`setMenuItemExtraLists`, extras.ts), but nothing holds that afterwards: there is no key into
 * `product_modifiers`, so detaching the list from the product leaves this row where it is. */
export const menuItemExtraLists = table(
  "menu_item_extra_lists",
  {
    menuItemId: id("menu_item_id").notNull(),
    listId: id("list_id").notNull(),
    displayOrder: count("display_order").notNull().default(0),
  },
  (t) => [
    primaryKey({
      columns: [t.menuItemId, t.listId],
      name: "menu_item_extra_lists_pk",
    }),
    foreignKey({
      columns: [t.menuItemId],
      foreignColumns: [menuItems.id],
      name: "menu_item_extra_lists_item_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.listId],
      foreignColumns: [extraLists.id],
      name: "menu_item_extra_lists_list_fk",
    }).onDelete("cascade"),
    // The primary key leads with `menu_item_id`; `extraListDependants` and the cascade from
    // `extra_lists` filter on `list_id` alone.
    index("menu_item_extra_lists_list_idx").on(t.listId),
  ],
);

/** One published list's item as this menu offer sells it: a price that overrides the list item's own
 * and an `available` flag that withdraws it from this offer alone. A null `price` falls back to the
 * list item's price, then the product's `unit_price`.
 *
 * `(list_id, product_id)` deliberately carries NO foreign key into `extra_list_items`: `writeItems`
 * (extras.ts) replaces a list's items by deleting and re-inserting them, so a cascading key would
 * erase every menu-level override each time a manager saved the list. A row naming a product the
 * list no longer offers is instead ignored by the menu projection and removed by
 * `dropStaleMenuOverrides`. */
export const menuItemExtraItems = table(
  "menu_item_extra_items",
  {
    menuItemId: id("menu_item_id").notNull(),
    listId: id("list_id").notNull(),
    productId: id("product_id").notNull(),
    price: money("price"),
    available: flag("available").notNull().default(true),
  },
  (t) => [
    primaryKey({
      columns: [t.menuItemId, t.listId, t.productId],
      name: "menu_item_extra_items_pk",
    }),
    foreignKey({
      columns: [t.menuItemId, t.listId],
      foreignColumns: [menuItemExtraLists.menuItemId, menuItemExtraLists.listId],
      name: "menu_item_extra_items_list_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "menu_item_extra_items_product_fk",
    }).onDelete("restrict"),
    check("menu_item_extra_items_price_ck", sql`${t.price} >= 0`),
    // The primary key leads with `menu_item_id`; `dropStaleMenuOverrides` deletes on `list_id`.
    index("menu_item_extra_items_list_product_idx").on(t.listId, t.productId),
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
