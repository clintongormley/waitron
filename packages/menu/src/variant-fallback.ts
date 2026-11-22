import { and, eq, isNull, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { products, units } from "@waitron/db";
import type { VatClass } from "@waitron/shared";

/** A `products` row with no parent: a product in its own right, never a variant. */
export const isTopLevelProduct = isNull(products.parentId);

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

/**
 * `coalesce(product.x, parent.x)`, decoded as the column is: a bare `coalesce` loses the column's
 * decoding (a JSON column comes back as its text), and `.mapWith(column)` restores it.
 *
 * Typed non-null, for a column `products_top_level_owns_ck` requires on every product with no
 * parent: a variant's parent exists (the composite foreign key, `on delete restrict`) and has no
 * parent of its own (the `products_variant_*` triggers in `packages/db/triggers/core.sql`),
 * so the value is never null.
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

/** The parent's value on a variant, whatever the variant stores; the row's own on a product with no
 * parent. Typed nullable. */
function parentsAlways<C extends AnyColumn>(
  column: C,
  parentColumn: AnyColumn,
): SQL<C["_"]["data"] | null> {
  return sql`case when ${products.parentId} is null then ${column} else ${parentColumn} end`.mapWith(
    column,
  );
}

/**
 * Each inherited field's EFFECTIVE value, keyed by the `products` property it replaces. Valid only
 * in a query that reads `products` unaliased and has `.leftJoin(parentProducts, parentJoin)`.
 */
export const effectiveProductColumns = {
  description: inherited(products.description, parentProducts.description),
  vatClass: owned(products.vatClass, parentProducts.vatClass),
  // A copy's takeaway label is the eat-in one: a product line taken away files at its product's
  // takeaway rate (`product_takeaway_vat_rates`), and nothing reads this label for it. It goes with
  // the label columns (plan PR L).
  takeawayVatClass: owned(products.vatClass, parentProducts.vatClass) as SQL<VatClass>,
  unitPrice: owned(products.unitPrice, parentProducts.unitPrice),
  categoryId: parentsAlways(products.categoryId, parentProducts.categoryId),
  color: parentsAlways(products.color, parentProducts.color),
  courseId: inherited(products.courseId, parentProducts.courseId),
  image: inherited(products.image, parentProducts.image),
  allergens: inherited(products.allergens, parentProducts.allergens),
  dietOverride: inherited(products.dietOverride, parentProducts.dietOverride),
  dietaryDeclarations: owned(products.dietaryDeclarations, parentProducts.dietaryDeclarations),
};

/** The inherited set, as the `products` property names. */
export const INHERITED_KEYS = Object.keys(
  effectiveProductColumns,
) as readonly (keyof typeof effectiveProductColumns)[];

/** Join units after the parent join: a variant always uses its parent's unit. */
export const unitOwnerJoin = eq(
  units.id,
  sql<string>`case when ${products.parentId} is null then ${products.unitId} else ${parentProducts.unitId} end`,
);
