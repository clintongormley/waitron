import type {
  DocumentList,
  FrozenOffer,
  PublishedSetMenu,
  SetMenuFrozenOffer,
} from "@waitron/shared";
import type { SetMenuDraft } from "./set-menus.js";

const INCLUDED_PRICE = "0.00";

export function freezeSetMenu(
  offers: FrozenOffer[],
  root: DocumentList,
  draft: SetMenuDraft,
): PublishedSetMenu {
  const byItem = new Map(offers.map((offer) => [offer.id, offer]));
  const copied: Record<string, SetMenuFrozenOffer> = {};
  for (const dish of draft.dishes) {
    const offer = byItem.get(dish.menuItemId);
    if (offer === undefined) continue;
    const unitPrice = dish.surcharge ?? INCLUDED_PRICE;
    const choices = new Map(dish.variants.map((variant) => [variant.id, variant]));
    const variants = offer.variants.flatMap((variant) => {
      const choice = choices.get(variant.id);
      if (!choice?.included || choice.courseId === null) return [];
      const surcharge = choice.surcharge ?? unitPrice;
      return [
        {
          ...variant,
          unitPrice: surcharge,
          menuPrice: surcharge,
          countsAsCourseId: choice.courseId,
        },
      ];
    });
    if (variants.length === 0 && (offer.variants.length > 0 || dish.courseId === null)) continue;
    copied[offer.id] = {
      ...offer,
      unitPrice,
      countsAsCourseId: dish.courseId,
      courseOverrideId: dish.courseOverrideId,
      variants,
    };
  }
  return {
    name: draft.name,
    changedAt: draft.changedAt,
    terms: { price: draft.price, vatClass: draft.vatClass, names: draft.names, lines: draft.lines },
    root: {
      members: root.members.filter(
        (member) => member.kind === "product" && member.menuItemId in copied,
      ),
    },
    offers: copied,
  };
}
