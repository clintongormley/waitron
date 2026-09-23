import { eq, exists, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { alias, QueryBuilder } from "drizzle-orm/sqlite-core";
import { products } from "@waitron/db";
import { productCategories } from "./schema/categories.js";
import { productUnits } from "./schema/units.js";

/**
 * The one place a variant's blanks are read as its parent's (spec §1.2, as revised by §15.2 and
 * §15.3).
 *
 * A `products` row with a `parent_id` is a variant. Every field in the inherited set below that the
 * variant leaves NULL reads as its parent's value; one it sets reads as its own. The exceptions are
 * the category list, the reporting category and the unit, which a variant inherits by having NO
 * `product_categories` or `product_units` row of its own (V12) — see the owner joins at the end.
 * The three names are never inherited — a blank customer or kitchen name falls back to the
 * variant's OWN staff name, the rule every product follows — nor is anything that says what the row
 * is (`id`, `catalogue_id`, `parent_id`, `variant_order`), whether it is sold (`active`,
 * `sold_alone`), or when it was written.
 *
 * The catalogue's product reads, and the order path's read of an extras item, take their inherited
 * values from here, so the nullability of the four columns a variant may leave blank (`vat_class`,
 * `pricing_unit`, `unit_price`, `dietary_declarations`) stops here: their callers see the same
 * non-null types they always did. Reads keyed on an ORDER LINE's product — the kitchen's station
 * routing, its allergen and dietary display, preparation routes — still read the raw columns, and
 * are correct only while no order line names a variant.
 */

/** The parent row of a variant, joined as `parent`. A LEFT join: a top-level product has none. */
export const parentProducts = alias(products, "parent");

const builder = new QueryBuilder();
const ownUnit = alias(productUnits, "own_unit");
const ownCategory = alias(productCategories, "own_category");

/** Whether the `products` row being read has `product_categories` rows of its own. */
const hasOwnCategories = exists(
  builder
    .select({ one: sql`1` })
    .from(ownCategory)
    .where(eq(ownCategory.productId, products.id)),
);

/**
 * `coalesce(product.x, parent.x)`. `.mapWith(column)` keeps the column's own decoding, which the
 * bare `coalesce` loses: measured 2026-09-23 on drizzle-orm 0.45.2, with it removed
 * `variant-fallback.test.ts` reads `description` back as the string `{"en":"A dry white from
 * Rueda"}` rather than the map.
 */
function inherited<C extends AnyColumn>(
  column: C,
  parentColumn: AnyColumn,
): SQL<C["_"]["data"] | null> {
  return sql`coalesce(${column}, ${parentColumn})`.mapWith(column);
}

/**
 * The same, for a column `products_top_level_owns_ck` requires on every product with no parent.
 * A variant's parent exists (the composite foreign key, `on delete restrict`) and has no parent of
 * its own (`products_variant_one_level_insert`), so the coalesce is never null and is typed that way.
 */
function owned<C extends AnyColumn>(column: C, parentColumn: AnyColumn): SQL<C["_"]["data"]> {
  return sql`coalesce(${column}, ${parentColumn})`.mapWith(column);
}

/**
 * The reporting category, taken from the SAME product as the category list
 * ({@link categoryOwnerId}) rather than by coalesce: a variant with category rows of its own and no
 * reporting category reads its own null, never a parent's category that is not in its list.
 */
const reportingCategoryId = sql<string | null>`case
  when ${products.parentId} is null or ${hasOwnCategories} then ${products.categoryId}
  else ${parentProducts.categoryId} end`.mapWith(products.categoryId);

/**
 * Each inherited field's EFFECTIVE value, keyed by the `products` property it replaces. Valid only
 * in a query that reads `products` unaliased and left-joins {@link parentProducts} on
 * `parentProducts.id = products.parentId`.
 */
export const effectiveProductColumns = {
  description: inherited(products.description, parentProducts.description),
  vatClass: owned(products.vatClass, parentProducts.vatClass),
  pricingUnit: owned(products.pricingUnit, parentProducts.pricingUnit),
  unitPrice: owned(products.unitPrice, parentProducts.unitPrice),
  categoryId: reportingCategoryId,
  stationId: inherited(products.stationId, parentProducts.stationId),
  courseId: inherited(products.courseId, parentProducts.courseId),
  image: inherited(products.image, parentProducts.image),
  allergens: inherited(products.allergens, parentProducts.allergens),
  manualAllergens: inherited(products.manualAllergens, parentProducts.manualAllergens),
  recipeDerivation: inherited(products.recipeDerivation, parentProducts.recipeDerivation),
  dietDerivation: inherited(products.dietDerivation, parentProducts.dietDerivation),
  dietOverride: inherited(products.dietOverride, parentProducts.dietOverride),
  diet: inherited(products.diet, parentProducts.diet),
  dietaryDeclarations: owned(products.dietaryDeclarations, parentProducts.dietaryDeclarations),
};

/** The inherited set, as the `products` property names. */
export const INHERITED_KEYS = Object.keys(
  effectiveProductColumns,
) as readonly (keyof typeof effectiveProductColumns)[];

/**
 * The same rule over rows already in memory: a null inherited key takes the parent's value. It sees
 * only the two rows, never their category rows, so it takes a null `categoryId` as the parent's even
 * where {@link effectiveProductColumns} would keep the variant's own.
 */
export function inheritFromParent<T extends Record<string, unknown>>(
  variant: T,
  parent: T | null,
): T {
  if (parent === null) return variant;
  const out: Record<string, unknown> = { ...variant };
  for (const key of INHERITED_KEYS) if (out[key] === null) out[key] = parent[key];
  return out as T;
}

/**
 * The product whose `product_units` row applies to the `products` row being read: its own when it
 * has one, otherwise its parent's. A variant stores NO unit row to inherit (V12), and a top-level
 * product with none reads as Each — its parent id is null, so the join finds nothing.
 *
 * Join on it (`eq(productUnits.productId, unitOwnerId)`) instead of on `products.id`, so the read
 * stays ONE query whatever the number of products.
 */
export const unitOwnerId = sql<string | null>`case when ${exists(
  builder
    .select({ one: sql`1` })
    .from(ownUnit)
    .where(eq(ownUnit.productId, products.id)),
)} then ${products.id} else ${products.parentId} end`;

/**
 * The product whose `product_categories` rows apply: its own when it has any, otherwise its
 * parent's — the same rule as {@link unitOwnerId}, for category membership.
 */
export const categoryOwnerId = sql<
  string | null
>`case when ${hasOwnCategories} then ${products.id} else ${products.parentId} end`;
