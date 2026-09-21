import { sql } from "drizzle-orm";
import { check, index } from "drizzle-orm/sqlite-core";
import { bigCount, flag, id, json, label, money, newId, now, table, ts } from "./columns.js";

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
  id: id("id").primaryKey().$defaultFn(newId),
  name: label("name").notNull(),
  active: flag("active").notNull().default(true),
  version: bigCount("version").notNull().default(1),
  createdAt: ts("created_at").notNull().$defaultFn(now),
  updatedAt: ts("updated_at").notNull().$defaultFn(now),
});

/** The analytics taxonomy ("Food", "Drinks"). Orthogonal to catalogue; snapshotted onto
 * the sale line as a label so a roll-up sums one canonical bucket across catalogues. */
export const categories = table("categories", {
  id: id("id").primaryKey().$defaultFn(newId),
  name: json<Record<string, string>>("name").notNull(),
  stationId: id("station_id"),
  createdAt: ts("created_at").notNull().$defaultFn(now),
  updatedAt: ts("updated_at").notNull().$defaultFn(now),
});

/** A priced item. Catalogue-owned `product_units` assigns its unit without a reverse migration edge.
 * Deactivate via `active`, never delete (may sit behind historical sale-line snapshots). */
// The bracketed thunks below are resolved by `drizzle-kit generate` in its own CLI process,
// never by `vitest run`, so v8 reports them as never-invoked functions. Same treatment, and
// the same reason, as ./sales.ts.
export const products = table(
  "products",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    catalogueId: id("catalogue_id")
      .notNull()
      /* v8 ignore start */
      .references(() => catalogues.id),
    /* v8 ignore stop */
    // The primary category; catalogue replaces it together with the complete membership set.
    /* v8 ignore start */
    categoryId: id("category_id").references(() => categories.id),
    /* v8 ignore stop */
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
    // Whether this product may be sold on its own. sold_alone = false marks a full product (price, VAT,
    // allergens, category, unit) intended only to be referenced from elsewhere rather than offered
    // standalone; the menu and till selection is what enforces that (a later slice).
    soldAlone: flag("sold_alone").notNull().default(true),
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
    createdAt: ts("created_at").notNull().$defaultFn(now),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
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
