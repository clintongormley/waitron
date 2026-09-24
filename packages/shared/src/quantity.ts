/**
 * The PER-DISH count of a filed child option line, from its stored quantity, which is the dish
 * quantity times the per-option quantity. For deciding a "×N" badge; DISPLAY-ONLY.
 */
export function perDishOptionQuantity(combinedChildQuantity: string, dishQuantity: string): number {
  const perDish = Math.round(Number(combinedChildQuantity) / Number(dishQuantity));
  // A non-numeric string or a zero dish quantity gives 1, the no-badge value, never NaN or Infinity.
  return Number.isFinite(perDish) && perDish >= 1 ? perDish : 1;
}
