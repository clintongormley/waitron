import type { ProductAllergens } from "./allergens.js";

/** The recipe module's overlay: the derived allergen floor, plus whether the derivation is
 * incomplete (a recipe with at least one unreviewed ingredient). `pending` forces the product
 * PENDING regardless of the floor, so an unreviewed ingredient never reads as allergen-free. */
export interface RecipeDerivation {
  allergens: ProductAllergens;
  pending: boolean;
}

export function mergeAllergenMaps(a: ProductAllergens, b: ProductAllergens): ProductAllergens {
  const out: ProductAllergens = {};
  for (const code of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const da = a[code];
    const db = b[code];
    const kinds = [...new Set([...(da?.kinds ?? []), ...(db?.kinds ?? [])])].sort();
    out[code] = kinds.length > 0 ? { kinds } : {};
  }
  return out;
}

/** Compute the published declaration from the two overlays. `null` = PENDING (unreviewed). */
export function republish(
  manual: ProductAllergens | null,
  derivation: RecipeDerivation | null,
): ProductAllergens | null {
  if (derivation?.pending) return null; // unreviewed ingredient in the recipe
  if (manual === null && derivation === null) return null; // nothing reviewed at all
  return mergeAllergenMaps(derivation?.allergens ?? {}, manual ?? {});
}
