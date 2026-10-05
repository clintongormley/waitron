import { eq } from "drizzle-orm";
import { now, products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { isStoredColor } from "./color-inheritance.js";
import { productWithId } from "./variant-fallback.js";
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
