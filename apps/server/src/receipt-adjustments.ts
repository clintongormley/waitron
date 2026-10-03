import { readBillAdjustments } from "@waitron/adjustments";
import type { Transaction } from "@waitron/db";
import {
  addDecimal,
  compareDecimal,
  decimal,
  isZeroDecimal,
  subtractDecimal,
  sumDecimals,
} from "@waitron/shared";
import { groupByParent, ticketLinesFrom, type ReceiptSource } from "./receipt-lines.js";
import { VENUE_SERVICE } from "./modules.js";
import type { ReceiptAdjustment, TillSaleLine, TillSaleResult } from "./till-sale.js";
import type { OrderLineIdentity } from "./working-order.js";

/**
 * The receipt's lines for `priced` (`ticketLinesFrom`), with the comps and discounts it prints as
 * their own lines: each line's beneath the row it was made on, or the part it carved off, and each
 * on the whole bill after the goods. When the bill's records no longer add up to its lines (a part
 * cancelled after it was discounted, for one) each dish instead prints what its rows lost, which
 * always adds up. Presentation only: nothing here is filed.
 */
export async function receiptLines(
  tx: Transaction,
  workingOrderId: string,
  priced: { lines: readonly ReceiptSource[] },
  identities: readonly Pick<OrderLineIdentity, "id" | "listUnitGross">[],
): Promise<Pick<TillSaleResult, "lines" | "billAdjustments">> {
  const each = await VENUE_SERVICE.readLinesSoldInEach(
    tx,
    identities.flatMap((identity, i) =>
      priced.lines[i]?.parentLineNo != null && priced.lines[i]?.unitName != null
        ? [identity.id]
        : [],
    ),
  );
  const lines = ticketLinesFrom(priced, identities).map((line, i) =>
    each.has(identities[i]!.id) ? { ...line, soldInEach: true as const } : line,
  );
  if (!lines.some((line) => line.listGross !== undefined)) return { lines };
  const records = await readBillAdjustments(tx, workingOrderId);

  const rowIndex = new Map<string | undefined, number>(
    identities.map((identity, i) => [identity.id, i]),
  );
  const byLine = new Map<number, ReceiptAdjustment[]>();
  const onBill: ReceiptAdjustment[] = [];
  let placed = true;
  let takenOff = decimal("0.00");
  for (const record of records) {
    takenOff = addDecimal(takenOff, record.reduction);
    const entry: ReceiptAdjustment = {
      kind: record.action === "comp" ? "comp" : "discount",
      ...(record.action === "discount_percent" ? { percentBp: record.percentBp! } : {}),
      amount: record.reduction,
    };
    if (record.lineId === null) {
      onBill.push(entry);
      continue;
    }
    // Only a part carved off the line moves to the row split from it: a whole line can also split,
    // into two prices, and that second row can be numbered after other dishes.
    const row = record.partOfLine
      ? record.splits.find((split) => split.from === record.lineId)?.to
      : record.lineId;
    const at = rowIndex.get(row);
    if (at === undefined) {
      placed = false;
      continue;
    }
    const entries = byLine.get(at);
    if (entries === undefined) byLine.set(at, [entry]);
    else entries.push(entry);
  }

  const listed = sumDecimals(lines.map((line) => decimal(line.listGross ?? line.gross)));
  const charged = sumDecimals(lines.map((line) => decimal(line.gross)));
  if (placed && compareDecimal(subtractDecimal(listed, takenOff), charged) === 0) {
    return {
      lines: lines.map((line, i) => withEntries(line, byLine.get(i))),
      ...(onBill.length === 0 ? {} : { billAdjustments: onBill }),
    };
  }
  return { lines: perDish(lines) };
}

function withEntries(line: TillSaleLine, entries: ReceiptAdjustment[] | undefined): TillSaleLine {
  return entries === undefined ? line : { ...line, adjustments: entries };
}

/**
 * One entry per dish, on the dish's row, for what its changed rows lost: a comp when every one of
 * them now costs nothing.
 */
function perDish(lines: TillSaleLine[]): TillSaleLine[] {
  const entries = new Map<TillSaleLine, ReceiptAdjustment[]>();
  for (const { dish, options } of groupByParent(lines)) {
    const changed = [dish, ...options].filter((line) => line.listGross !== undefined);
    if (changed.length === 0) continue;
    const lost = sumDecimals(
      changed.map((line) => subtractDecimal(decimal(line.listGross!), decimal(line.gross))),
    );
    const comp = changed.every((line) => isZeroDecimal(decimal(line.gross)));
    entries.set(dish, [{ kind: comp ? "comp" : "discount", amount: lost }]);
  }
  return lines.map((line) => withEntries(line, entries.get(line)));
}
