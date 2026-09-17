import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey } from "drizzle-orm/pg-core";
import { bigCount, count, flag, id, json, label, money, table, ts } from "./columns.js";

/**
 * The db-layer copy of the allergen-declaration shape: a per-code presence map with an optional
 * specific-substance source. Structurally identical to `@waitron/catalogue`'s `ProductAllergens`, but
 * a LOCAL type here on purpose — `@waitron/catalogue` depends on THIS package, so the dependency runs
 * the other way and the exact `AllergenCode`-keyed type cannot be imported here without a cycle.
 */
export type AllergenMap = Record<string, { presence: "contains" | "may_contain"; source?: string }>;

/** A named, shareable menu. Many locations may point at one catalogue (N identical delis share it);
 * a heterogeneous venue set uses one catalogue each. `version` is the sync seam (bumped later). */
export const catalogues = table("catalogues", {
  id: id("id").primaryKey().defaultRandom(),
  name: label("name").notNull(),
  active: flag("active").notNull().default(true),
  version: bigCount("version").notNull().default(1),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** The analytics taxonomy ("Food", "Drinks"). Orthogonal to catalogue; snapshotted onto
 * the sale line as a label so a roll-up sums one canonical bucket across catalogues. */
export const categories = table("categories", {
  id: id("id").primaryKey().defaultRandom(),
  name: json<Record<string, string>>("name").notNull(),
  stationId: id("station_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** A priced item. Catalogue-owned `product_units` assigns its unit without a reverse migration edge.
 * Deactivate via `active`, never delete (may sit behind historical sale-line snapshots). */
export const products = table(
  "products",
  {
    id: id("id").primaryKey().defaultRandom(),
    catalogueId: id("catalogue_id")
      .notNull()
      .references(() => catalogues.id),
    // The primary category; catalogue replaces it together with the complete membership set.
    categoryId: id("category_id").references(() => categories.id),
    stationId: id("station_id"),
    courseId: id("course_id"),
    // Staff-facing product name — plain text, shown on the dashboard, till buttons/basket and reports.
    name: label("name").notNull(),
    // Customer-facing translated name; null or a blank entry means "use `name`". Shown on receipts,
    // invoice lines, the customer display and customer menus.
    customerName: json<Record<string, string>>("customer_name"),
    description: json<Record<string, string>>("description"),
    kitchenName: label("kitchen_name"),
    dietaryDeclarations: json<string[]>("dietary_declarations").notNull().default([]),
    pricingUnit: label("pricing_unit").notNull(),
    unitPrice: money("unit_price").notNull(),
    vatClass: label("vat_class").notNull(),
    active: flag("active").notNull().default(true),
    // A path REFERENCE to the product photo (a content-addressed `<sha256>.<ext>` filename served by
    // apps/server's /media route), never bytes. Nullable: a product legitimately has no photo, and
    // null here just means "no picture" — unlike `allergens`' null, which is a PENDING state the
    // till surfaces. `GRANT SELECT, INSERT, UPDATE ON "products" TO app_user`
    // (`packages/db/drizzle/0001_db_baseline_sql.sql`) names no column list, so it covers this column
    // and every column added to the table afterwards.
    image: label("image"),
    // Allergen declaration (EU 1169/2011 Annex II). NULL = not yet reviewed (a compliance gap the
    // till surfaces distinctly); {} = reviewed, contains none of the 14; else per-code presence +
    // optional specific-substance source. Typed with the local `AllergenMap` alias — the db-layer
    // copy of @waitron/catalogue's `ProductAllergens` (structurally identical), kept local because
    // that package depends on THIS one, so the exact AllergenCode-keyed type cannot be imported here.
    allergens: json<AllergenMap>("allergens"),
    // Staff-authored allergen overlay — what a human explicitly declared. NULL = not reviewed.
    // `allergens` (published) is the computed union of this and `recipe_derivation`; the recipe
    // module (@waitron/recipes) writes `recipe_derivation`, catalogue republishes `allergens`.
    manualAllergens: json<AllergenMap>("manual_allergens"),
    // The recipe module's derived floor + a `pending` flag (a recipe with an unreviewed ingredient).
    // NULL = no recipe / module unused. Written only via catalogue's applyRecipeDerivation.
    recipeDerivation: json<{ allergens: AllergenMap; pending: boolean }>("recipe_derivation"),
    // Diet analogue of `recipe_derivation`: the set of reviewed ingredient origins + pending, written
    // by @waitron/recipes. Separate from `recipe_derivation` because allergen-pending and diet-pending
    // are independent (an ingredient may have reviewed allergens but an uncategorised origin).
    dietDerivation: json<{ origins: string[]; pending: boolean }>("diet_derivation"),
    // Staff override — forced vegan/vegetarian/halal/kosher + hand contains-tags. halal/kosher live
    // ONLY here (no derivation). NULL = no override.
    dietOverride: json<{
      vegan?: "yes" | "no";
      vegetarian?: "yes" | "no";
      halal?: "yes" | "no";
      kosher?: "yes" | "no";
      addContains?: string[];
      removeContains?: string[];
    }>("diet_override"),
    // Published, display diet profile — the diet twin of the published `allergens` column, recomputed
    // by @waitron/catalogue whenever derivation or override changes. Read by the menu filter/grid.
    diet: json<{
      vegan: "yes" | "no" | "unknown";
      vegetarian: "yes" | "no" | "unknown";
      contains: string[];
      halal?: "yes" | "no";
      kosher?: "yes" | "no";
    }>("diet"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("products_catalogue_id_idx").on(t.catalogueId),
    // Target for the foreign keys that name a product. Used
    // by working_order_lines_product_fk (schema/orders.ts): a draft line cannot price against a
    check("products_pricing_unit_ck", sql`${t.pricingUnit} in ('each','weight')`),
    check(
      "products_vat_class_ck",
      sql`${t.vatClass} in ('general','reduced','super_reduced','zero')`,
    ),
  ],
);

/** A reusable, named group of choices ("Size", "Extras") that attaches to many products via
 * `product_option_groups`. `min_select`/`max_select` bound how many items a diner may pick;
 * `required` forces at least one. `name` is a locale→string map. Deactivate via `active`, never
 * delete a group that historical order/sale-line snapshots may reference by copied value. */
export const optionGroups = table(
  "option_groups",
  {
    id: id("id").primaryKey().defaultRandom(),
    name: json<Record<string, string>>("name").notNull(),
    type: label("type").$type<"text" | "extras" | "options">().notNull().default("extras"),
    maxTotalQuantity: count("max_total_quantity"),
    defaultChoiceId: id("default_choice_id"),
    minSelect: count("min_select").notNull().default(0),
    maxSelect: count("max_select").notNull().default(1),
    required: flag("required").notNull().default(false),
    sort: count("sort").notNull().default(0),
    active: flag("active").notNull().default(true),
  },
  (t) => [
    check("option_groups_type_ck", sql`${t.type} in ('text','extras','options')`),
    check(
      "option_groups_total_ck",
      sql`${t.maxTotalQuantity} is null or ${t.maxTotalQuantity} >= 1`,
    ),
    // Target for the foreign keys the children (option_group_items, product_option_groups) carry.
    // `id` alone is already unique (it is the PK); this adds the composite so the FK is
    // rather than merely referential.
    // min_select >= 0 and max_select >= min_select. Design §3 invariant, enforced in the DB.
    check("option_groups_select_ck", sql`${t.maxSelect} >= ${t.minSelect} and ${t.minSelect} >= 0`),
    // required implies at least one selection. Design §3 invariant.
    check("option_groups_required_ck", sql`${t.required} = false or ${t.minSelect} >= 1`),
  ],
);

/** The individual choices within an `option_groups` row. `price_delta` is GROSS (VAT-inclusive) and
 * added to the parent dish's price when the item is chosen. `vat_class` NULL means "inherit the
 * parent dish's rate at add time"; a non-null value matches `products.vat_class`. Deactivate via
 * `active`. The `group_id` FK cascades on group delete. */
export const optionGroupItems = table(
  "option_group_items",
  {
    id: id("id").primaryKey().defaultRandom(),
    groupId: id("group_id").notNull(),
    name: json<Record<string, string>>("name").notNull(),
    priceDelta: money("price_delta").notNull().default("0"),
    vatClass: label("vat_class"),
    // The AUTHORED cap on how many of THIS option a diner may take on one dish (per-option quantity).
    // `1` (the default) means "no per-option quantity" — the option behaves exactly as before this
    // column existed, its child line counted at the dish quantity alone. A value of N lets a diner
    // take the option up to ×N per dish; the pricer multiplies the dish quantity by the chosen count.
    maxQuantity: count("max_quantity").notNull().default(1),
    preselected: flag("preselected").notNull().default(false),
    addAllergens: json<AllergenMap>("add_allergens"),
    // The choice's POSITIVE dietary suitability (a subset of vegan/vegetarian/halal/kosher). Replaces
    // the retired negative `dietary_effect = { invalidates }`; shown per item, never folded.
    dietarySuitability: json<string[]>("dietary_suitability"),
    sort: count("sort").notNull().default(0),
    active: flag("active").notNull().default(true),
  },
  (t) => [
    index("option_group_items_group_idx").on(t.groupId),
    // A per-option cap is meaningless below 1: an option a diner can take zero times is just an
    // inactive option. Enforced in the DB so no authoring path can persist a nonsensical cap.
    check("option_group_items_qty_ck", sql`${t.maxQuantity} >= 1`),
    // Cascades so
    // deleting a group removes its items. NULL vat_class = inherit; a non-null must match products'.
    foreignKey({
      columns: [t.groupId],
      foreignColumns: [optionGroups.id],
      name: "option_group_items_group_fk",
    }).onDelete("cascade"),
  ],
);

/** The many-to-many attaching reusable `option_groups` to `products` — one group serves many dishes.
 * `sort` orders the groups within a product's modifier UI. Both FKs cascade,
 * so detaching happens by deleting the link row (never by deleting the shared group). */
export const productOptionGroups = table(
  "product_option_groups",
  {
    productId: id("product_id").notNull(),
    groupId: id("group_id").notNull(),
    sort: count("sort").notNull().default(0),
  },
  (t) => [
    // `(product_id, group_id)` IS the identity, as in the other join tables (station_printers,
    // location_catalogues): a product names a group at most once.
    primaryKey({ columns: [t.productId, t.groupId], name: "product_option_groups_pk" }),
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "product_option_groups_product_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.groupId],
      foreignColumns: [optionGroups.id],
      name: "product_option_groups_group_fk",
    }).onDelete("cascade"),
  ],
);
