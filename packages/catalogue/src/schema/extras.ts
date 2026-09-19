import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/pg-core";
import { count, flag, id, json, label, money, products, table } from "@waitron/db";

/** A reusable, named list of products a diner may add to a dish, with rules on how many. The list
 * carries three names (staff, customer-facing, kitchen) like an options list and a product; what it
 * does NOT carry is anything an item would duplicate from the product it names — no price, VAT,
 * allergens or dietary labels live below. `min_picks`/`max_picks` are the spelling the design asks
 * for (spec `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.1) and not a
 * technical necessity: bare `min` and `max` are legal column names. Measured on PGlite 0.5.8
 * (PostgreSQL 18.3) — a table declared with `min integer not null default 0, max integer` took a
 * `check (min >= 0 and (max is null or max >= min))`, refused a bad row with `23514`, selected both
 * columns unqualified and aggregated them as `min(min)` / `max(max)`. Tasks 5, 6 and 11 of
 * `docs/superpowers/plans/2026-09-18-modifiers-extras-options.md` add the per-menu publication, the
 * product attachment and the dashboard editor. */
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
