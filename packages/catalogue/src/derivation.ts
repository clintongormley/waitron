import type { AllergenDeclaration, ProductAllergens } from "./allergens.js";

/** The recipe module's overlay: the derived allergen floor, plus whether the derivation is
 * incomplete (a recipe with at least one unreviewed ingredient). `pending` forces the product
 * PENDING regardless of the floor, so an unreviewed ingredient never reads as allergen-free. */
export interface RecipeDerivation {
  allergens: ProductAllergens;
  pending: boolean;
}

/** Union two allergen maps. A code present in both takes `contains` if either does (contains
 * dominates may_contain). A lone source, or the same source on both sides, is kept as written;
 * two different sources become one comma list of their parts, de-duplicated and sorted, so a fold
 * gives the same text in any order. */
export function mergeAllergenMaps(a: ProductAllergens, b: ProductAllergens): ProductAllergens {
  const out: ProductAllergens = {};
  for (const code of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const da = a[code];
    const db = b[code];
    const presence: AllergenDeclaration["presence"] =
      da?.presence === "contains" || db?.presence === "contains" ? "contains" : "may_contain";
    const sources = [...new Set([da?.source, db?.source].filter((s): s is string => Boolean(s)))];
    const decl: AllergenDeclaration = { presence };
    const source = sources.length > 1 ? mergeSourceLists(sources) : sources[0];
    if (source) decl.source = source;
    out[code] = decl;
  }
  return out;
}

function mergeSourceLists(sources: string[]): string {
  const parts = sources.flatMap((s) => s.split(",").map((part) => part.trim()));
  return [...new Set(parts.filter((part) => part !== ""))].sort().join(", ");
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
