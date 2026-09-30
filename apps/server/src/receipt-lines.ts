import { joinCustomerPresentationText } from "@waitron/catalogue";
import type { GrossLine } from "@waitron/catalogue";
import { compareDecimal, grossOf, type Decimal } from "@waitron/shared";
import type { TillSaleLine } from "./till-sale.js";
import type { OrderLineIdentity } from "./working-order.js";

/** Display only: "2.000" reads "2" and "0.320" reads "0.32"; the filed figures are untouched. */
export function trimQuantityForDisplay(quantity: string): string {
  return quantity.includes(".") ? quantity.replace(/0+$/, "").replace(/\.$/, "") : quantity;
}

/** What a receipt line prints; a filed line and a stored gross line both carry it. */
export type ReceiptSource = Pick<
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
 * mutable client basket. `identities[i]` is the working-order line `priced.lines[i]` was priced
 * from, as a `GrossOrder` pairs them; a line whose total at its list price differs from its filed
 * total carries it as `listGross`.
 */
export function ticketLinesFrom(
  priced: { lines: readonly ReceiptSource[] },
  identities: readonly Pick<OrderLineIdentity, "listUnitGross">[],
): TillSaleLine[] {
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
    ...listGrossOf(line, identities[i]!.listUnitGross),
    parentLineNo: line.parentLineNo ?? null,
  }));
}

/** The line's total at its list price, rounded as a line total is (`grossRows`), when it differs. */
function listGrossOf(
  line: Pick<GrossLine, "quantity" | "lineGross">,
  listUnit: Decimal | null,
): { listGross?: string } {
  if (listUnit === null) return {};
  const listGross = grossOf(listUnit, line.quantity);
  return compareDecimal(listGross, line.lineGross) === 0 ? {} : { listGross };
}

export interface LineGroup {
  dish: TillSaleLine;
  options: TillSaleLine[];
}

/**
 * Group the filed lines into dishes with their option lines. Filed lines arrive dish-first
 * (`grossBasketWithOptions`), so one forward scan suffices; nothing is recomputed, so the printed
 * lines still reconcile with the filed total. A child with no dish before it becomes its own group
 * rather than being dropped, so no filed line vanishes from a legal receipt.
 * Copied in `apps/till/src/screens/till-ticket-view.ts`; the two are kept in step.
 */
export function groupByParent(lines: readonly TillSaleLine[]): LineGroup[] {
  const groups: LineGroup[] = [];
  for (const line of lines) {
    const current = groups[groups.length - 1];
    if (line.parentLineNo == null || current === undefined) {
      groups.push({ dish: line, options: [] });
    } else {
      current.options.push(line);
    }
  }
  return groups;
}
