import { joinCustomerPresentationText } from "@waitron/catalogue";
import type { GrossLine } from "@waitron/catalogue";
import {
  compareDecimal,
  decimal,
  divideDecimal,
  grossOf,
  multiplyDecimal,
  MONEY_SCALE,
  type Decimal,
} from "@waitron/shared";
import type { TillSaleLine } from "./till-sale.js";
import type { OrderLineIdentity } from "./working-order.js";

/** Display only: "2.000" reads "2" and "0.320" reads "0.32"; the filed figures are untouched. */
export function trimQuantityForDisplay(quantity: string): string {
  return quantity.includes(".") ? quantity.replace(/0+$/, "").replace(/\.$/, "") : quantity;
}

/** What a receipt line prints; a filed line and a stored gross line both carry it. */
export type ReceiptSource = Pick<
  GrossLine,
  | "lineNo"
  | "descriptions"
  | "variantDescriptions"
  | "variantName"
  | "optionSnapshots"
  | "quantity"
  | "priceQuantity"
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
    descriptions: joinCustomerPresentationText(
      line.descriptions,
      line.variantDescriptions ?? null,
      line.variantName ?? null,
    ),
    // Frozen at filing: the receipt never re-reads the catalogue for these names.
    optionSnapshots: line.optionSnapshots,
    quantity:
      line.parentLineNo != null && line.unitName != null && (line.unitPrecision ?? 0) > 0
        ? line.quantity
        : trimQuantityForDisplay(line.quantity),
    unitName: line.unitName ?? null,
    unitPrecision: line.unitPrecision ?? null,
    gross: line.lineGross,
    ...listGrossOf(line, identities[i]!.listUnitGross),
    parentLineNo: line.parentLineNo ?? null,
  }));
}

export function withReceiptListPrices<T extends ReceiptSource>(
  lines: readonly T[],
  identities: readonly Pick<OrderLineIdentity, "listUnitGross">[],
): (T & { listGross?: string; listUnitPriceGross?: string })[] {
  return lines.map((line, i) => {
    const listUnit = identities[i]!.listUnitGross;
    const list = listGrossOf(line, listUnit);
    return list.listGross === undefined
      ? { ...line }
      : { ...line, ...list, listUnitPriceGross: listUnit! };
  });
}

/** The line's total at its list price, rounded as a line total is (`grossRows`), when it differs. */
function listGrossOf(
  line: Pick<GrossLine, "quantity" | "priceQuantity" | "lineGross">,
  listUnit: Decimal | null,
): { listGross?: string } {
  if (listUnit === null) return {};
  const listGross =
    line.priceQuantity === undefined
      ? grossOf(listUnit, line.quantity)
      : divideDecimal(
          multiplyDecimal(listUnit, decimal(line.quantity)),
          decimal(line.priceQuantity),
          MONEY_SCALE,
        );
  return compareDecimal(listGross, line.lineGross) === 0 ? {} : { listGross };
}

export interface LineGroup {
  dish: TillSaleLine;
  options: TillSaleLine[];
}

/** Parent numbers name positions in the unchanged filed list; an extra may follow other dishes.
 * Orphans stay visible. Twin: `apps/server/src/receipt-lines.ts` / `apps/till/src/screens/till-ticket-view.ts`. */
export function groupByParent(lines: readonly TillSaleLine[]): LineGroup[] {
  const groups: LineGroup[] = [];
  const byPosition = new Map<number, LineGroup>();
  for (const [index, line] of lines.entries()) {
    const parent = line.parentLineNo == null ? undefined : byPosition.get(line.parentLineNo);
    if (parent === undefined) {
      const group = { dish: line, options: [] as TillSaleLine[] };
      groups.push(group);
      byPosition.set(index + 1, group);
    } else {
      parent.options.push(line);
    }
  }
  return groups;
}
