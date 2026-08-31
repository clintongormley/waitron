import type { AllergenDeclaration, ProductAllergens } from "./allergens.js";

/** The recipe module's overlay: the derived allergen floor, plus whether the derivation is
 * incomplete (a recipe with at least one unreviewed ingredient). `pending` forces the product
 * PENDING regardless of the floor, so an unreviewed ingredient never reads as allergen-free. */
export interface RecipeDerivation {
  allergens: ProductAllergens;
  pending: boolean;
}

/** Union two allergen maps. A code present in both takes `contains` if either does (contains
 * dominates may_contain); its `source` is the distinct non-empty sources, SORTED and comma-joined
 * into one string (catalogue's type keeps `source` a single string). Sorted rather than
 * iteration-order: for recipe-derived allergens the map is built by folding ingredient rows in
 * their DB order, which is not deterministic (`recipes.ts`'s `getProductRecipe` ties on
 * created_at and falls back to a random uuid), so an unsorted join would render "egg, mayo" one
 * run and "mayo, egg" the next for the same recipe. */
export function mergeAllergenMaps(a: ProductAllergens, b: ProductAllergens): ProductAllergens {
  const out: ProductAllergens = {};
  for (const code of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const da = a[code];
    const db = b[code];
    const presence: AllergenDeclaration["presence"] =
      da?.presence === "contains" || db?.presence === "contains" ? "contains" : "may_contain";
    const sources = [
      ...new Set([da?.source, db?.source].filter((s): s is string => Boolean(s))),
    ].sort();
    const decl: AllergenDeclaration = { presence };
    if (sources.length > 0) decl.source = sources.join(", ");
    out[code] = decl;
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

/** A selected option's allergen overlay: the codes it ADDS and the codes it REMOVES. */
export interface OptionAllergenOverlay {
  add: ProductAllergens | null;
  remove: readonly string[] | null;
}

/** The as-served allergen profile of one dish line: the declared set plus a `pending` flag when the
 * dish's own allergens are unreviewed. Structurally the RecipeDerivation shape, so every surface that
 * renders product allergens already knows it. */
export interface AsServedAllergens {
  allergens: ProductAllergens;
  pending: boolean;
}

/** Fold a dish's published allergens with its selected options' overlays (design §4, "Cautious").
 * `base === null` (unreviewed) → the plate stays pending: removes cannot subtract from an unknown
 * base, so only the (always-safe) adds show. A reviewed base has its removed codes deleted entirely
 * (both `contains` and `may_contain`) and the adds merged in — adds applied last, so an add WINS a
 * cross-option conflict (over-declaring is the safe direction). Pure and total. */
export function deriveAsServedAllergens(
  base: ProductAllergens | null,
  options: readonly OptionAllergenOverlay[],
): AsServedAllergens {
  let adds: ProductAllergens = {};
  const removes = new Set<string>();
  for (const opt of options) {
    if (opt.add) adds = mergeAllergenMaps(adds, opt.add);
    if (opt.remove) for (const code of opt.remove) removes.add(code);
  }
  if (base === null) return { allergens: adds, pending: true };
  const stripped: ProductAllergens = {};
  for (const [code, decl] of Object.entries(base)) {
    if (!removes.has(code)) stripped[code] = decl;
  }
  return { allergens: mergeAllergenMaps(stripped, adds), pending: false };
}
