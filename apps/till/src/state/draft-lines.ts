import { divideDecimal, decimal, draftLineMergeKey, QUANTITY_SCALE } from "@waitron/shared";
import type { OptionSelection, OptionSnapshot } from "@waitron/shared";
import {
  menuOfferToTillProduct,
  type DraftLineInput,
  type FreshDraftLine,
  type FreshDraftLineInput,
  type RecalledDraftLine,
  type TillMenuOffer,
  type TillProduct,
} from "../api/client.js";
import { optionSnapshotOf } from "./held-options.js";
import {
  displayQuantity,
  productAsVariant,
  quantityPlaces,
  takesExtras,
  toWireModifiers,
} from "./order-line.js";
import type { OrderLine, SelectedExtra } from "./working-order.js";
import { trimQuantity } from "../widgets/dish-format.js";
import { productUnit } from "../widgets/product-name.js";

export function toDraftLineInput(line: OrderLine): DraftLineInput {
  const note = line.note?.trim() ?? "";
  const common = {
    note: note === "" ? null : note,
    quantity: line.quantity,
    courseId: line.courseId ?? null,
    slot: line.place?.kind === "new" ? line.place.slot : 0,
    joinGroupId: line.place?.kind === "join" ? line.place.groupId : null,
    afterGroupId: line.place?.kind === "new" ? (line.place.afterGroupId ?? null) : null,
  };
  if (line.source !== undefined) {
    if (line.draftLineId === undefined) throw new Error("recalled line has no draft reference");
    return {
      ...common,
      id: line.draftLineId,
      sourceLineId: line.source.line.id,
      makeAt: line.makeAt ?? null,
    };
  }
  const { product } = line;
  if (product.menuItemId === undefined) {
    throw new Error(`product ${product.id} has no menu item to order it by`);
  }
  return {
    ...common,
    ...(line.draftLineId === undefined ? {} : { id: line.draftLineId }),
    menuItemId: product.menuItemId,
    variantId: product.variantId ?? null,
    menuVersionId: product.menuVersionId ?? null,
    options: line.options ?? [],
    extras: toWireModifiers(line).extras ?? [],
    ...(line.makeAt === undefined ? {} : { makeAt: line.makeAt }),
    noMerge: line.noMerge === true,
  };
}

export function orderLineMergeKey(line: OrderLine): string | null {
  if (line.source !== undefined || line.product.menuItemId === undefined) return null;
  const input = toDraftLineInput(line);
  return input.sourceLineId != null ? null : draftLineMergeKey(input);
}

/**
 * A saved fresh draft line as the till shows it, named and priced from `offers` (the table zone's live
 * offers, by menu item id) the way a tap builds a line. The product keeps the line's own menu
 * version, so a line naming another version than the live one is still seen as stale; with
 * `liveVersions` (the version each menu's offers come from) such a line is marked as holding no
 * price of its own version, since the price shown is the live one. That version may be older or
 * newer than the offers the till holds.
 *
 * Nothing the offer no longer holds is dropped: the ids go back on the next save as they came. A
 * pick on a dish or variant whose unit now takes no extras (`takesExtras`) counts as one the offer
 * no longer holds. A dish no longer offered at all is marked, and has no name, because the server
 * sends none. A saved quantity finer than the offered unit now allows is kept and marked, under a
 * unit widened to the quantity scale, so pricing the preview does not refuse it.
 */
export function fromDraftLine(
  line:
    | (Omit<FreshDraftLine, "id" | "source" | "sourceLineId"> & {
        id?: string;
        sourceLineId?: null;
        source?: null;
      })
    | RecalledDraftLine,
  offers: ReadonlyMap<string, TillMenuOffer>,
  liveVersions?: ReadonlyMap<string, string>,
): OrderLine {
  if (line.sourceLineId != null) return fromRecalledLine(line);
  const offer = offers.get(line.menuItemId);
  const earlierPrice =
    offer !== undefined &&
    line.menuVersionId !== null &&
    liveVersions !== undefined &&
    liveVersions.get(offer.menuId) !== line.menuVersionId;
  const offered =
    offer === undefined
      ? unofferedProduct(line)
      : asVariant(menuOfferToTillProduct(offer, line.menuVersionId ?? undefined), line.variantId);
  const unit = productUnit(offered);
  const fits = quantityPlaces(line.quantity) <= unit.precision;
  const product = fits ? offered : { ...offered, unit: { ...unit, precision: QUANTITY_SCALE } };
  const extrasLists = offer !== undefined && takesExtras(offered) ? offer.offeredModifiers : [];
  const extras = line.extras.flatMap(({ listId, picks }) =>
    picks.map((pick) => extraOf(extrasLists, listId, pick)),
  );
  const snapshots = line.options.flatMap((answer) => snapshotOf(offer, answer));
  return {
    ...(line.id === undefined ? {} : { draftLineId: line.id }),
    product,
    ...(line.joinGroupId !== null
      ? { place: { kind: "join" as const, groupId: line.joinGroupId } }
      : line.slot > 0
        ? {
            place: {
              kind: "new" as const,
              slot: line.slot,
              ...(line.afterGroupId === null ? {} : { afterGroupId: line.afterGroupId }),
            },
          }
        : {}),
    quantity:
      offer === undefined ? trimQuantity(line.quantity) : displayQuantity(product, line.quantity),
    ...(offer === undefined ? { notOffered: true as const, blocked: "removed" as const } : {}),
    ...(fits ? {} : { blocked: "unit_changed" as const }),
    ...(extras.length === 0 ? {} : { extras }),
    ...(line.options.length === 0 ? {} : { options: line.options }),
    ...(snapshots.length === 0 ? {} : { optionSnapshots: snapshots }),
    ...(line.note === null ? {} : { note: line.note }),
    ...(line.courseId === null ? {} : { courseId: line.courseId }),
    ...(line.course?.id === line.courseId ? { course: line.course } : {}),
    ...(line.makeAt == null ? {} : { makeAt: line.makeAt }),
    ...(line.noMerge ? { noMerge: true as const } : {}),
    ...(line.unavailable ? { unavailableOnServer: true as const } : {}),
    ...(earlierPrice ? { earlierPriceUnknown: true as const } : {}),
  };
}

