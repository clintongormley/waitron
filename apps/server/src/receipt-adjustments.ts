import { readBillAdjustments } from "@waitron/adjustments";
import type { Transaction } from "@waitron/db";
import { sales, saleLines } from "@waitron/db";
import { and, eq, isNotNull } from "drizzle-orm";
import {
  addDecimal,
  basisPointsToDecimal,
  centsToDecimal,
  compareDecimal,
  decimal,
  isZeroDecimal,
  subtractDecimal,
  sumDecimals,
  thousandthsToDecimal,
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
  workingOrderId: string | null,
  priced: { lines: readonly ReceiptSource[] },
  identities: readonly Pick<OrderLineIdentity, "id" | "listUnitGross">[],
  saleId?: string,
): Promise<Pick<TillSaleResult, "lines" | "billAdjustments">> {
  const each = await VENUE_SERVICE.readLinesSoldInEach(
    tx,
    identities.flatMap((identity, i) => (priced.lines[i]?.unitName != null ? [identity.id] : [])),
  );
  let lines = ticketLinesFrom(priced, identities).map((line, i) =>
    each.has(identities[i]!.id) ? { ...line, soldInEach: true as const } : line,
  );
  if (saleId !== undefined) {
    const filed = await tx
      .select({
        lineNo: saleLines.lineNo,
        unitPrice: saleLines.unitPrice,
        priceQuantity: saleLines.priceQuantity,
        base: saleLines.lineTotal,
        rate: saleLines.vatRate,
        gross: saleLines.lineGross,
        listGross: saleLines.listGross,
        listUnitPriceGross: saleLines.listUnitPriceGross,
      })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(and(eq(sales.id, saleId), isNotNull(sales.counterpartyTaxId)));
    if (filed.length > 0) {
      const byLineNo = new Map(filed.map((line) => [line.lineNo, line]));
      lines = lines.map((line, i) => {
        const row = byLineNo.get(priced.lines[i]!.lineNo)!;
        const display = { ...line };
        delete display.listGross;
        return {
          ...display,
          ...(row.listGross === null ? {} : { listGross: centsToDecimal(row.listGross) }),
          ...(row.listGross === null || row.listUnitPriceGross === null
            ? {}
            : { listUnitPriceGross: centsToDecimal(row.listUnitPriceGross) }),
          net: {
            unitPrice: centsToDecimal(row.unitPrice),
            priceQuantity: thousandthsToDecimal(row.priceQuantity),
            base: centsToDecimal(row.base),
            rate: basisPointsToDecimal(row.rate),
            ...(row.gross === null
              ? {}
              : { tax: subtractDecimal(centsToDecimal(row.gross), centsToDecimal(row.base)) }),
          },
        };
      });
    }
  }
  if (!lines.some((line) => line.listGross !== undefined)) return { lines };
  const records = workingOrderId === null ? [] : await readBillAdjustments(tx, workingOrderId);

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
      kind: record.full ? "comp" : "discount",
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

  const listed = sumDecimals(
    lines.map((line) =>
      line.listGross === undefined ? chargedAmount(line) : decimal(line.listGross),
    ),
  );
  const charged = sumDecimals(lines.map(chargedAmount));
  if (placed && compareDecimal(subtractDecimal(listed, takenOff), charged) === 0) {
    return {
      lines: withFamilies(lines, records, rowIndex).map((line, i) =>
        withEntries(line, byLine.get(i)),
      ),
      ...(onBill.length === 0 ? {} : { billAdjustments: onBill }),
    };
  }
  return { lines: perDish(lines) };
}

/**
 * Marks each filed row of a dish family — the dish groups an adjustment's splits joined — with the
 * index of the family's first row. A dish group no split joined to another is left unmarked.
 */
function withFamilies(
  lines: TillSaleLine[],
  records: readonly { splits: readonly { from: string; to: string }[] }[],
  rowIndex: ReadonlyMap<string | undefined, number>,
): TillSaleLine[] {
  if (!lines.some((line) => line.net !== undefined)) return lines;
  const first = lines.map((_, i) => i);
  const find = (i: number): number => {
    while (first[i] !== i) i = first[i] = first[first[i]!]!;
    return i;
  };
  const join = (a: number, b: number) => {
    const [x, y] = [find(a), find(b)];
    first[Math.max(x, y)] = Math.min(x, y);
  };
  for (const { splits } of records) {
    for (const { from, to } of splits) {
      const [a, b] = [rowIndex.get(from), rowIndex.get(to)];
      if (a !== undefined && b !== undefined) join(a, b);
    }
  }
  const at = new Map(lines.map((line, i) => [line, i]));
  const groups = groupByParent(lines);
  for (const { dish, options } of groups) {
    for (const option of options) join(at.get(dish)!, at.get(option)!);
  }
  const dishGroups = new Map<number, number>();
  for (const { dish } of groups) {
    const family = find(at.get(dish)!);
    dishGroups.set(family, (dishGroups.get(family) ?? 0) + 1);
  }
  return lines.map((line, i) => {
    const family = find(i);
    return line.net !== undefined && dishGroups.get(family)! > 1
      ? { ...line, dishFamily: family }
      : line;
  });
}

function chargedAmount(line: TillSaleLine) {
  return line.net?.tax === undefined
    ? decimal(line.gross)
    : addDecimal(decimal(line.net.base), decimal(line.net.tax));
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
      changed.map((line) => subtractDecimal(decimal(line.listGross!), chargedAmount(line))),
    );
    const comp = changed.every((line) => isZeroDecimal(chargedAmount(line)));
    entries.set(dish, [{ kind: comp ? "comp" : "discount", amount: lost }]);
  }
  return lines.map((line) => withEntries(line, entries.get(line)));
}
