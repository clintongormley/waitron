import { inArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { centsToDecimal } from "@waitron/shared";
import { menuItemExtraItems, menuItemExtraLists } from "./schema/extras.js";
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

/** A list with every item priced — what both projections in this file hand back. */
export type ResolvedExtraList = Omit<ExtraList, "items"> & { items: ResolvedExtraListItem[] };

const key = (menuItemId: string, listId: string, productId: string) =>
  `${menuItemId}\u0000${listId}\u0000${productId}`;

/** An item to price, with the menu price that outranks its own (null on a product read). */
type Candidate = { item: ExtraListItem; menuPrice: string | null };

/**
 * The EFFECTIVE `unit_price` (a variant with none borrows its parent's) of every product an item
 * still has to borrow one from: only an item with no menu price AND no price of its own. ONE query,
 * and none when nothing has to borrow.
 */
async function borrowedUnitPrices(
  tx: Transaction,
  candidates: Candidate[],
): Promise<Map<string, { unitPrice: string }>> {
  const named = [
    ...new Set(
      candidates.flatMap(({ item, menuPrice }) =>
        menuPrice === null && item.price === null ? [item.productId] : [],
      ),
    ),
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
  candidates: Candidate[],
  unitPrices: Map<string, { unitPrice: string }>,
): ResolvedExtraListItem[] {
  return candidates.flatMap(({ item, menuPrice }): ResolvedExtraListItem[] => {
    const price = resolveExtraPrice(item, unitPrices.get(item.productId), menuPrice);
    return price === undefined ? [] : [{ ...item, price }];
  });
}

/**
 * The step both reads below finish with: settle each list's prices and group the lists under
 * whatever HOLDS them — a menu offer in one read, a product in the other. The order of `offered` is
 * the order each holder's lists come back in.
 */
async function resolveHeldLists(
  tx: Transaction,
  offered: { holder: string; definition: ExtraList; items: Candidate[] }[],
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
 * What each menu offer publishes: its extras lists in `display_order`, each narrowed and repriced
 * by that offer's own rows, with the semantics `setMenuItemExtraLists` (extras.ts) documents. A row
 * naming a product the list no longer offers is read by nothing here (schema/extras.ts).
 *
 * An INACTIVE list is returned rather than dropped: its `active` flag is what
 * `validateExtraSelections` (extra-contract.ts) reads to answer only the ACTIVE lists.
 *
 * A bounded number of queries whatever the number of menu items.
 */
export async function readMenuExtras(
  tx: Transaction,
  menuItemIds: string[],
): Promise<Map<string, ResolvedExtraList[]>> {
  if (menuItemIds.length === 0) return new Map();
  const publications = await tx
    .select({
      menuItemId: menuItemExtraLists.menuItemId,
      listId: menuItemExtraLists.listId,
    })
    .from(menuItemExtraLists)
    .where(inArray(menuItemExtraLists.menuItemId, menuItemIds))
    .orderBy(menuItemExtraLists.displayOrder, menuItemExtraLists.listId);
  if (publications.length === 0) return new Map();

  const lists = await readExtraListsByIds(tx, [
    ...new Set(publications.map((publication) => publication.listId)),
  ]);
  const definitions = new Map(lists.map((list) => [list.id, list]));
  const overrideRows = await tx
    .select()
    .from(menuItemExtraItems)
    .where(inArray(menuItemExtraItems.menuItemId, menuItemIds));
  const overrides = new Map(
    overrideRows.map((row) => [
      key(row.menuItemId, row.listId, row.productId),
      // A null override price means "no menu price", which is not the same offer as a price of
      // zero: the chain below falls through on null and stops on 0.00.
      { price: row.price === null ? null : centsToDecimal(row.price), available: row.available },
    ]),
  );

  const offered = publications.flatMap((publication) => {
    const definition = definitions.get(publication.listId);
    if (definition === undefined) return [];
    const items = definition.items.flatMap((item): Candidate[] => {
      const override = overrides.get(key(publication.menuItemId, definition.id, item.productId));
      if (override?.available === false) return [];
      return [{ item, menuPrice: override?.price ?? null }];
    });
    return [{ holder: publication.menuItemId, definition, items }];
  });

  return resolveHeldLists(tx, offered);
}

/**
 * What each PRODUCT itself carries: the extras lists attached to it in `product_modifiers`, in the
 * product's attachment order, each item priced from the list item and then from the product — no
 * menu offer's overrides or withdrawals apply.
 *
 * Keyed by product id as `readProductModifiers` (product-modifiers.ts) keys its map, so a caller
 * holding an upper-cased id has to lower-case it before looking one up. A product carrying no
 * extras list has no entry. An INACTIVE list is returned, as in {@link readMenuExtras}.
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
        items: definition.items.map((item): Candidate => ({ item, menuPrice: null })),
      },
    ];
  });

  return resolveHeldLists(tx, offered);
}
