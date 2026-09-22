import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, flag, id, json, label, money, newId, products, table } from "@waitron/db";
import { menuItems } from "./menu.js";
import { optionLists } from "./options.js";

/** A reusable, named list of products a diner may add to a dish, with rules on how many. The list
 * carries three names (staff, customer-facing, kitchen) like an options list and a product; what it
 * does NOT carry is anything an item would duplicate from the product it names — no price, VAT,
 * allergens or dietary labels live below. `min_picks`/`max_picks` are the spelling the design asks
 * for (spec `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.1) and not a
 * technical necessity: bare `min` and `max` are legal column names. Re-measured on this engine
 * (`node:sqlite`, Node v26.7.0, 2026-09-22) after the storage switch retired the PostgreSQL
 * reading — a table declared with `min integer not null default 0, max integer` took a
 * `check (min >= 0 and (max is null or max >= min))`, selected both columns unqualified and
 * aggregated them as `min(min)` / `max(max)`; the control in the other direction, a row with
 * `min = 5, max = 2`, came back `CHECK constraint failed`. The per-menu publication is
 * below in this file; the product attachment is `product_modifiers` (`product-modifiers.ts`) and
 * the dashboard editor is `apps/dashboard/src/widgets/extra-list-form.ts`. */
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
    // `sort`, not the `display_order` the rest of this package's schema uses: an extras list and an
    // options list (schema/options.ts) are ordered by the same column name, and
    // `product_modifiers.sort` below orders the two kinds together.
    sort: count("sort").notNull().default(0),
    active: flag("active").notNull().default(true),
  },
  (t) => [
    // The backstop under `parseExtraListInput` (packages/catalogue/src/extra-contract.ts), which
    // refuses the same pair before the write so an editor gets a field-shaped 4xx rather than a 500.
    check(
      "extra_lists_picks_ck",
      sql`${t.minPicks} >= 0 and (${t.maxPicks} is null or ${t.maxPicks} >= ${t.minPicks})`,
    ),
  ],
);

/** One product a list offers, on the terms of the OFFER alone: how many of it one dish may take,
 * whether it starts picked, and a price that overrides the product's own. A null `price` means
 * "charge the product's `unit_price`" — `resolveExtraPrice` (packages/catalogue/src/extras.ts) is
 * what reads it that way. The product reference is `restrict`, so the database refuses removing a
 * product an offer still names. */
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
    // An item's price becomes a sale line and so reaches a fiscal record. `isProductPrice`
    // (packages/catalogue/src/modifier-limits.ts) refuses a leading minus before the write; this is
    // the database backstop under that, in the shape `product_variants.unit_price` and
    // `menu_item_variants.unit_price` already carry (schema/variants.ts).
    check("extra_list_items_price_ck", sql`${t.price} >= 0`),
    // One offer per product per list. `parseExtraListInput`
    // (packages/catalogue/src/extra-contract.ts) refuses the pair within one authoring body, because
    // `validateExtraSelections` matches a diner's pick to an item BY PRODUCT ID and could not tell
    // two rows apart; this index is what enforces the same rule in the database, so a write that
    // does not go through the contract cannot leave the pair behind either.
    uniqueIndex("extra_list_items_list_product_uq").on(t.listId, t.productId),
    index("extra_list_items_list_sort_idx").on(t.listId, t.sort),
  ],
);

/** An extras list published on one menu offer. The row says only "this offer publishes this list,
 * in this position"; what the list offers is the list's own rows, narrowed and repriced below.
 *
 * A row is written only for a list the dish's PRODUCT carries in `product_modifiers` (below in this
 * file): `setMenuItemExtraLists` (packages/catalogue/src/extras.ts) refuses the rest. Nothing
 * refuses an offer that publishes NONE of the lists its product carries; `assertProductCarries`
 * (packages/catalogue/src/extras.ts) says why.
 *
 * Nothing HOLDS the attachment afterwards — there is no key between the two
 * tables, and detaching the list from the product leaves this row where it is. Read over the tree
 * rather than measured: `grep -rn 'delete(menuItemExtraLists' --include='*.ts' packages apps`
 * returns two lines, one of them this comment quoting the command; the other is
 * `setMenuItemExtraLists`' own delete of the offer it is rewriting. The only other way a row leaves
 * is the two ON DELETE CASCADE keys below. */
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
    // The primary key leads with `menu_item_id`, so nothing here answers a filter on `list_id`
    // alone: `extraListDependants` (packages/catalogue/src/extras.ts) asks exactly that, and so does
    // the cascade from `extra_lists` when a list is deleted.
    index("menu_item_extra_lists_list_idx").on(t.listId),
  ],
);

