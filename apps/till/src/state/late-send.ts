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
