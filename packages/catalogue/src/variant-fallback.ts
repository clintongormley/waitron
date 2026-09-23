import { eq, exists, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { alias, QueryBuilder } from "drizzle-orm/sqlite-core";
import { products } from "@waitron/db";
import { productCategories } from "./schema/categories.js";
import { productUnits } from "./schema/units.js";

/**
 * The one place a variant's blanks are read as its parent's (spec
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §1.2, as revised by §15.2 and
 * §15.3). The V-numbered decisions and the Review Focus items cited in this module and its tests are
 * in the plan, `docs/superpowers/plans/2026-09-23-variants-as-products.md`.
 *
 * A `products` row with a `parent_id` is a variant. Every field in the inherited set below that the
 * variant leaves NULL reads as its parent's value; one it sets reads as its own. The exceptions are
 * the category list, the reporting category and the unit, which a variant inherits by having NO
 * `product_categories` or `product_units` row of its own (V12) — see the owner joins at the end.
 * The three names are never inherited — a blank customer or kitchen name falls back to the
 * variant's OWN staff name, the rule every product follows — nor is anything that says what the row
 * is (`id`, `catalogue_id`, `parent_id`, `variant_order`), whether it is sold (`active`,
 * `available`, `sold_alone`), or when it was written.
 *
 * The catalogue's product reads, and the order path's read of an extras item, take their inherited
 * values from here, so the nullability of the four columns a variant may leave blank (`vat_class`,
 * `pricing_unit`, `unit_price`, `dietary_declarations`) stops here: their callers see the same
 * non-null types they always did. The catalogue's reads keyed on CATEGORY MEMBERSHIP read each
 * product's OWN `product_categories` rows, so a variant that inherits its parent's categories is not
 * listed under them there — a category's product list and its delete preview (`categories.ts`) are
 * two; `readProductCategories` refuses a variant's id (`product.not_found`). Reads keyed on an ORDER
 * LINE's product — the
 * kitchen's station routing, its allergen and dietary display, preparation routes — still read the
 * raw columns, and are correct only while no order line names a variant.
 */

/** The parent row of a variant, joined as `parent`. A LEFT join: a top-level product has none. */
export const parentProducts = alias(products, "parent");

/** `.leftJoin(parentProducts, parentJoin)`: every read of {@link effectiveProductColumns} needs it. */
export const parentJoin = eq(parentProducts.id, products.parentId);

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
 * `coalesce(product.x, parent.x)`, decoded as the column is: a bare `coalesce` loses the column's
 * decoding (a JSON column comes back as its text), and `.mapWith(column)` restores it.
 *
 * Typed non-null, for a column `products_top_level_owns_ck` requires on every product with no
 * parent: a variant's parent exists (the composite foreign key, `on delete restrict`) and has no
 * parent of its own (the triggers in `packages/db/drizzle/0004_variant_one_level.sql`), so the value
 * is never null.
 */
function owned<C extends AnyColumn>(column: C, parentColumn: AnyColumn): SQL<C["_"]["data"]> {
  return sql`coalesce(${column}, ${parentColumn})`.mapWith(column);
}

/** {@link owned} for a column a top-level product may leave null, typed nullable. */
function inherited<C extends AnyColumn>(
  column: C,
  parentColumn: AnyColumn,
): SQL<C["_"]["data"] | null> {
  return owned(column, parentColumn);
}

/**
 * The reporting category, taken from the SAME product as the category list
 * ({@link categoryOwnerJoin}) rather than by coalesce: a variant with category rows of its own and no
 * reporting category reads its own null, never a parent's category that is not in its list.
 */
const reportingCategoryId = sql<string | null>`case
  when ${products.parentId} is null or ${hasOwnCategories} then ${products.categoryId}
  else ${parentProducts.categoryId} end`.mapWith(products.categoryId);

/**
 * Each inherited field's EFFECTIVE value, keyed by the `products` property it replaces. Valid only
 * in a query that reads `products` unaliased and has `.leftJoin(parentProducts, parentJoin)`.
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
 * `.leftJoin(productUnits, unitOwnerJoin)`: the `product_units` row of the product whose unit
 * applies — the row's own when it has one, otherwise its parent's. A variant stores NO unit row to
 * inherit (V12), and a top-level product with none reads as Each: its parent id is null, so the
 * join finds nothing. Joined this way the read stays ONE query whatever the number of products.
 */
export const unitOwnerJoin = eq(
  productUnits.productId,
  sql<string | null>`case when ${exists(
    builder
      .select({ one: sql`1` })
      .from(ownUnit)
      .where(eq(ownUnit.productId, products.id)),
  )} then ${products.id} else ${products.parentId} end`,
);

/**
 * `.leftJoin(productCategories, categoryOwnerJoin)`: the same rule as {@link unitOwnerJoin}, for
 * category membership — the row's own `product_categories` rows when it has any, otherwise its
 * parent's.
 */
export const categoryOwnerJoin = eq(
  productCategories.productId,
  sql<
    string | null
  >`case when ${hasOwnCategories} then ${products.id} else ${products.parentId} end`,
);
