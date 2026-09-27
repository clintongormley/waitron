import type { Transaction } from "@waitron/db";
import { FALLBACK_LOCALE, type SaleLineClassification } from "@waitron/shared";
import { readContentLanguages } from "./content-languages.js";
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
  // The language `priceOrderLines` (apps/server/src/working-order.ts) records a snapshot in.
  const { defaultLanguage } = await readContentLanguages(tx, FALLBACK_LOCALE);
  const loaded = await loadClassification(tx, productIds, defaultLanguage);
  return new Map([...loaded.products.keys()].map((id) => [id, classifyLine(loaded, id)]));
}
