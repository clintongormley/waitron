import type { ProductAllergens as AllergenMap } from "@waitron/catalogue/src/allergens.js";

export function allergyClashes(allergens: AllergenMap | null, avoids: AllergenMap): string[] {
  return Object.keys(allergens ?? {})
    .filter((code) => Object.hasOwn(avoids, code))
    .sort();
}
