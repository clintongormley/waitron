import { lookupSetMenuLine, type SetMenuOfferLookup } from "./set-menus.js";
import { effectiveDefaultLabelId } from "@waitron/menu/src/option-default.js";
import { compareDecimal, decimal } from "@waitron/shared";
import {
  menuOfferToTillProduct,
  type MenuUnavailable,
  type TillMenuOffer,
  type TillProduct,
} from "../api/client.js";
import { lineProductName, productUnit } from "../widgets/product-name.js";
import { lineGross, productAsVariant, quantityPlaces, takesExtras } from "./order-line.js";
import type { OrderLine } from "./working-order.js";

/** Why a basket line cannot be paid as it stands (D9). */
export type BlockReason =
  | "period_ended"
  | "removed"
  | "not_sold_separately"
  | "unavailable"
  | "variant_removed"
  | "extra_removed"
  | "extra_unavailable"
  | "unit_changed"
  | "choice_required"
  | "extras_limit";

export interface LineBlock {
  reason: BlockReason;
  /** The dish, variant, extra, option label or list the reason is about. */
  name: string;
}

/** One line of the basket-refresh dialog; `lineNo` counts the basket from 1, and several rows may
 * share one. `from`/`to` are the line's total or, on a row with `units`, one part's price per the
 * dish's unit on that side, which an extra is billed by too. `from` is absent for a line whose
 * earlier price the till never held. */
