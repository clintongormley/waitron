import { recomputeMadridHashes } from "./madrid-name-changes.js";
import type { CanonicalMadridSemantics } from "./madrid-semantics.js";

export interface MadridVatClassChange {
  product: string;
  old: string;
  new: string;
}

/** Apply only the reviewed VAT classes to the original capture: the product row, each menu offer of
 * that product and the offer's variants. Publication hashes follow those cells. */
export function madridWithVatClassChanges(
  original: CanonicalMadridSemantics,
  changes: MadridVatClassChange[],
): CanonicalMadridSemantics {
  const result = structuredClone(original);
  const changed = new Map<string, MadridVatClassChange>();
  for (const change of changes) {
    const row = result.tables.products?.rows[change.product];
    if (
      !row ||
      row.vat_class !== change.old ||
      change.old === change.new ||
      changed.has(change.product)
    )
      throw new Error(`unused or invalid Madrid VAT class change: ${change.product}`);
    row.vat_class = change.new;
    changed.set(change.product, change);
  }
  const reclassify = (value: unknown, change: MadridVatClassChange): unknown => {
    if (value === null || typeof value !== "object") return value;
    const row = value as Record<string, unknown>;
    return row.vatClass === change.old ? { ...row, vatClass: change.new } : row;
  };
  recomputeMadridHashes(result, undefined, (row) => {
    const change = changed.get(String(row.productId));
    if (!change) return;
    Object.assign(row, reclassify(row, change));
    if (Array.isArray(row.variants))
      row.variants = row.variants.map((variant) => reclassify(variant, change));
  });
  return result;
}
