import { effectiveDefaultLabelId } from "@waitron/catalogue/src/option-default.js";
import { compareDecimal } from "@waitron/shared";
import { menuOfferToTillProduct, type MenuUnavailable, type TillMenuOffer } from "../api/client.js";
import { lineProductName, productUnit } from "../widgets/product-name.js";
import { lineGross, productAsVariant, quantityPlaces } from "./order-line.js";
import type { OrderLine } from "./working-order.js";

/** Why a basket line cannot be paid as it stands (D9). */
export type BlockReason =
  | "removed"
  | "unavailable"
  | "variant_removed"
  | "extra_removed"
  | "extra_unavailable"
  | "unit_changed";

export interface LineBlock {
  reason: BlockReason;
  /** The dish, variant, extra or option label the reason is about. */
  name: string;
}

/** One line of the basket-refresh dialog; `lineNo` counts the basket from 1. `from` is absent for a
 * line whose earlier price the till never held. */
export interface ChangedLine {
  lineNo: number;
  name: string;
  from?: string;
  to: string;
}

export interface BlockedLine extends LineBlock {
  lineNo: number;
}

export interface BasketRefresh {
  changed: ChangedLine[];
  blocked: BlockedLine[];
  /** By basket index: each line re-priced from the live version, which it now asserts. A line whose
   * dish or variant the live version no longer offers is left out. */
  adopted: Map<number, OrderLine>;
}

/**
 * The offers with every availability flag read from `unavailable` — the whole of what cannot be sold
 * now — rather than from when they were loaded, so a poll greys and restores without a reload.
 */
export function withUnavailable(
  offers: readonly TillMenuOffer[],
  unavailable: MenuUnavailable,
): TillMenuOffer[] {
  const products = new Set(unavailable.products);
  const labels = new Set(unavailable.optionLabels);
  const withdrawn = new Set(
    unavailable.extraItems.map(
      (item) => `${item.menuItemId} ${item.extraListId} ${item.productId}`,
    ),
  );
  return offers.map((offer) => ({
    ...offer,
    available: !products.has(offer.productId),
    variants: offer.variants.map((variant) => ({
      ...variant,
      available: variant.offered && !products.has(variant.id),
    })),
    offeredModifiers: offer.offeredModifiers.map((entry) => {
      if (entry.kind === "extras")
        return {
          ...entry,
          items: entry.items.map((item) => ({
            ...item,
            available:
              !products.has(item.productId) &&
              !withdrawn.has(`${offer.id} ${entry.id} ${item.productId}`),
          })),
        };
      const withLabels = entry.labels.map((label) => ({
        ...label,
        available: !labels.has(label.id),
      }));
      return {
        ...entry,
        labels: withLabels,
        defaultLabelId: effectiveDefaultLabelId(withLabels, entry.defaultLabelId),
      };
    }),
  }));
}

/** What stops `line` being paid against `offer`, its menu item's current offer, if anything. */
export function lineBlock(
  line: OrderLine,
  offer: TillMenuOffer | undefined,
): LineBlock | undefined {
  const name = lineProductName(line.product);
  if (offer === undefined) return { reason: "removed", name };
  if (!offer.available) return { reason: "unavailable", name };
  let variant: TillMenuOffer["variants"][number] | undefined;
  if (line.product.variantId !== undefined) {
    variant = offer.variants.find((candidate) => candidate.id === line.product.variantId);
    if (variant === undefined || !variant.offered) return { reason: "variant_removed", name };
    if (!variant.available) return { reason: "unavailable", name };
  }
  const { precision } = productUnit(variant ?? offer);
  if (quantityPlaces(line.quantity) > precision) return { reason: "unit_changed", name };
  for (const pick of line.extras ?? []) {
    const list = offer.offeredModifiers.find(
      (entry) => entry.kind === "extras" && entry.id === pick.listId,
    );
    const item =
      list?.kind === "extras"
        ? list.items.find((candidate) => candidate.productId === pick.productId)
        : undefined;
    if (item === undefined) return { reason: "extra_removed", name: pick.name };
    if (!item.available) return { reason: "extra_unavailable", name: pick.name };
  }
  for (const answer of line.options ?? []) {
    const list = offer.offeredModifiers.find(
      (entry) => entry.kind === "options" && entry.id === answer.listId,
    );
    const label =
      list?.kind === "options"
        ? list.labels.find((candidate) => candidate.id === answer.labelId)
        : undefined;
    if (label === undefined)
      return { reason: "extra_removed", name: answeredLabelName(line, answer.labelId) };
    if (!label.available) return { reason: "extra_unavailable", name: label.name };
  }
  return undefined;
}