export interface ChangedLine {
  lineNo: number;
  name: string;
  from?: string;
  to: string;
  units?: { from: NonNullable<TillProduct["unit"]>; to: NonNullable<TillProduct["unit"]> };
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
export function withUnavailable<T extends TillMenuOffer>(
  offers: readonly T[],
  unavailable: MenuUnavailable,
): T[] {
  const products = new Set(unavailable.products);
  const labels = new Set(unavailable.optionLabels);
  return offers.map((offer) => ({
    ...offer,
    available: !products.has(offer.productId),
    variants: offer.variants.map((variant) => ({
      ...variant,
      available: !products.has(variant.id),
    })),
    offeredModifiers: offer.offeredModifiers.map((entry) => {
      if (entry.kind === "extras")
        return {
          ...entry,
          items: entry.items.map((item) => ({
            ...item,
            available: !products.has(item.productId),
          })),
        };
      const withLabels = entry.labels.map((label) => ({
        ...label,
        available: !labels.has(label.id),
      }));
      return {
        ...entry,
        labels: withLabels,
        defaultLabelId: effectiveDefaultLabelId(withLabels, entry.publishedDefaultLabelId),
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
  if (line.setMenuId === undefined && offer.ordering === "not_sold_separately")
    return { reason: "not_sold_separately", name };
  if (!offer.available) return { reason: "unavailable", name };
  let variant: TillMenuOffer["variants"][number] | undefined;
  if (line.product.variantId !== undefined) {
    variant = offer.variants.find((candidate) => candidate.id === line.product.variantId);
    if (variant === undefined) return { reason: "variant_removed", name };
    if (!variant.available) return { reason: "unavailable", name };
  }
  const { precision } = productUnit(variant ?? offer);
  if (quantityPlaces(line.quantity) > precision) return { reason: "unit_changed", name };
  const extrasLists = takesExtras(variant ?? offer) ? offer.offeredModifiers : [];
  for (const pick of line.extras ?? []) {
    const list = extrasLists.find((entry) => entry.kind === "extras" && entry.id === pick.listId);
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
  for (const list of offer.offeredModifiers)
    if (list.kind === "options" && !line.options?.some((answer) => answer.listId === list.id))
      return { reason: "choice_required", name: list.name };
  for (const list of extrasLists) {
    if (list.kind !== "extras") continue;
    let total = 0;
    for (const pick of line.extras ?? []) {
      if (pick.listId !== list.id) continue;
      const item = list.items.find((candidate) => candidate.productId === pick.productId)!;
      if (item.maxQuantity !== null && pick.quantity > item.maxQuantity)
        return { reason: "extras_limit", name: list.name };
      total += pick.quantity;
    }
    const tooFew = total < list.minPicks;
    if (tooFew || (list.maxPicks !== null && total > list.maxPicks))
      return { reason: "extras_limit", name: list.name };
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
  const product = variant === undefined ? dish : productAsVariant(dish, variant);
  const extrasLists = takesExtras(product) ? offer.offeredModifiers : [];
  const extras = line.extras?.map((pick) => {
    for (const entry of extrasLists)
      if (entry.kind === "extras" && entry.id === pick.listId)
        for (const item of entry.items)
          if (item.productId === pick.productId)
            return { ...pick, name: item.name, price: item.price };
    return pick;
  });
  const adopted: OrderLine = {
    ...line,
    product,
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
  setMenuOffer?: SetMenuOfferLookup,
): Map<number, OrderLine> {
  const repriced = new Map<number, OrderLine>();
  lines.forEach((line, index) => {
    if (line.earlierPriceUnknown !== true || isStale(line, liveVersions, setMenuOffer)) return;
    const { menuItemId, menuVersionId } = line.product;
    const offer =
      line.setMenuId === undefined
        ? offerById.get(menuItemId ?? "")
        : lookupSetMenuLine(line, setMenuOffer)?.offer;
    if (offer === undefined || menuVersionId === undefined) return;
    const reason = lineBlock(line, offer)?.reason;
    if (reason === "variant_removed" || reason === "unit_changed") return;
    repriced.set(index, adoptLine(line, offer, menuVersionId));
  });
  return repriced;
}

/** Whether the line was priced against a version of its menu other than the live one. A line with
 * no version is priced by the server from the live version. */
export function isStale(
  line: OrderLine,
  liveVersions: ReadonlyMap<string, string>,
  setMenuOffer?: SetMenuOfferLookup,
): boolean {
  const { menuVersionId, menuId } = line.product;
  const version =
    line.setMenuId === undefined
      ? liveVersions.get(menuId ?? "")
      : lookupSetMenuLine(line, setMenuOffer)?.versionId;
  return menuVersionId !== undefined && version !== menuVersionId;
}

/**
 * Compares each unsaved line priced against an earlier version of its menu with the live version's
 * offers (D9): what the line would cost now, and whether it can still be sold as it stands. Saved
 * lines are never re-priced (D10), and a line with no version is priced by the server from the live
 * version already. A line whose earlier price is unknown is always named, at its new price alone. A
 * line whose total is unchanged while its parts' prices moved, or whose dish or variant is now sold
 * by another unit, names at its unit price the dish or variant if its price or unit changed, then
 * each extra whose price changed; a line total cannot show a change of unit. A line whose quantity
 * the live unit cannot hold is not adopted: the live unit would refuse it.
 */
export function refreshBasket(
  lines: readonly OrderLine[],
  offers: readonly TillMenuOffer[],
  liveVersions: ReadonlyMap<string, string>,
  setMenuOffer?: SetMenuOfferLookup,
): BasketRefresh {
  const offerById = new Map(offers.map((offer) => [offer.id, offer]));
  const outcome: BasketRefresh = { changed: [], blocked: [], adopted: new Map() };
  lines.forEach((line, index) => {
    if (line.workingOrderLineId !== undefined || !isStale(line, liveVersions, setMenuOffer)) return;
    const { product } = line;
    const selected = lookupSetMenuLine(line, setMenuOffer);
    const lineNo = index + 1;
    const [offer, live] =
      line.setMenuId === undefined
        ? [offerById.get(product.menuItemId ?? ""), liveVersions.get(product.menuId ?? "")]
        : [selected?.offer, selected?.versionId];
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
    if (compareDecimal(from, to) !== 0 && !unitChanged(line, adopted))
      outcome.changed.push({ lineNo, name: lineProductName(product), from, to });
    else outcome.changed.push(...partsRepriced(line, adopted, lineNo));
  });
  return outcome;
}

function unitChanged(line: OrderLine, adopted: OrderLine): boolean {
  return productUnit(line.product).id !== productUnit(adopted.product).id;
}

/**
 * Each part of `line` whose unit price `adopted` changes: the dish or variant, then each extra. The
 * dish or variant is named too when its unit changed.
 */
function partsRepriced(line: OrderLine, adopted: OrderLine, lineNo: number): ChangedLine[] {
  const units = { from: productUnit(line.product), to: productUnit(adopted.product) };
  const parts = [
    {
      name: lineProductName(line.product),
      from: line.product.unitPrice,
      to: adopted.product.unitPrice,
    },
  ];
  // `adoptLine` maps the picks in place, so the same index is the same pick.
  (line.extras ?? []).forEach((pick, index) =>
    parts.push({ name: pick.name, from: pick.price, to: adopted.extras![index]!.price }),
  );
  const dishUnitChanged = unitChanged(line, adopted);
  return parts
    .filter(
      (part, index) =>
        (index === 0 && dishUnitChanged) ||
        compareDecimal(decimal(part.from), decimal(part.to)) !== 0,
    )
    .map((part) => ({ lineNo, ...part, units }));
}

export function refreshProductDeclarations(
  product: TillProduct,
  liveProducts: readonly TillProduct[],
): TillProduct {
  const live =
    liveProducts.find(
      (candidate) =>
        candidate.menuItemId !== undefined && candidate.menuItemId === product.menuItemId,
    ) ??
    liveProducts.find(
      (candidate) => (candidate.productId ?? candidate.id) === (product.productId ?? product.id),
    );
  if (live === undefined) return product;
  const own =
    product.variantId === undefined || product.variantId === live.variantId
      ? live
      : live.variants?.find((variant) => variant.id === product.variantId);
  const declarations = (
    source: Pick<TillProduct, "allergens" | "diet" | "dietOverride" | "dietaryDeclarations">,
  ) => ({
    allergens: source.allergens,
    diet: source.diet,
    dietOverride: source.dietOverride,
    dietaryDeclarations: source.dietaryDeclarations,
  });
  const modifiers = <T extends NonNullable<TillProduct["offeredModifiers"]>[number]>(
    entries: T[] | undefined,
  ): T[] | undefined =>
    entries?.map((entry) =>
      entry.kind !== "extras"
        ? entry
        : {
            ...entry,
            items: entry.items.map((item) => {
              const current = (live.modifierAvailability ?? live.offeredModifiers)
                ?.flatMap((list) => (list.kind === "extras" ? list.items : []))
                .find((candidate) => candidate.productId === item.productId);
              return current === undefined
                ? item
                : { ...item, addAllergens: current.addAllergens, suitableFor: current.suitableFor };
            }),
          },
    );
  const next = {
    ...product,
    ...(own === undefined ? {} : declarations(own)),
    variants: product.variants?.map((variant) => {
      const current = live.variants?.find((candidate) => candidate.id === variant.id);
      return current === undefined ? variant : { ...variant, ...declarations(current) };
    }),
    offeredModifiers: modifiers(product.offeredModifiers),
    modifierAvailability: modifiers(product.modifierAvailability),
  };
  return JSON.stringify(next) === JSON.stringify(product) ? product : next;
}
