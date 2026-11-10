import type { ProductAllergens } from "@waitron/shared";

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

export function publishedAllergens(manual: ProductAllergens | null): ProductAllergens | null {
  return manual === null ? null : mergeAllergenMaps({}, manual);
}