/** One published list's item as this menu offer sells it: a price that overrides the list item's own
 * and an `available` flag that withdraws it from this offer alone. A null `price` means "fall back
 * to the list item's price, and then to the product's `unit_price`" (spec
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.3).
 *
 * `(list_id, product_id)` deliberately carries NO foreign key into `extra_list_items`, though
 * `extra_list_items_list_product_uq` would accept one: `writeItems`
 * (packages/catalogue/src/extras.ts) replaces a list's items by deleting every row of that list and
 * re-inserting the body, so a cascading key would erase every menu-level override each time a
 * manager saved the list. A row naming a product the list no longer offers is instead ignored by
 * the menu projection and removed by the list write path. */
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
    // A product an offer still prices cannot be removed: `restrict`, as `extra_list_items_product_fk`
    // above and `menu_items_product_fk` (schema/menu.ts) are.
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "menu_item_extra_items_product_fk",
    }).onDelete("restrict"),
    // A published price becomes a sale line and so reaches a fiscal record; this is the same
    // database backstop `extra_list_items_price_ck` carries above.
    check("menu_item_extra_items_price_ck", sql`${t.price} >= 0`),
    // The primary key leads with `menu_item_id`, so nothing here answers a filter on `list_id`
    // alone: `dropStaleMenuOverrides` (packages/catalogue/src/extras.ts) deletes on `list_id` every
    // time a manager UPDATES an extras list. Only an update — `updateExtraList` is its one caller,
    // because a create mints the list id a statement earlier and no offer can hold an override
    // against it yet.
    index("menu_item_extra_items_list_product_idx").on(t.listId, t.productId),
  ],
);

/** The ONE ordered list a product exposes at the till: each row attaches exactly one extras list or
 * one options list, and `sort` is the position the till draws it in (spec
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §5).
 *
 * The key is a surrogate `id` rather than the natural pair, because a composite primary key cannot
 * span columns that are allowed to be null and both references here are — each row leaves one of
 * them empty. What stands in for that key is the pair of unique indexes below.
 *
 * `(extra_list_id is null) <> (option_list_id is null)` is the check, not the
 * `num_nonnulls(extra_list_id, option_list_id) = 1` the plan's prose names: `num_nonnulls` is a
 * PostgreSQL function that SQLite has no equivalent for, and spec §7 bars new code from constructs
 * the in-flight flip would have to rewrite. The `<>` form is plain boolean inequality — "exactly one
 * of the two is absent" — and both engines have it. */
export const productModifiers = table(
  "product_modifiers",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    productId: id("product_id").notNull(),
    // Position in the product's list, written from the body's order by `writeProductModifiers`
    // (packages/catalogue/src/product-modifiers.ts) the way `extra_list_items.sort` is.
    sort: count("sort").notNull().default(0),
    extraListId: id("extra_list_id"),
    optionListId: id("option_list_id"),
  },
  (t) => [
    // All three are `cascade`, not the `restrict` an extras ITEM's product key takes: an attachment
    // is a link and carries nothing of its own, so removing either end should take the link with it
    // rather than refuse. Run rather than read off the clauses, by the three cases in "what deleting
    // a parent row takes with it" (packages/catalogue/src/product-modifiers.test.ts).
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
    // The read path orders a product's rows by `sort`; nothing else filters this table by product.
    index("product_modifiers_product_sort_idx").on(t.productId, t.sort),
    // One attachment per list per product, and each index constrains only the rows whose reference
    // is present: a unique index treats two nulls as DIFFERENT values, so the options index ignores
    // every extras-only row and the other way round. That holds on this engine too, and is measured
    // rather than read off the documentation, by "lets one product carry many extras-only rows under
    // the options-list unique index" (packages/catalogue/src/product-modifiers.test.ts:151). These are the
    // database backstop under `writeProductModifiers`' own duplicate refusal, the same division
    // `extra_list_items_list_product_uq` makes above.
    uniqueIndex("product_modifiers_product_extra_uq").on(t.productId, t.extraListId),
    uniqueIndex("product_modifiers_product_option_uq").on(t.productId, t.optionListId),
  ],
);
