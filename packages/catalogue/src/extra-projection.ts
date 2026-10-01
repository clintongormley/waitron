import { inArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { centsToDecimal } from "@waitron/shared";
import { readExtraListsByIds, resolveExtraPrice } from "./extras.js";
import { readProductModifiers } from "./product-modifiers.js";
import { effectiveProductColumns, parentJoin, parentProducts } from "./variant-fallback.js";
import type { ExtraList, ExtraListItem } from "./extra-contract.js";
import type { ProductModifierRef } from "./product-modifiers.js";

/**
 * A list item with its price already settled: never null, because the fallback chain ends at the
 * product's `unit_price`, which is not on the item, so a till or menu screen could not resolve it.
 */
export type ResolvedExtraListItem = Omit<ExtraListItem, "price"> & { price: string };

/** A list with every item priced — what the product projection hands back. */
export type ResolvedExtraList = Omit<ExtraList, "items"> & { items: ResolvedExtraListItem[] };

/**
 * The EFFECTIVE `unit_price` (a variant with none borrows its parent's) of every product an item
 * still has to borrow one from: only an item with no price of its own. ONE query,
 * and none when nothing has to borrow.
 */
async function borrowedUnitPrices(
  tx: Transaction,
  candidates: ExtraListItem[],
): Promise<Map<string, { unitPrice: string }>> {
  const named = [
    ...new Set(candidates.flatMap((item) => (item.price === null ? [item.productId] : []))),
  ];
  if (named.length === 0) return new Map();
  const rows = await tx
    .select({ id: products.id, unitPrice: effectiveProductColumns.unitPrice })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .where(inArray(products.id, named));
  return new Map(
    rows.map((product) => [product.id, { unitPrice: centsToDecimal(product.unitPrice) }]),
  );
}

/**
 * The candidates that can be priced, in the order they came in. An item that cannot be priced cannot
 * be sold, so it is left out — which can leave an ACTIVE list with no items at all, a shape
 * `parseExtraListInput` refuses on the authoring side.
 */
function priceItems(
  candidates: ExtraListItem[],
  unitPrices: Map<string, { unitPrice: string }>,
): ResolvedExtraListItem[] {
  return candidates.flatMap((item): ResolvedExtraListItem[] => {
    const price = resolveExtraPrice(item, unitPrices.get(item.productId));
    return price === undefined ? [] : [{ ...item, price }];
  });
}

async function resolveHeldLists(
  tx: Transaction,
  offered: { holder: string; definition: ExtraList; items: ExtraListItem[] }[],
): Promise<Map<string, ResolvedExtraList[]>> {
  const unitPrices = await borrowedUnitPrices(
    tx,
    offered.flatMap(({ items }) => items),
  );
  const result = new Map<string, ResolvedExtraList[]>();
  for (const { holder, definition, items } of offered) {
    const held = result.get(holder) ?? [];
    held.push({ ...definition, items: priceItems(items, unitPrices) });
    result.set(holder, held);
  }
  return result;
}

/**
 * What each PRODUCT itself carries: the extras lists attached to it in `product_modifiers`, in the
 * product's attachment order, each item priced from the list item and then from the product.
 *
 * Keyed by product id as `readProductModifiers` (product-modifiers.ts) keys its map, so a caller
 * holding an upper-cased id has to lower-case it before looking one up. A product carrying no
 * extras list has no entry. An INACTIVE list is returned rather than dropped.
 *
 * `attachments` is `readProductModifiers`' answer when the caller has already read it, possibly for
 * a wider set of products; it is narrowed to `productIds` here.
 */
export async function readProductExtras(
  tx: Transaction,
  productIds: string[],
  attachments?: ReadonlyMap<string, ProductModifierRef[]>,
): Promise<Map<string, ResolvedExtraList[]>> {
  // Lower-cased to match `readProductModifiers`' keys (product-modifiers.ts).
  const named = new Set(productIds.map((productId) => productId.toLowerCase()));
  const held = attachments ?? (await readProductModifiers(tx, productIds));
  const carried = [...held].flatMap(([productId, refs]) =>
    named.has(productId)
      ? refs.flatMap((ref) => (ref.kind === "extras" ? [{ productId, listId: ref.id }] : []))
      : [],
  );
  if (carried.length === 0) return new Map();

  const lists = await readExtraListsByIds(tx, [...new Set(carried.map((each) => each.listId))]);
  const definitions = new Map(lists.map((list) => [list.id, list]));

  const offered = carried.flatMap(({ productId, listId }) => {
    const definition = definitions.get(listId);
    if (definition === undefined) return [];
    return [
      {
        holder: productId,
        definition,
        items: definition.items,
      },
    ];
  });

  return resolveHeldLists(tx, offered);
}
