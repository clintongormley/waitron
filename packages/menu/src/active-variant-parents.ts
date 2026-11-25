import { and, eq, inArray, isNotNull, type SQL } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";

async function withActiveVariants(tx: Transaction, parent: SQL): Promise<Set<string>> {
  const rows = await tx
    .selectDistinct({ parentId: products.parentId })
    .from(products)
    .where(and(parent, eq(products.active, true)));
  return new Set(rows.map((row) => row.parentId!));
}

/**
 * Which of `productIds` have at least one Active variant, Available or not, in ONE query. Such a
 * product is never sold as itself, as a dish or as an extras pick: only a dish line
 * rung up from a menu offer can name the variant to sell.
 */
export async function parentsWithActiveVariants(
  tx: Transaction,
  productIds: readonly string[],
): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  return withActiveVariants(tx, inArray(products.parentId, [...new Set(productIds)]));
}

/** Every product with at least one Active variant, Available or not. */
export async function allParentsWithActiveVariants(tx: Transaction): Promise<Set<string>> {
  return withActiveVariants(tx, isNotNull(products.parentId));
}
