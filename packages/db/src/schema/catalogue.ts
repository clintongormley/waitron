import { sql } from "drizzle-orm";
import {
  bigint,
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
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * The db-layer copy of the allergen-declaration shape: a per-code presence map with an optional
 * specific-substance source. Structurally identical to `@waitron/catalogue`'s `ProductAllergens`, but
 * a LOCAL type here on purpose — `@waitron/catalogue` depends on THIS package, so the dependency runs
 * the other way and the exact `AllergenCode`-keyed type cannot be imported here without a cycle.
 */
export type AllergenMap = Record<string, { presence: "contains" | "may_contain"; source?: string }>;

/** A named, shareable menu. Many locations may point at one catalogue (N identical delis share it);
 * a heterogeneous venue set uses one catalogue each. `version` is the sync seam (bumped later). */
export const catalogues = pgTable(
  "catalogues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("catalogues_tenant_id_idx").on(t.tenantId),
    // Composite target so a tenant-scoped join can carry a tenant-consistent (tenant_id, catalogue_id)
    // FK — the same role `products_tenant_id_key` plays. Used by location_catalogues_catalogue_fk
    // (schema/location-catalogues.ts): a membership row cannot reference another tenant's catalogue.
    // `id` alone is already unique (it is the PK); this adds the composite so the FK can be
    // tenant-consistent rather than merely referential.
    unique("catalogues_tenant_id_key").on(t.tenantId, t.id),
  ],
).enableRLS();

/** Tenant-wide analytics taxonomy ("Food", "Drinks"). Orthogonal to catalogue; snapshotted onto
 * the sale line as a label so a roll-up sums one canonical bucket across catalogues. */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    // The DEFAULT kitchen station for products in this category (KDS-1 routing, §2b). Bare NULLABLE
    // uuid: the tenant-consistent (tenant_id, station_id) → kitchen_stations(tenant_id, id) FK is
    // hand-written in the --custom migration. NULL = no category-level route; a fired line then falls
    // to the product override or the location's default station. categories' existing RLS policy +
    // app_user grants (0027) cover this additive column with no change.
    stationId: uuid("station_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("categories_tenant_id_idx").on(t.tenantId)],
).enableRLS();

