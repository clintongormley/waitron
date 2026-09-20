import { joinCustomerPresentationText } from "@waitron/catalogue";
import type { PricedLines } from "@waitron/catalogue";
import type { TillSaleLine } from "./till-sale.js";

/**
 * Trim a filed quantity to a display string: drop trailing zeros (and a bare trailing dot) so a
 * walk-up's "2" and a retrieved order's stored "2.000" both read "2", and a weighed "0.320" reads
 * "0.32". Same normalisation the till's `displayQuantity` applies on retrieve, done here for EVERY
 * path so the receipt's line list is uniform regardless of which path filed it. Display only — the
 * fiscal figures (`total`, `vatBreakdown`) are untouched.
 */
function trimQuantityForDisplay(quantity: string): string {
  return quantity.includes(".") ? quantity.replace(/0+$/, "").replace(/\.$/, "") : quantity;
}

/**
 * Project the FILED priced lines onto the receipt's line list (`TillSaleResult.lines`) — the goods
 * identification (art. 7.1.e). `priced` is exactly what was filed (a walk-up/collect `priceBasket`, or
 * a stored-lock `priceLockedLines`), so the receipt prints the invoiced composition, never the mutable
 * client basket (Finding 2). `grossLineTotals[i]` is parallel to `lines[i]` (see `PricedLines`), so the
 * per-line gross is the exact figure filed, not a recompute that could drift by a cent.
 */
export function ticketLinesFrom(priced: PricedLines): TillSaleLine[] {
  return priced.lines.map((line, i) => ({
    // The identification of the goods (art. 7.1.e) is the product AND the variant: a filed line
    // freezes the two customer maps in separate columns, so the label the receipt prints is the two
    // joined. The join itself belongs to `product-presentation.ts` and is never rebuilt here.
    descriptions: joinCustomerPresentationText(line.descriptions, line.variantDescriptions ?? null),
    // The dish's frozen options answers, straight off the filed line: the receipt prints these
    // stored names and never re-reads the catalogue for them. The displayed TEXT is still chosen at
    // print time — `customerOptionSnapshotLabels` (`apps/server/src/option-snapshot-labels.ts`)
    // picks the customer or staff name and resolves it against the invoice locale.
    optionSnapshots: line.optionSnapshots,
    quantity: trimQuantityForDisplay(line.quantity),
    unitName: line.unitName ?? null,
    unitPrecision: line.unitPrecision ?? null,
    gross: priced.grossLineTotals[i]!,
    // Carry the child→parent link so the receipt can render each option grouped under its dish
    // (Task 8). `?? null` keeps a plain (no-modifier) line's field exactly `null`.
    parentLineNo: line.parentLineNo ?? null,
  }));
}
