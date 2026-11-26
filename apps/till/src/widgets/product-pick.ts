import type { TillProduct } from "../api/menu-api.js";
import { needsModifierPicker } from "../state/order-line.js";
import type { OrderLine, WorkingOrderStore } from "../state/working-order.js";
import { menuOfferToTillProduct } from "../api/menu-api.js";
import type { PickSetMenuDishDetail } from "./set-menu-folder.js";
import { soldByTheUnit } from "./product-name.js";

/** A product with variants is sold only as one of them, so one whose variants are all unavailable
 * here has nothing to sell. It keeps its tile, greyed, so the tiles around it do not move (D12). */
export function hasSomethingToSell(product: TillProduct): boolean {
  if (product.available === false) return false;
  const variants = product.variants ?? [];
  return variants.length === 0 || variants.some((variant) => variant.available);
}

/**
 * What a tap on a product does: a product sold by measure asks for its amount (the
 * store's `product-selected`), one with variants or modifiers opens the picker through
 * `openModifiers`, and any other rings up one. A product with nothing to sell does nothing.
 */
export function pickProduct(
  product: TillProduct,
  store: WorkingOrderStore,
  openModifiers: (product: TillProduct) => void,
  replacing?: OrderLine,
): void {
  if (!hasSomethingToSell(product)) return;
  if (!soldByTheUnit(product)) {
    store.emit("product-selected", product);
  } else if (needsModifierPicker(product)) {
    openModifiers(product);
  } else {
    store.addProduct(product, "1", undefined, replacing);
  }
}

export function setMenuProduct({ offer, versionId }: PickSetMenuDishDetail): TillProduct {
  return menuOfferToTillProduct(
    {
      ...offer,
      courseId: offer.countsAsCourseId,
      variants: offer.variants.map((variant) => ({
        ...variant,
        courseId: offer.variantCountsAs[variant.id] ?? null,
      })),
    },
    versionId,
  );
}
