import { draftLinesMerge, QUANTITY_SCALE } from "@waitron/shared";
import type { OptionSelection, OptionSnapshot } from "@waitron/shared";
import {
  menuOfferToTillProduct,
  type DraftLine,
  type DraftLineInput,
  type TillMenuOffer,
  type TillProduct,
} from "../api/client.js";
import { optionSnapshotOf } from "./held-options.js";
import { displayQuantity, productAsVariant, toWireModifiers } from "./order-line.js";
import type { OrderLine, SelectedExtra } from "./working-order.js";
import { productUnit } from "../widgets/product-name.js";

/**
 * The line as a person's draft saves it. The note goes as the server keeps it, trimmed and null when
 * blank, so the till and the server read the merge rule over the same value.
 */
export function toDraftLineInput(line: OrderLine): DraftLineInput {
  const { product } = line;
  if (product.menuItemId === undefined) {
    throw new Error(`product ${product.id} has no menu item to order it by`);
  }
  const note = line.note?.trim() ?? "";
  return {
    menuItemId: product.menuItemId,
    variantId: product.variantId ?? null,
    menuVersionId: product.menuVersionId ?? null,
    options: line.options ?? [],
    extras: toWireModifiers(line).extras ?? [],
    note: note === "" ? null : note,
    quantity: line.quantity,
    courseId: line.courseId ?? null,
    noMerge: line.noMerge === true,
  };
}

/** Whether adding `added` to a draft holding `kept` adds to that line (D10). A line naming no menu
 * item is no draft line, and merges with nothing. */
export function orderLinesMerge(kept: OrderLine, added: OrderLine): boolean {
  if (kept.product.menuItemId === undefined || added.product.menuItemId === undefined) return false;
  return draftLinesMerge(toDraftLineInput(kept), toDraftLineInput(added));
}

/**
 * A saved draft line as the till shows it, named and priced from `offers` (the table zone's live
 * offers, by menu item id) the way a tap builds a line. The product keeps the line's own menu
 * version, so a line priced against an earlier one is still seen as stale.
 *
 * Nothing the offer no longer holds is dropped: the ids go back on the next save as they came. A
 * dish no longer offered at all is marked, and has no name, because the server sends none. A saved
 * quantity finer than the offered unit now allows is kept and marked, under a unit widened to the
 * quantity scale, so pricing the preview does not refuse it.
 */
export function fromDraftLine(
  line: DraftLine,
  offers: ReadonlyMap<string, TillMenuOffer>,
): OrderLine {
  const offer = offers.get(line.menuItemId);
  const offered =
    offer === undefined
      ? unofferedProduct(line)
      : asVariant(menuOfferToTillProduct(offer, line.menuVersionId ?? undefined), line.variantId);
  const unit = productUnit(offered);
  const fits = placesOf(line.quantity) <= unit.precision;
  const product = fits ? offered : { ...offered, unit: { ...unit, precision: QUANTITY_SCALE } };
  const extras = line.extras.flatMap(({ listId, picks }) =>
    picks.map((pick) => extraOf(offer, listId, pick)),
  );
  const snapshots = line.options.flatMap((answer) => snapshotOf(offer, answer));
  return {
    product,
    quantity:
      offer === undefined ? shortest(line.quantity) : displayQuantity(product, line.quantity),
    ...(offer === undefined ? { notOffered: true as const, blocked: "removed" as const } : {}),
    ...(fits ? {} : { blocked: "unit_changed" as const }),
    ...(extras.length === 0 ? {} : { extras }),
    ...(line.options.length === 0 ? {} : { options: line.options }),
    ...(snapshots.length === 0 ? {} : { optionSnapshots: snapshots }),
    ...(line.note === null ? {} : { note: line.note }),
    ...(line.courseId === null ? {} : { courseId: line.courseId }),
    ...(line.noMerge ? { noMerge: true as const } : {}),
  };
}

/** "2.000" reads "2" and "0.350" "0.35": the unit, and so its places, are unknown. */
function shortest(quantity: string): string {
  return quantity.includes(".") ? quantity.replace(/0+$/, "").replace(/\.$/, "") : quantity;
}

/** The decimal places a quantity uses, trailing zeros aside. */
function placesOf(quantity: string): number {
  return (quantity.split(".")[1] ?? "").replace(/0+$/, "").length;
}

/** A variant the offer no longer holds keeps its id, sold under the dish's own names. */
function asVariant(dish: TillProduct, variantId: string | null): TillProduct {
  if (variantId === null) return dish;
  const variant = dish.variants?.find((candidate) => candidate.id === variantId);
  return variant === undefined ? { ...dish, variantId } : productAsVariant(dish, variant);
}

/** The zero price, general rate and unit are placeholders: a draft line sends no price, and the
 * server prices it at submit. The unit takes every quantity the server stores. */
function unofferedProduct(line: DraftLine): TillProduct {
  return {
    id: line.menuItemId,
    menuItemId: line.menuItemId,
    ...(line.variantId === null ? {} : { variantId: line.variantId }),
    ...(line.menuVersionId === null ? {} : { menuVersionId: line.menuVersionId }),
    available: false,
    name: "",
    unitPrice: "0.00",
    vatClass: "general",
    category: null,
    allergens: null,
    unit: UNKNOWN_UNIT,
  };
}

const UNKNOWN_UNIT: NonNullable<TillProduct["unit"]> = {
  id: "",
  name: {},
  abbreviation: {},
  precision: QUANTITY_SCALE,
  hardwareUnit: null,
};

/** A pick the offer no longer holds keeps its ids, with no name and a placeholder price. */
function extraOf(
  offer: TillMenuOffer | undefined,
  listId: string,
  pick: { productId: string; quantity: number },
): SelectedExtra {
  const list = offer?.offeredModifiers.find(
    (entry) => entry.kind === "extras" && entry.id === listId,
  );
  const item =
    list?.kind === "extras"
      ? list.items.find((candidate) => candidate.productId === pick.productId)
      : undefined;
  return {
    listId,
    productId: pick.productId,
    name: item?.name ?? "",
    price: item?.price ?? "0.00",
    quantity: pick.quantity,
  };
}

/** None for an answer the offer's list no longer holds. */
function snapshotOf(offer: TillMenuOffer | undefined, answer: OptionSelection): OptionSnapshot[] {
  const list = offer?.offeredModifiers.find(
    (entry) => entry.kind === "options" && entry.id === answer.listId,
  );
  const label =
    list?.kind === "options"
      ? list.labels.find((candidate) => candidate.id === answer.labelId)
      : undefined;
  return list === undefined || label === undefined ? [] : [optionSnapshotOf(list, label)];
}
