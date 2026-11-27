import { inArray, sql } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { aLaCarteUnitCents, offersByProduct } from "@waitron/menu";
import type { FrozenOffer, MenuDocument } from "@waitron/shared";

/** Each named product's own price in cents; null where it sets none. */
async function readOwnPrices(
  tx: Transaction,
  productIds: readonly string[],
): Promise<ReadonlyMap<string, number | null>> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: products.id, unitPrice: products.unitPrice })
    .from(products)
    .where(inArray(products.id, sql`(select value from json_each(${JSON.stringify(ids)}))`));
  return new Map(rows.map(({ id, unitPrice }) => [id, unitPrice]));
}

/**
 * Each line's a la carte price where it was taken from a set-menu copy, from the copy's holding
 * menu; null for a line priced a la carte, whose charged price is its a la carte price.
 */
export async function setMenuALaCartePrices(
  tx: Transaction,
  lines: readonly { holding?: MenuDocument; productId: string; variantId: string | null }[],
): Promise<(number | null)[]> {
  const own = await readOwnPrices(
    tx,
    lines.flatMap(({ holding, productId, variantId }) =>
      holding === undefined ? [] : variantId === null ? [productId] : [productId, variantId],
    ),
  );
  const offers = new Map<MenuDocument, ReadonlyMap<string, FrozenOffer>>();
  return lines.map(({ holding, productId, variantId }) => {
    if (holding === undefined) return null;
    let byProduct = offers.get(holding);
    if (byProduct === undefined) offers.set(holding, (byProduct = offersByProduct(holding)));
    // `products_top_level_owns_ck` refuses a dish without a price; no product code deletes a product.
    const dishCents = own.get(productId);
    if (dishCents == null) throw new Error(`dish ${productId} has no price of its own`);
    return aLaCarteUnitCents(byProduct.get(productId), variantId, {
      dishCents,
      variantCents: variantId === null ? null : (own.get(variantId) ?? null),
    });
  });
}
