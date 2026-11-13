import { recomputeMadridHashes, type CanonicalMadridSemantics } from "./madrid-semantics.js";

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
  recomputeMadridHashes(result, {
    editDocumentRow: (row) => {
      const change = changed.get(String(row.productId));
      if (!change) return;
      if (row.vatClass === change.old) row.vatClass = change.new;
      if (Array.isArray(row.variants))
        row.variants = row.variants.map((variant: unknown) =>
          (variant as { vatClass?: unknown } | null)?.vatClass === change.old
            ? { ...(variant as object), vatClass: change.new }
            : variant,
        );
    },
  });
  return result;
}
