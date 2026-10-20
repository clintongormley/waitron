import type { ProductAllergens as AllergenMap } from "@waitron/catalogue/src/allergens.js";
import { mergeAllergenMaps } from "@waitron/catalogue/src/derivation.js";

export function allergyClashes(allergens: AllergenMap | null, avoids: AllergenMap): string[] {
  return Object.keys(allergens ?? {})
    .filter((code) => Object.hasOwn(avoids, code))
    .sort();
}

export function allergensWithExtras(
  own: AllergenMap | null,
  extras: readonly { allergens: AllergenMap | null }[],
): AllergenMap {
  return extras.reduce<AllergenMap>(
    (merged, extra) => mergeAllergenMaps(merged, extra.allergens ?? {}),
    own ?? {},
  );
}
