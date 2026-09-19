import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { count, flag, id, json, label, money, products, table } from "@waitron/db";
import { menuItems } from "./menu.js";

/** A reusable, named list of products a diner may add to a dish, with rules on how many. The list
 * carries three names (staff, customer-facing, kitchen) like an options list and a product; what it
 * does NOT carry is anything an item would duplicate from the product it names — no price, VAT,
 * allergens or dietary labels live below. `min_picks`/`max_picks` are the spelling the design asks
 * for (spec `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.1) and not a
 * technical necessity: bare `min` and `max` are legal column names. Measured on PGlite 0.5.8
 * (PostgreSQL 18.3) — a table declared with `min integer not null default 0, max integer` took a
 * `check (min >= 0 and (max is null or max >= min))`, refused a bad row with `23514`, selected both
 * columns unqualified and aggregated them as `min(min)` / `max(max)`. The per-menu publication is
 * below in this file; the product attachment and the dashboard editor are Tasks 6 and 11 of
 * `docs/superpowers/plans/2026-09-18-modifiers-extras-options.md`. */
export const extraLists = table(
  "extra_lists",
  {
    id: id("id").primaryKey().defaultRandom(),
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
    // `sort`, not the `display_order` the rest of this package's schema uses: these tables keep the
    // column name of the core modifier tables they replace (`packages/db/src/schema/catalogue.ts`).
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
    id: id("id").primaryKey().defaultRandom(),
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

/** An extras list published on one menu offer, the `menu_item_option_groups` shape (schema/menu.ts)
 * keyed by list rather than by option group. The row says only "this offer publishes this list, in
 * this position"; what the list offers is the list's own rows, narrowed and repriced below.
 *
 * It differs from the option-group sibling in one way that matters: THAT one's authoring operation
 * checks the dish's product actually carries the group, and this one's cannot. `product_option_groups`
 * exists and the extras equivalent does not, so `setMenuItemExtraLists`
 * (packages/catalogue/src/extras.ts) has nothing to read; Task 6 of
 * `docs/superpowers/plans/2026-09-18-modifiers-extras-options.md` creates the table and adds the
 * check. */
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
    // time a manager saves an extras list.
    index("menu_item_extra_items_list_product_idx").on(t.listId, t.productId),
  ],
);
