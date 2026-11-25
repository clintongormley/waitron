import { inArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { batches } from "./batches.js";
import { productDeclarationValues, type DeclarationValues } from "./declaration-values.js";
import { effectiveProductColumns, parentJoin, parentProducts } from "./variant-fallback.js";

/** The products' values now, a variant's blank ones taken from its parent. */
export async function readProductDeclarationValues(
  tx: Transaction,
  productIds: readonly string[],
): Promise<Map<string, DeclarationValues>> {
  const result = new Map<string, DeclarationValues>();
  for (const batch of batches([...new Set(productIds)])) {
    const rows = await tx
      .select({
        id: products.id,
        allergens: effectiveProductColumns.allergens,
        dietOverride: effectiveProductColumns.dietOverride,
        dietaryDeclarations: effectiveProductColumns.dietaryDeclarations,
      })
      .from(products)
      .leftJoin(parentProducts, parentJoin)
      .where(inArray(products.id, batch));
    for (const row of rows) result.set(row.id, productDeclarationValues(row));
  }
  return result;
}
