import type { Transaction } from "@waitron/db";
import { readRecordedDocuments } from "@waitron/menu";
import { AppError, decimal, setMenuProductIds, type Decimal } from "@waitron/shared";
import "./errors.js";

/** What {@link setMenuWeights} reads of a covered dish's line. */
export interface WeighedDish {
  productId: string;
  /** The full menu's copy the line was sold from. */
  menuVersionId: string | null;
  /** The product's own price: a variant's own, else its dish's. */
  productPrice: Decimal;
}

/**
 * Each dish's weight in its set menu's price (S2), at its index: its ordinary offer's price in the
 * menu copy its line records (a variant's price there), else its product's own price.
 */
export async function setMenuWeights(
  tx: Transaction,
  dishes: readonly WeighedDish[],
): Promise<Decimal[]> {
  if (dishes.length === 0) return [];
  const versionIds = [...new Set(dishes.flatMap(({ menuVersionId }) => menuVersionId ?? []))];
  const documents = await readRecordedDocuments(tx, versionIds);
  const pricesByVersion = new Map<string, Map<string, string>>();
  for (const [versionId, document] of documents) {
    const prices = new Map<string, string>();
    for (const offer of Object.values(document.offers)) {
      prices.set(offer.productId, offer.unitPrice);
      for (const variant of offer.variants) prices.set(variant.id, variant.unitPrice);
    }
    pricesByVersion.set(versionId, prices);
  }
  return dishes.map(({ productId, menuVersionId, productPrice }) => {
    const offered =
      menuVersionId === null ? undefined : pricesByVersion.get(menuVersionId)?.get(productId);
    return offered === undefined ? productPrice : decimal(offered);
  });
}

/**
 * The products each set menu's recorded copy can hold (`setMenuProductIds`), at its index. Refused
 * `menu.reset_required` when a copy cannot be read or no longer holds its set menu.
 */
export async function recordedProducts(
  tx: Transaction,
  copies: readonly { setMenuId: string; versionId: string }[],
): Promise<string[][]> {
  if (copies.length === 0) return [];
  const documents = await readRecordedDocuments(
    tx,
    copies.map(({ versionId }) => versionId),
  );
  return copies.map(({ setMenuId, versionId }) => {
    const copy = documents.get(versionId)?.setMenus?.[setMenuId];
    if (copy === undefined) throw new AppError("menu.reset_required", { menuId: setMenuId });
    return setMenuProductIds(copy);
  });
}
