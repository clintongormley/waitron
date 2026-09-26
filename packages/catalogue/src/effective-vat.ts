import { inArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import type { VatClass } from "./pricing.js";
import { effectiveProductColumns, parentJoin, parentProducts } from "./variant-fallback.js";

/**
 * Each product's CURRENT effective VAT class — a variant with none of its own reads its parent's —
 * in one query however many ids are asked for. An id that names no product is absent from the map.
 */
export async function readEffectiveVatClasses(
  tx: Transaction,
  productIds: readonly string[],
): Promise<Map<string, VatClass>> {
  if (productIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: products.id, vatClass: effectiveProductColumns.vatClass })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(inArray(products.id, [...new Set(productIds)]));
  return new Map(rows.map((row) => [row.id, row.vatClass as VatClass]));
}
