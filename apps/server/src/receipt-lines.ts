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
    descriptions: line.descriptions,
    quantity: trimQuantityForDisplay(line.quantity),
    gross: priced.grossLineTotals[i]!,
    // Carry the child→parent link so the receipt can render each option grouped under its dish
    // (Task 8). `?? null` keeps a plain (no-modifier) line's field exactly `null`.
    parentLineNo: line.parentLineNo ?? null,
  }));
}
