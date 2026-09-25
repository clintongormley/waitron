import { and, eq, exists, isNull, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { alias, QueryBuilder } from "drizzle-orm/sqlite-core";
import { products } from "@waitron/db";
import { productLabels } from "./schema/labels.js";
import { productUnits } from "./schema/units.js";

/**
 * The one place a variant's blanks are read as its parent's (spec
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §1.2, as revised by §15.2 and
 * §15.3).
 *
 * A `products` row with a `parent_id` is a variant. Every field in the inherited set below that the
 * variant leaves NULL reads as its parent's value; one it sets reads as its own. The exceptions are
 * the unit, which a variant inherits by having NO `product_units` row of its own, and the labels,
 * which a variant never has of its own — see the owner joins at the end. The three names are never inherited — a blank customer or kitchen name falls back to the
 * variant's OWN staff name — nor is anything that says what the row
 * is (`id`, `catalogue_id`, `parent_id`, `variant_order`), whether it is sold (`active`,
 * `available`, `sold_alone`), or when it was written.
 *
 * The nullability of the four columns a variant may leave blank (`vat_class`, `pricing_unit`,
 * `unit_price`, `dietary_declarations`) stops here for reads that go through
 * `effectiveProductColumns`: their callers see non-null types. A variant's own price is read raw, and
 * may be blank, in the variant list (`ProductVariant.unitPrice`) and in the menu price chain
 * (`readOfferVariants`), and the product editor (`readProductEditor`) reads a variant's own price,
 * VAT class and dietary declarations raw, blanks included. Reads keyed on a product's main
 * category (`listCategoryProducts`, `categoryDependants`) read each row's OWN `category_id`.
 */

/** A `products` row with no parent: a product in its own right, never a variant. */
export const isTopLevelProduct = isNull(products.parentId);

/** The `pricing_unit` to store when a row's unit is cleared: 'each' for a product with no parent,
 * blank for a variant, which then follows its parent's unit and pricing unit. */
export function clearedPricingUnit(): SQL {
  return sql`case when ${products.parentId} is null then 'each' end`;
}

/**
 * Which rows a read or write of ONE product by id may find. `"top-level"` finds only a product with
 * no parent, so a variant's id answers exactly as an id that names no product; `"any"` finds a
 * variant too.
 */
export type ProductScope = "top-level" | "any";

/** The `where` for product `productId` within `scope`. */
export function productWithId(productId: string, scope: ProductScope): SQL {
  return scope === "any"
    ? eq(products.id, productId)
    : and(eq(products.id, productId), isTopLevelProduct)!;
}

/** The parent row of a variant, joined as `parent`. A LEFT join: a top-level product has none. */
export const parentProducts = alias(products, "parent");

/** `.leftJoin(parentProducts, parentJoin)`: every read of {@link effectiveProductColumns} needs it. */
export const parentJoin = eq(parentProducts.id, products.parentId);

const builder = new QueryBuilder();
const ownUnit = alias(productUnits, "own_unit");

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
 * Each inherited field's EFFECTIVE value, keyed by the `products` property it replaces. Valid only
 * in a query that reads `products` unaliased and has `.leftJoin(parentProducts, parentJoin)`.
 */
export const effectiveProductColumns = {
  description: inherited(products.description, parentProducts.description),
  vatClass: owned(products.vatClass, parentProducts.vatClass),
  pricingUnit: owned(products.pricingUnit, parentProducts.pricingUnit),
  unitPrice: owned(products.unitPrice, parentProducts.unitPrice),
  categoryId: inherited(products.categoryId, parentProducts.categoryId),
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
 * inherit, and a top-level product with none reads as Each: its parent id is null, so the
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
 * `.leftJoin(productLabels, labelOwnerJoin)`: the labels of the product whose labels apply — a
 * top-level product's own, and a variant's parent's, since a variant stores none.
 */
export const labelOwnerJoin = eq(
  productLabels.productId,
  sql<string>`coalesce(${products.parentId}, ${products.id})`,
);
