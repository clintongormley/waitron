import { joinCustomerPresentationText } from "@waitron/catalogue";
import type { PricedLines } from "@waitron/catalogue";
import type { TillSaleLine } from "./till-sale.js";

/** Display only: "2.000" reads "2" and "0.320" reads "0.32"; the filed figures are untouched. */
function trimQuantityForDisplay(quantity: string): string {
  return quantity.includes(".") ? quantity.replace(/0+$/, "").replace(/\.$/, "") : quantity;
}

/**
 * Project the FILED priced lines onto the receipt, so it prints the invoiced composition, never the
 * mutable client basket. `grossLineTotals[i]` is parallel to `lines[i]`, so each line's gross is
 * the exact figure filed.
 */
export function ticketLinesFrom(priced: PricedLines): TillSaleLine[] {
  return priced.lines.map((line, i) => ({
    // The goods identification (art. 7.1.e): a variant line prints the variant's own customer text.
    descriptions: joinCustomerPresentationText(
      line.descriptions,
      line.variantDescriptions ?? null,
      line.variantName ?? null,
    ),
    // Frozen at filing: the receipt never re-reads the catalogue for these names.
    optionSnapshots: line.optionSnapshots,
    quantity: trimQuantityForDisplay(line.quantity),
    unitName: line.unitName ?? null,
    unitPrecision: line.unitPrecision ?? null,
    gross: priced.grossLineTotals[i]!,
    parentLineNo: line.parentLineNo ?? null,
  }));
}
