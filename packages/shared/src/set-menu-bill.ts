import { stringToCents } from "./cents.js";
import type { ServedSetMenuCopy } from "./menu-document/menu-document-types.js";
import type { SetMenuOffer, SetMenuOfferDish } from "./set-menu-fit.js";

export interface SetMenuCopy extends SetMenuOffer {
  setMenuId: string;
  versionId: string;
  name: string;
  terms: Pick<ServedSetMenuCopy["terms"], "vatClass" | "takeawayVatClass">;
}

export function setMenuOfferOf(copy: ServedSetMenuCopy): SetMenuOffer {
  const dishes: SetMenuOfferDish[] = [];
  for (const offer of copy.offers) {
    if (offer.unit.measure) continue;
    const { productId, countsAsCourseId, variants, variantCountsAs } = offer;
    if (
      variants.length === 0 &&
      Object.keys(variantCountsAs).length === 0 &&
      countsAsCourseId !== null
    ) {
      dishes.push({
        productId,
        variantId: null,
        countsAsCourseId,
        surchargeCents: stringToCents(offer.unitPrice),
      });
    }
    for (const variant of variants) {
      const course = variantCountsAs[variant.id];
      if (course === undefined) continue;
      dishes.push({
        productId,
        variantId: variant.id,
        countsAsCourseId: course,
        surchargeCents: stringToCents(variant.unitPrice),
      });
    }
  }
  return {
    id: copy.key,
    priceCents: stringToCents(copy.terms.price),
    lines: copy.terms.lines,
    dishes,
  };
}

export function setMenuCopyOf(copy: ServedSetMenuCopy, versionId: string): SetMenuCopy {
  const { vatClass, takeawayVatClass } = copy.terms;
  return {
    ...setMenuOfferOf(copy),
    setMenuId: copy.menuId,
    name: copy.name,
    versionId,
    terms: { vatClass, takeawayVatClass },
  };
}

export function copiesListing(
  copies: readonly SetMenuCopy[],
  productId: string,
  variantId: string | null,
): SetMenuCopy[] {
  return copies.filter((copy) =>
    copy.dishes.some((dish) => dish.productId === productId && dish.variantId === variantId),
  );
}
