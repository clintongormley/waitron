import { eq, inArray } from "drizzle-orm";
import { products, type Transaction } from "@waitron/db";
import { centsToDecimal } from "@waitron/shared";
import { readExtraListsByIds, resolveExtraPrice } from "./extras.js";
import { readProductModifiers } from "./product-modifiers.js";
import { effectiveProductColumns, parentJoin, parentProducts } from "./variant-fallback.js";
import { unitOwnerJoin } from "./variant-fallback.js";
import { productUnits, units } from "./schema/units.js";
import { EACH_UNIT } from "./units.js";
import type { ExtraList, ExtraListItem } from "./extra-contract.js";
import type { ProductModifierRef } from "./product-modifiers.js";

/**
 * A list item with its price already settled: never null, because the fallback chain ends at the
 * product's `unit_price`, which is not on the item, so a till or menu screen could not resolve it.
 */
export type ResolvedExtraListItem = Omit<ExtraListItem, "price" | "portion"> & {
  price: string;
  portion: string;
  unit: {
    id: string;
    name: Record<string, string>;
    abbreviation: Record<string, string>;
    precision: number;
    hardwareUnit: "kg" | "g" | "mg" | null;
  };
};

/** A list with every item priced — what the product projection hands back. */
export type ResolvedExtraList = Omit<ExtraList, "items"> & { items: ResolvedExtraListItem[] };

/**
 * The EFFECTIVE `unit_price` (a variant with none borrows its parent's) of every product an item
 * still has to borrow one from: only an item with no price of its own. ONE query,
 * and none when nothing has to borrow.
 */
async function borrowedProductFacts(
  tx: Transaction,
  candidates: ExtraListItem[],
): Promise<Map<string, { unitPrice: string; unit: ResolvedExtraListItem["unit"] }>> {
  const named = [...new Set(candidates.map((item) => item.productId))];
  if (named.length === 0) return new Map();
  const rows = await tx
    .select({
      id: products.id,
      unitPrice: effectiveProductColumns.unitPrice,
      unitId: units.id,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      unitPrecision: units.precision,
      unitHardwareUnit: units.hardwareUnit,
    })
    .from(products)
    .leftJoin(parentProducts, parentJoin)
    .leftJoin(productUnits, unitOwnerJoin)
    .leftJoin(units, eq(units.id, productUnits.unitId))
    .where(inArray(products.id, named));
  return new Map(
    rows.map((product) => [
      product.id,
      {
        unitPrice: centsToDecimal(product.unitPrice),
        unit:
          product.unitId === null
            ? {
                id: EACH_UNIT.id,
                name: EACH_UNIT.name,
                abbreviation: EACH_UNIT.abbreviation,
                precision: EACH_UNIT.precision,
                hardwareUnit: EACH_UNIT.hardwareUnit,
              }
            : {
                id: product.unitId,
                name: product.unitName!,
                abbreviation: product.unitAbbreviation!,
                precision: product.unitPrecision!,
                hardwareUnit: product.unitHardwareUnit as "kg" | "g" | "mg" | null,
              },
      },
    ]),
  );
}

/**
 * The candidates that can be priced, in the order they came in. An item that cannot be priced cannot
 * be sold, so it is left out — which can leave an ACTIVE list with no items at all, a shape
 * `parseExtraListInput` refuses on the authoring side.
 */
function priceItems(
  candidates: ExtraListItem[],
  productsById: Map<string, { unitPrice: string; unit: ResolvedExtraListItem["unit"] }>,
): ResolvedExtraListItem[] {
  return candidates.flatMap((item): ResolvedExtraListItem[] => {
    const product = productsById.get(item.productId);
    const price = resolveExtraPrice(item, product);
    return price === undefined || product === undefined
      ? []
      : [{ ...item, price, portion: item.portion ?? "1", unit: product.unit }];
  });
}

async function resolveHeldLists(
  tx: Transaction,
  offered: { holder: string; definition: ExtraList; items: ExtraListItem[] }[],
): Promise<Map<string, ResolvedExtraList[]>> {
  const productsById = await borrowedProductFacts(
    tx,
    offered.flatMap(({ items }) => items),
  );
  const result = new Map<string, ResolvedExtraList[]>();
  for (const { holder, definition, items } of offered) {
    const held = result.get(holder) ?? [];
    held.push({ ...definition, items: priceItems(items, productsById) });
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
