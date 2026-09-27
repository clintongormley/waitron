import { joinCustomerPresentationText } from "@waitron/catalogue";
import type { GrossLine } from "@waitron/catalogue";
import type { TillSaleLine } from "./till-sale.js";

/** Display only: "2.000" reads "2" and "0.320" reads "0.32"; the filed figures are untouched. */
export function trimQuantityForDisplay(quantity: string): string {
  return quantity.includes(".") ? quantity.replace(/0+$/, "").replace(/\.$/, "") : quantity;
}

/** What a receipt line prints; a filed line and a stored gross line both carry it. */
type ReceiptSource = Pick<
  GrossLine,
  | "descriptions"
  | "variantDescriptions"
  | "variantName"
  | "optionSnapshots"
  | "quantity"
  | "unitName"
  | "unitPrecision"
  | "lineGross"
  | "parentLineNo"
>;

/**
 * Project the FILED lines onto the receipt, so it prints the invoiced composition, never the
 * mutable client basket.
 */
export function ticketLinesFrom(priced: { lines: readonly ReceiptSource[] }): TillSaleLine[] {
  return priced.lines.map((line) => ({
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
    gross: line.lineGross,
    parentLineNo: line.parentLineNo ?? null,
  }));
}