/** A priced item. `unit_price` is GROSS (VAT-inclusive), per item (`each`) or per kg (`weight`).
 * Deactivate via `active`, never delete (may sit behind historical sale-line snapshots). */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    catalogueId: uuid("catalogue_id")
      .notNull()
      .references(() => catalogues.id),
    categoryId: uuid("category_id").references(() => categories.id),
    // The per-product OVERRIDE kitchen station (KDS-1 routing, §2b) — wins over the category default.
    // Bare NULLABLE uuid: the tenant-consistent (tenant_id, station_id) → kitchen_stations(tenant_id,
    // id) FK is hand-written in the --custom migration. NULL = no override; the fired line then falls to
    // the category default or the location's default station. products' existing RLS policy + app_user
    // grants (0027) cover this additive column with no change.
    stationId: uuid("station_id"),
    // The per-product DEFAULT kitchen course (KDS-2 coursing, §2b) — resolved onto the line at ring
    // time (overridable there). Bare NULLABLE uuid: the tenant-consistent (tenant_id, course_id) →
    // kitchen_courses(tenant_id, id) FK is hand-written in the --custom migration, exactly like
    // `station_id` above. NULL = no default course; such a line fires earliest (spec §2b). products'
    // existing RLS policy + app_user grants (0027) cover this additive column with no change.
    courseId: uuid("course_id"),
    descriptions: jsonb("descriptions").$type<Record<string, string>>().notNull(),
    pricingUnit: text("pricing_unit").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    vatClass: text("vat_class").notNull(),
    active: boolean("active").notNull().default(true),
    // A path REFERENCE to the product photo (a content-addressed `<sha256>.<ext>` filename served by
    // apps/server's /media route), never bytes. Nullable: a product legitimately has no photo, and
    // null here just means "no picture" — unlike `allergens`' null, which is a load-bearing PENDING
    // state. The table-level GRANT + tenant-isolation policy (0027) cover it with no change — proven
    // in catalogue.rls.test.ts (design §5a).
    image: text("image"),
    // Allergen declaration (EU 1169/2011 Annex II). NULL = not yet reviewed (a compliance gap the
    // till surfaces distinctly); {} = reviewed, contains none of the 14; else per-code presence +
    // optional specific-substance source. Typed with the local `AllergenMap` alias — the db-layer
    // copy of @waitron/catalogue's `ProductAllergens` (structurally identical), kept local because
    // that package depends on THIS one, so the exact AllergenCode-keyed type cannot be imported here.
    allergens: jsonb("allergens").$type<AllergenMap>(),
    // Staff-authored allergen overlay — what a human explicitly declared. NULL = not reviewed.
    // `allergens` (published) is the computed union of this and `recipe_derivation`; the recipe
    // module (@waitron/recipes) writes `recipe_derivation`, catalogue republishes `allergens`.
    manualAllergens: jsonb("manual_allergens").$type<AllergenMap>(),
    // The recipe module's derived floor + a `pending` flag (a recipe with an unreviewed ingredient).
    // NULL = no recipe / module unused. Written only via catalogue's applyRecipeDerivation.
    recipeDerivation: jsonb("recipe_derivation").$type<{
      allergens: AllergenMap;
      pending: boolean;
    }>(),
    // Diet analogue of `recipe_derivation`: the set of reviewed ingredient origins + pending, written
    // by @waitron/recipes. Separate from `recipe_derivation` because allergen-pending and diet-pending
    // are independent (an ingredient may have reviewed allergens but an uncategorised origin).
    dietDerivation: jsonb("diet_derivation").$type<{ origins: string[]; pending: boolean }>(),
    // Staff override — forced vegan/vegetarian/halal/kosher + hand contains-tags. halal/kosher live
    // ONLY here (no derivation). NULL = no override.
    dietOverride: jsonb("diet_override").$type<{
      vegan?: "yes" | "no";
      vegetarian?: "yes" | "no";
      halal?: "yes" | "no";
      kosher?: "yes" | "no";
      addContains?: string[];
      removeContains?: string[];
    }>(),
    // Published, display diet profile — the diet twin of the published `allergens` column, recomputed
    // by @waitron/catalogue whenever derivation or override changes. Read by the menu filter/grid.
    diet: jsonb("diet").$type<{
      vegan: "yes" | "no" | "unknown";
      vegetarian: "yes" | "no" | "unknown";
      contains: string[];
      halal?: "yes" | "no";
      kosher?: "yes" | "no";
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("products_catalogue_id_idx").on(t.catalogueId),
    // Composite target so a tenant-scoped table can carry a tenant-consistent (tenant_id,
    // product_id) FK — the same role nodes_tenant_id_key plays for `working_orders`/`sales`. Used
    // by working_order_lines_product_fk (schema/orders.ts): a draft line cannot price against a
    // product belonging to another tenant. `id` alone is already unique (it is the PK); this adds
    // the composite so the FK can be tenant-consistent rather than merely referential.
    unique("products_tenant_id_key").on(t.tenantId, t.id),
    check("products_pricing_unit_ck", sql`${t.pricingUnit} in ('each','weight')`),
    check(
      "products_vat_class_ck",
      sql`${t.vatClass} in ('general','reduced','super_reduced','zero')`,
    ),
  ],
).enableRLS();

/** A reusable, named group of choices ("Size", "Extras") that attaches to many products via
 * `product_option_groups`. `min_select`/`max_select` bound how many items a diner may pick;
 * `required` forces at least one. `name` is a locale→string map. Deactivate via `active`, never
 * delete a group that historical order/sale-line snapshots may reference by copied value. */
export const optionGroups = pgTable(
  "option_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: jsonb("name").$type<Record<string, string>>().notNull(),
    minSelect: integer("min_select").notNull().default(0),
    maxSelect: integer("max_select").notNull().default(1),
    required: boolean("required").notNull().default(false),
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    index("option_groups_tenant_id_idx").on(t.tenantId),
    // Composite target so the tenant-scoped children (option_group_items, product_option_groups) can
    // carry a tenant-consistent (tenant_id, group_id) FK — the same role products_tenant_id_key plays.
    // `id` alone is already unique (it is the PK); this adds the composite so the FK is
    // tenant-consistent rather than merely referential.
    unique("option_groups_tenant_id_key").on(t.tenantId, t.id),
    // min_select >= 0 and max_select >= min_select. Design §3 invariant, enforced in the DB.
    check("option_groups_select_ck", sql`${t.maxSelect} >= ${t.minSelect} and ${t.minSelect} >= 0`),
    // required implies at least one selection. Design §3 invariant.
    check("option_groups_required_ck", sql`${t.required} = false or ${t.minSelect} >= 1`),
  ],
).enableRLS();

