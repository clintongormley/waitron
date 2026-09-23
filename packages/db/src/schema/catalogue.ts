import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import { bigCount, count, flag, id, json, label, money, newId, now, table, ts } from "./columns.js";
import { kitchenCourses } from "./kitchen-courses.js";
import { kitchenStations } from "./kitchen-stations.js";

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
// The bracketed thunk below is resolved by `drizzle-kit generate` in its own CLI process,
// never by `vitest run`, so v8 reports it as a never-invoked function. Same treatment, and
// the same reason, as ./sales.ts.
export const categories = table("categories", {
  id: id("id").primaryKey().$defaultFn(newId),
  name: json<Record<string, string>>("name").notNull(),
  // The category-level kitchen route: a fired line with no product-level station falls back to
  // this one. NULLABLE — a category need not name a station.
  /* v8 ignore start */
  stationId: id("station_id").references(() => kitchenStations.id),
  /* v8 ignore stop */
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
    // Set only on a VARIANT (spec §1.2, §15): the product it is a variant of. One level only, and
    // fixed once set — both enforced by triggers, which cannot be declared here
    // (0004_variant_one_level.sql; scripts/behavioural-triggers.test.ts). Same catalogue as the
    // parent: the composite key below.
    parentId: id("parent_id"),
    // A variant's position among its parent's variants (spec §15.5); unused with no parent.
    variantOrder: count("variant_order").notNull().default(0),
    // The primary category; catalogue replaces it together with the complete membership set.
    /* v8 ignore start */
    categoryId: id("category_id").references(() => categories.id),
    /* v8 ignore stop */
    // The product-level kitchen route, and the product-level course. Both NULLABLE: a line with no
    // station falls back to its category's and then to the venue's default station, and a line with
    // no course fires earliest (spec §2b).
    /* v8 ignore start */
    stationId: id("station_id").references(() => kitchenStations.id),
    /* v8 ignore stop */
    /* v8 ignore start */
    courseId: id("course_id").references(() => kitchenCourses.id),
    /* v8 ignore stop */
    // Staff-facing product name — plain text, shown on the dashboard, till buttons/basket and reports.
    name: label("name").notNull(),
    // Customer-facing translated name; null or a blank entry means "use `name`". Shown on receipts,
    // invoice lines, the customer display and customer menus.
    customerName: json<Record<string, string>>("customer_name"),
    description: json<Record<string, string>>("description"),
    kitchenName: label("kitchen_name"),
    dietaryDeclarations: json<string[]>("dietary_declarations").default([]),
    pricingUnit: label("pricing_unit"),
    unitPrice: money("unit_price"),
    vatClass: label("vat_class"),
    active: flag("active").notNull().default(true),
    // Whether this product may be sold on its own. sold_alone = false marks a full product (price, VAT,
    // allergens, category, unit) intended only to be referenced from elsewhere rather than offered
    // standalone; the menu and till selection is what enforces that (a later slice).
    soldAlone: flag("sold_alone").notNull().default(true),
    // A path REFERENCE to the product photo (a content-addressed `<sha256>.<ext>` filename served
    // by apps/server's /media route), never bytes. Nullable: a product legitimately has no photo,
    // and null here just means "no picture" — unlike `allergens`' null, which is a PENDING state
    // the till surfaces. Nothing at the database decides who may write it: this engine has no roles
    // and no grants, so a column added to this table needs no privilege change, where on PostgreSQL
    // that followed from the table-wide GRANT naming no column list.
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
    unique("products_id_catalogue_key").on(t.id, t.catalogueId),
    unique("products_parent_id_key").on(t.parentId, t.id),
    foreignKey({
      columns: [t.parentId, t.catalogueId],
      foreignColumns: [t.id, t.catalogueId],
    }).onDelete("restrict"),
    // A product with no parent owns every value a variant may inherit (spec §1.2, §15.3).
    check(
      "products_top_level_owns_ck",
      sql`${t.parentId} is not null or (${t.vatClass} is not null and ${t.pricingUnit} is not null and ${t.unitPrice} is not null and ${t.dietaryDeclarations} is not null)`,
    ),
    check("products_pricing_unit_ck", sql`${t.pricingUnit} in ('each','weight')`),
    check(
      "products_vat_class_ck",
      sql`${t.vatClass} in ('general','reduced','super_reduced','zero')`,
    ),
  ],
);
