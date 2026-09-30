import { joinCustomerPresentationText } from "@waitron/catalogue";
import type { GrossLine } from "@waitron/catalogue";
import {
  compareDecimal,
  decimal,
  MONEY_SCALE,
  multiplyDecimal,
  toScale,
  type Decimal,
} from "@waitron/shared";
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
 * mutable client basket. `listUnitGross[i]` is the unit price `priced.lines[i]` had before a comp
 * or a discount ({@link readListUnitPrices}), or null; a line whose total at that price differs
 * from its filed total carries it as `listGross`.
 */
export function ticketLinesFrom(
  priced: { lines: readonly ReceiptSource[] },
  listUnitGross: readonly (Decimal | null)[],
): TillSaleLine[] {
  if (listUnitGross.length !== priced.lines.length) {
    throw new Error(
      `ticketLinesFrom: ${listUnitGross.length} list prices for ${priced.lines.length} lines`,
    );
  }
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
    gross: line.lineGross,
    ...listGrossOf(line, listUnitGross[i]!),
    parentLineNo: line.parentLineNo ?? null,
  }));
}

/** The line's total at its list price, rounded as a line total is (`grossRows`), when it differs. */
function listGrossOf(
  line: Pick<GrossLine, "quantity" | "lineGross">,
  listUnit: Decimal | null,
): { listGross?: string } {
  if (listUnit === null) return {};
  const listGross = toScale(multiplyDecimal(listUnit, decimal(line.quantity)), MONEY_SCALE);
  return compareDecimal(listGross, line.lineGross) === 0 ? {} : { listGross };
}
