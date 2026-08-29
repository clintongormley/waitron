import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
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
