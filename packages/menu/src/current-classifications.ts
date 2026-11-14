import type { Transaction } from "@waitron/db";
import type { SaleLineClassification } from "@waitron/shared";
import { classifyLine, loadClassification } from "./sale-classification.js";

/**
 * Today's classification of each listed product, built exactly as a sale line's recorded snapshot
 * is, so a current-categories report and an at-time-of-sale one name categories from the same
 * source. An id with no product row is left out of the map rather than refused: a report reads
 * such a line as Not recorded.
 */
export async function currentClassifications(
  tx: Transaction,
  productIds: readonly string[],
): Promise<Map<string, SaleLineClassification>> {
  const loaded = await loadClassification(tx, productIds);
  return new Map([...loaded.products.keys()].map((id) => [id, classifyLine(loaded, id)]));
}
