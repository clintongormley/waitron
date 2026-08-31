/**
 * The PER-DISH count of a filed child option line, recovered from its stored COMBINED quantity.
 *
 * A child option line's stored `quantity` is the COMBINED count = `dishQuantity × perOptionQuantity`
 * (this is exactly the pricer's `dishQty × optionQty` filing, in reverse). Options attach only to
 * `each` products, so both the dish quantity and the per-option quantity are positive integers, which
 * makes `combinedChildQuantity / dishQuantity` an EXACT integer — the `Math.round` only defends
 * against float representation, it never actually rounds a fractional result. The overwhelmingly
 * common one-per-dish case (INCLUDING a plain modifier on a multi-quantity dish, where the child and
 * dish quantities are equal) returns 1.
 *
 * Callers use this to decide a "×N"/"xN" badge (renderers keep their own glyph); it is DISPLAY-ONLY.
 */
export function perDishOptionQuantity(combinedChildQuantity: string, dishQuantity: string): number {
  return Math.round(Number(combinedChildQuantity) / Number(dishQuantity));
}
