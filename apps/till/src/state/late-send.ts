import type { TillMenuOffer } from "../api/client.js";
import type { OrderLine } from "./working-order.js";

export interface EndedPeriod {
  menuId: string;
  periodName: string;
}

export interface LateSendIndex {
  byId: ReadonlyMap<string, TillMenuOffer>;
  live: readonly TillMenuOffer[];
  selectable: ReadonlySet<string>;
  /** Menu id to the name of its period that ended earlier the same business day. */
  ended: ReadonlyMap<string, string>;
}

/**
 * The ended period an unsent line's dish belongs to, when no orderable menu sells it on its own —
 * the server's `productsOfferedIn` rule (`packages/venue-service/src/operations.ts`): an offer not
 * sold separately does not count, and a variant counts only where the offer lists it.
 */
export function endedPeriodOf(line: OrderLine, index: LateSendIndex): EndedPeriod | undefined {
  if (line.workingOrderLineId !== undefined || line.source !== undefined) return undefined;
  const offer = index.byId.get(line.product.menuItemId ?? "");
  if (offer === undefined || index.selectable.has(offer.menuId)) return undefined;
  const periodName = index.ended.get(offer.menuId);
  if (periodName === undefined) return undefined;
  const variantId = line.product.variantId;
  const soldNow = index.live.some(
    (other) =>
      index.selectable.has(other.menuId) &&
      other.productId === offer.productId &&
      other.ordering !== "not_sold_separately" &&
      (variantId === undefined || other.variants.some((variant) => variant.id === variantId)),
  );
  return soldNow ? undefined : { menuId: offer.menuId, periodName };
}

/** What a `menu_period.ended` refusal names: the ended menus, and the late dishes by offer id. */
export interface LateSendRefusal {
  menus: EndedPeriod[];
  menuItemIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEndedPeriod(value: unknown): value is EndedPeriod {
  return (
    isRecord(value) && typeof value.menuId === "string" && typeof value.periodName === "string"
  );
}

/** The params of a `menu_period.ended` refusal, or undefined when it is another error or they are unusable. */
export function lateSendRefusalOf(error: unknown): LateSendRefusal | undefined {
  if (!isRecord(error) || error.code !== "menu_period.ended") return undefined;
  const { menus, menuItemIds } = error;
  if (!Array.isArray(menus) || !menus.every(isEndedPeriod)) return undefined;
  if (!Array.isArray(menuItemIds) || !menuItemIds.every((id) => typeof id === "string")) {
    return undefined;
  }
  return {
    menus: menus.map(({ menuId, periodName }) => ({ menuId, periodName })),
    menuItemIds: [...menuItemIds],
  };
}

/**
 * The request's new lines the refusal names. A stored or recalled line is left out: the server lists
 * only new dishes (`priceOrderLines`, `apps/server/src/working-order.ts`), and one can share an
 * offer id with a fresh late dish.
 */
export function refusedLines<T extends OrderLine>(
  lines: readonly T[],
  refusal: LateSendRefusal,
): T[] {
  const ids = new Set(refusal.menuItemIds);
  return lines.filter(
    (line) =>
      line.workingOrderLineId === undefined &&
      line.source === undefined &&
      line.product.menuItemId !== undefined &&
      ids.has(line.product.menuItemId),
  );
}

/** A send refused because confirming it needs a manager's PIN. */
export function isLateSendManagerRefusal(error: unknown): boolean {
  return (
    isRecord(error) &&
    error.code === "authorization.not_permitted" &&
    error.permission === "venue_service.manage"
  );
}