/** The individual choices within an `option_groups` row. `price_delta` is GROSS (VAT-inclusive) and
 * added to the parent dish's price when the item is chosen. `vat_class` NULL means "inherit the
 * parent dish's rate at add time"; a non-null value matches `products.vat_class`. Deactivate via
 * `active`. The (tenant_id, group_id) FK is tenant-consistent and cascades on group delete. */
export const optionGroupItems = pgTable(
  "option_group_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    groupId: uuid("group_id").notNull(),
    name: jsonb("name").$type<Record<string, string>>().notNull(),
    priceDelta: numeric("price_delta", { precision: 12, scale: 2 }).notNull().default("0"),
    vatClass: text("vat_class"),
    // The AUTHORED cap on how many of THIS option a diner may take on one dish (per-option quantity).
    // `1` (the default) means "no per-option quantity" — the option behaves exactly as before this
    // column existed, its child line counted at the dish quantity alone. A value of N lets a diner
    // take the option up to ×N per dish; the pricer multiplies the dish quantity by the chosen count.
    maxQuantity: integer("max_quantity").notNull().default(1),
    // The per-option ALLERGEN OVERLAY (EU 1169/2011 Annex II), applied to the dish's published
    // allergens to produce the as-served profile (@waitron/catalogue deriveAsServedAllergens). Both
    // NULLABLE and additive: option_group_items' existing FORCE RLS + policy + app_user grants (0082)
    // cover them with no change (the same way products' allergen overlays ride on products' policy).
    // `add_allergens`: codes this option ADDS ("extra cheese" → milk). NULL = adds nothing.
    addAllergens: jsonb("add_allergens").$type<AllergenMap>(),
    // `remove_allergens`: codes this option REMOVES ("gluten-free bun" → gluten). NULL = removes
    // nothing. A remove only takes effect against a REVIEWED base (Cautious policy, design §4).
    removeAllergens: jsonb("remove_allergens").$type<string[]>(),
    // Per-option ORIGIN overlay (the diet twin of add/remove_allergens). `add_origins`: origins this
    // option introduces ("add bacon" → ["meat"]). `remove_origins`: origins it removes ("no cheese" →
    // ["dairy"]). NULL = none. Additive nullable — rides option_group_items' existing RLS/policy/grants.
    addOrigins: jsonb("add_origins").$type<string[]>(),
    removeOrigins: jsonb("remove_origins").$type<string[]>(),
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    index("option_group_items_group_idx").on(t.groupId),
    unique("option_group_items_tenant_id_key").on(t.tenantId, t.id),
    // A per-option cap is meaningless below 1: an option a diner can take zero times is just an
    // inactive option. Enforced in the DB so no authoring path can persist a nonsensical cap.
    check("option_group_items_qty_ck", sql`${t.maxQuantity} >= 1`),
    // Tenant-consistent FK: an item cannot reference a group belonging to another tenant. Cascades so
    // deleting a group removes its items. NULL vat_class = inherit; a non-null must match products'.
    foreignKey({
      columns: [t.tenantId, t.groupId],
      foreignColumns: [optionGroups.tenantId, optionGroups.id],
      name: "option_group_items_group_fk",
    }).onDelete("cascade"),
  ],
).enableRLS();

/** The many-to-many attaching reusable `option_groups` to `products` — one group serves many dishes.
 * `sort` orders the groups within a product's modifier UI. Both FKs are tenant-consistent and cascade,
 * so detaching happens by deleting the link row (never by deleting the shared group). */
export const productOptionGroups = pgTable(
  "product_option_groups",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    productId: uuid("product_id").notNull(),
    groupId: uuid("group_id").notNull(),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [
    // Tenant-first named PK, matching the other tenant-scoped join tables (station_printers,
    // location_catalogues): a consistent tenant-scoped identity key. `(product_id, group_id)` is
    // already unique (both are tenant-owned uuids and the composite FKs below keep them
    // tenant-consistent), so `tenant_id` adds no new uniqueness — it makes the key shape uniform.
    primaryKey({ columns: [t.tenantId, t.productId, t.groupId], name: "product_option_groups_pk" }),
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
      name: "product_option_groups_product_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tenantId, t.groupId],
      foreignColumns: [optionGroups.tenantId, optionGroups.id],
      name: "product_option_groups_group_fk",
    }).onDelete("cascade"),
  ],
).enableRLS();
