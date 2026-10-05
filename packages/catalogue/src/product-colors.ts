import { eq, inArray } from "drizzle-orm";
import { now, products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { batches } from "./batches.js";
import { listCategories } from "./categories.js";
import { effectiveColor, isStoredColor } from "./color-inheritance.js";
import {
  effectiveProductColumns,
  parentJoin,
  parentProducts,
  productWithId,
} from "./variant-fallback.js";
import "./errors.js";

/** Set a product's own colour, or null to take its category's. A variant has none of its own, so its
 * id answers as an id that names no product, as `setMainReportingCategory` does. */
export async function setProductColor(
  tx: Transaction,
  productId: string,
  color: string | null,
): Promise<void> {
  if (color !== null && !isStoredColor(color))
    throw new AppError("product.invalid", { field: "color" });
  const [product] = await tx
    .select({ id: products.id })
    .from(products)
    .where(productWithId(productId, "top-level"));
  if (!product) throw new AppError("product.not_found", { productId });
  await tx.update(products).set({ color, updatedAt: now() }).where(eq(products.id, product.id));
}

/** Each product's effective colour: two reads (the products in batches, and the category tree once)
 * however many products. */
export async function readEffectiveColors(
  tx: Transaction,
  productIds: readonly string[],
): Promise<Map<string, string | null>> {
  const colors = new Map<string, string | null>();
  if (productIds.length === 0) return colors;
  const categories = new Map((await listCategories(tx)).map((category) => [category.id, category]));
  for (const batch of batches(productIds))
    for (const row of await tx
      .select({
        id: products.id,
        color: effectiveProductColumns.color,
        categoryId: effectiveProductColumns.categoryId,
      })
      .from(products)
      .leftJoin(parentProducts, parentJoin)
      .where(inArray(products.id, batch)))
      colors.set(row.id, effectiveColor(row.color, row.categoryId, categories));
  return colors;
}