/**
 * By index, each line kept as no longer offered whose menu item `offers` holds again, rebuilt as
 * {@link fromDraftLine} would build it from the line as its draft saves it now. The quantity is the
 * one the kept line holds, whose trailing zeros were dropped when it was read, so a weighed dish
 * saved as "0.350" comes back as "0.35" where a fresh read shows "0.350". The saved line is
 * unchanged.
 */
export function rebuildReturned(
  lines: readonly OrderLine[],
  offers: ReadonlyMap<string, TillMenuOffer>,
  liveVersions: ReadonlyMap<string, string>,
): Map<number, OrderLine> {
  const rebuilt = new Map<number, OrderLine>();
  lines.forEach((line, index) => {
    if (line.source !== undefined) return;
    if (line.notOffered !== true) return;
    const saved = toDraftLineInput(line);
    if (saved.sourceLineId != null) return;
    if (!offers.has(saved.menuItemId)) return;
    const returned = {
      ...saved,
      ...(line.course === undefined ? {} : { course: line.course }),
      unavailable: line.unavailableOnServer === true,
    };
    rebuilt.set(index, fromDraftLine(returned, offers, liveVersions));
  });
  return rebuilt;
}

/** A variant the offer no longer holds keeps its id, sold under the dish's own names. */
function asVariant(dish: TillProduct, variantId: string | null): TillProduct {
  if (variantId === null) return dish;
  const variant = dish.variants?.find((candidate) => candidate.id === variantId);
  return variant === undefined ? { ...dish, variantId } : productAsVariant(dish, variant);
}

/** The zero price, general rate and unit are placeholders: a draft line sends no price, and the
 * server prices it at submit. The unit takes every quantity the server stores. */
function unofferedProduct(line: FreshDraftLineInput): TillProduct {
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

function fromRecalledLine(line: RecalledDraftLine): OrderLine {
  const parent = line.source.line;
  const product: TillProduct = {
    id: parent.productId ?? parent.id,
    name: parent.name ?? "",
    unitPrice: parent.unitPriceGross,
    vatClass: "general",
    category: null,
    allergens: null,
    unit: { ...UNKNOWN_UNIT, precision: parent.unitPrecision ?? QUANTITY_SCALE },
  };
  return {
    draftLineId: line.id,
    workingOrderLineId: line.sourceLineId,
    source: line.source,
    product,
    quantity: displayQuantity(product, line.quantity),
    noMerge: true,
    ...(parent.optionSnapshots?.length ? { optionSnapshots: parent.optionSnapshots } : {}),
    ...(line.source.extras.length
      ? {
          notOfferedExtras: line.source.extras.map((extra) => ({
            productId: extra.productId ?? extra.id,
            name: extra.name ?? "",
            price: extra.unitPriceGross,
            quantity: Number(
              divideDecimal(decimal(extra.quantity), decimal(line.quantity), QUANTITY_SCALE),
            ),
          })),
        }
      : {}),
    ...(line.note === null ? {} : { note: line.note }),
    ...(line.courseId === null ? {} : { courseId: line.courseId }),
    ...(line.course?.id === line.courseId ? { course: line.course } : {}),
    ...(line.makeAt === null ? {} : { makeAt: line.makeAt }),
    ...(line.joinGroupId !== null
      ? { place: { kind: "join" as const, groupId: line.joinGroupId } }
      : line.slot > 0
        ? {
            place: {
              kind: "new" as const,
              slot: line.slot,
              ...(line.afterGroupId === null ? {} : { afterGroupId: line.afterGroupId }),
            },
          }
        : {}),
  };
}

const UNKNOWN_UNIT: NonNullable<TillProduct["unit"]> = {
  id: "",
  name: {},
  abbreviation: {},
  precision: QUANTITY_SCALE,
  hardwareUnit: null,
};

/** A pick `lists` no longer holds keeps its ids, with no name and a placeholder price. */
function extraOf(
  lists: TillMenuOffer["offeredModifiers"],
  listId: string,
  pick: { productId: string; quantity: number },
): SelectedExtra {
  const list = lists.find((entry) => entry.kind === "extras" && entry.id === listId);
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
