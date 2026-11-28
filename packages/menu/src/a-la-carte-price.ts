import { stringToCents, type FrozenOffer, type MenuDocument } from "@waitron/shared";

type OwnPrices = { dishCents: number; variantCents: number | null };

export function offersByProduct(document: MenuDocument): ReadonlyMap<string, FrozenOffer> {
  return new Map(Object.values(document.offers).map((offer) => [offer.productId, offer]));
}

/** A set-menu dish's price outside the set menu comes from its holding menu when listed there. */
export function aLaCarteUnitCents(
  offer: FrozenOffer | undefined,
  variantId: string | null,
  own: OwnPrices,
): number {
  if (offer !== undefined) {
    if (variantId === null) return stringToCents(offer.unitPrice);
    const variant = offer.variants.find(({ id }) => id === variantId);
    if (variant !== undefined) return stringToCents(variant.unitPrice);
  }
  return own.variantCents ?? own.dishCents;
}
