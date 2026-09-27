import type { TillProduct } from "../api/client.js";
import { needsModifierPicker } from "../state/order-line.js";
import type { WorkingOrderStore } from "../state/working-order.js";
import { productUnit } from "./product-name.js";

/** A product with variants is sold only as one of them, so one whose variants are all unavailable
 * here has nothing to sell. It keeps its tile, greyed, so the tiles around it do not move (D12). */
export function hasSomethingToSell(product: TillProduct): boolean {
  if (product.available === false) return false;
  const variants = product.variants ?? [];
  return variants.length === 0 || variants.some((variant) => variant.available);
}

/**
 * What a tap on a product does: a weighed or fractional-unit product asks for its quantity (the
 * store's `product-selected`), one with variants or modifiers opens the picker through
 * `openModifiers`, and any other rings up one. A product with nothing to sell does nothing.
 */
export function pickProduct(
  product: TillProduct,
  store: WorkingOrderStore,
  openModifiers: (product: TillProduct) => void,
): void {
  if (!hasSomethingToSell(product)) return;
  const unit = productUnit(product);
  if (unit.hardwareUnit !== null || unit.precision > 0) {
    store.emit("product-selected", product);
  } else if (needsModifierPicker(product)) {
    openModifiers(product);
  } else {
    store.addProduct(product, "1");
  }
}