/** The label's name as the line was offered it; the id when the line never had it. */
function answeredLabelName(line: OrderLine, labelId: string): string {
  for (const entry of line.product.offeredModifiers ?? [])
    if (entry.kind === "options")
      for (const label of entry.labels) if (label.id === labelId) return label.name;
  return labelId;
}

/** `line` as `offer` sells it now: its dish or variant, and each pick, at the live price. */
function adoptLine(line: OrderLine, offer: TillMenuOffer, menuVersionId: string): OrderLine {
  const dish = menuOfferToTillProduct(offer, menuVersionId);
  const variant = dish.variants?.find((candidate) => candidate.id === line.product.variantId);
  const extras = line.extras?.map((pick) => {
    for (const entry of offer.offeredModifiers)
      if (entry.kind === "extras" && entry.id === pick.listId)
        for (const item of entry.items)
          if (item.productId === pick.productId)
            return { ...pick, name: item.name, price: item.price };
    return pick;
  });
  const adopted: OrderLine = {
    ...line,
    product: variant === undefined ? dish : productAsVariant(dish, variant),
    ...(extras === undefined ? {} : { extras }),
  };
  delete adopted.blocked;
  delete adopted.earlierPriceUnknown;
  return adopted;
}

/**
 * By index, each line marked `earlierPriceUnknown` whose version has since become the live one,
 * priced from the live offers. Its saved line already names that version, so only what the till
 * shows changes. A line the live offer cannot hold as it stands is left as it is.
 */
export function repriceRebuilt(
  lines: readonly OrderLine[],
  offerById: ReadonlyMap<string, TillMenuOffer>,
  liveVersions: ReadonlyMap<string, string>,
): Map<number, OrderLine> {
  const repriced = new Map<number, OrderLine>();
  lines.forEach((line, index) => {
    if (line.earlierPriceUnknown !== true || isStale(line, liveVersions)) return;
    const { menuItemId, menuVersionId } = line.product;
    const offer = offerById.get(menuItemId ?? "");
    if (offer === undefined || menuVersionId === undefined) return;
    const reason = lineBlock(line, offer)?.reason;
    if (reason === "variant_removed" || reason === "unit_changed") return;
    repriced.set(index, adoptLine(line, offer, menuVersionId));
  });
  return repriced;
}

/** Whether the line was priced against a version of its menu other than the live one. A line with
 * no version is priced by the server from the live version. */
export function isStale(line: OrderLine, liveVersions: ReadonlyMap<string, string>): boolean {
  const { menuVersionId, catalogueId } = line.product;
  return menuVersionId !== undefined && liveVersions.get(catalogueId ?? "") !== menuVersionId;
}

/**
 * Compares each unsaved line priced against an earlier version of its menu with the live version's
 * offers (D9): what the line would cost now, and whether it can still be sold as it stands. Saved
 * lines are never re-priced (D10), and a line with no version is priced by the server from the live
 * version already. A line whose earlier price is unknown is always named, at its new price alone. A
 * line whose quantity the live unit cannot hold is not adopted: the live unit would refuse it.
 */
export function refreshBasket(
  lines: readonly OrderLine[],
  offers: readonly TillMenuOffer[],
  liveVersions: ReadonlyMap<string, string>,
): BasketRefresh {
  const offerById = new Map(offers.map((offer) => [offer.id, offer]));
  const outcome: BasketRefresh = { changed: [], blocked: [], adopted: new Map() };
  lines.forEach((line, index) => {
    if (line.workingOrderLineId !== undefined || !isStale(line, liveVersions)) return;
    const { product } = line;
    const live = liveVersions.get(product.catalogueId ?? "");
    const lineNo = index + 1;
    const offer = offerById.get(product.menuItemId ?? "");
    const block = lineBlock(line, offer);
    if (block !== undefined) outcome.blocked.push({ lineNo, ...block });
    if (
      offer === undefined ||
      live === undefined ||
      block?.reason === "removed" ||
      block?.reason === "variant_removed" ||
      block?.reason === "unit_changed"
    )
      return;
    const adopted = adoptLine(line, offer, live);
    outcome.adopted.set(index, adopted);
    const to = lineGross(adopted);
    if (line.earlierPriceUnknown === true) {
      outcome.changed.push({ lineNo, name: lineProductName(product), to });
      return;
    }
    const from = lineGross(line);
    if (compareDecimal(from, to) !== 0)
      outcome.changed.push({ lineNo, name: lineProductName(product), from, to });
  });
  return outcome;
}
