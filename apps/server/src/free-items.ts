import { asc, eq, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import {
  listAdjustmentEntries,
  MAX_ENTRY_PAGE_SIZE,
  type AdjustmentEntry,
  type EntryCursor,
} from "@waitron/adjustments";
import {
  adjustmentLines,
  departments,
  invoiceSeries,
  sales,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import {
  civilDateOf,
  periodDays,
  validatePeriod,
  type LiquidationPeriod,
} from "@waitron/reporting";
import {
  addDecimal,
  centsToDecimal,
  decimal,
  divideDecimal,
  isZeroDecimal,
  multiplyDecimal,
  sumDecimals,
  thousandthsToDecimal,
  vatRateOn,
  type BusinessDayClock,
  type Decimal,
  type VatClass,
} from "@waitron/shared";

/** One dish or bill given free: a comp, or a discount that left it at zero. */
export interface FreeItem {
  adjustmentId: string;
  /** The adjustment's civil date in the venue's zone. */
  date: string;
  /** The invoice of the bill the dish is on now, or of the discounted bill; null when none. */
  invoice: { seriesCode: string; number: number } | null;
  /** The line's name; null for the whole bill. */
  item: string | null;
  quantity: Decimal | null;
  kind: "comp" | "discount";
  department: string | null;
  /** The list value of what was given free; for a whole bill, of the rows it took money off that
   * are still on a bill. */
  menuPrice: Decimal;
  amountTakenOff: Decimal;
  /** Null when the department, or the bill, has no estimated margin. */
  estimatedCost: Decimal | null;
  reason: string;
  note: string | null;
}

const HUNDRED = decimal("100");
const ONE = decimal("1");
const WHOLE_BP = decimal("10000");

/**
 * The prices without VAT, summed, less the margin: `Σ gross ÷ (1 + rate) × (10000 − margin) ÷
 * 10000`, rounded half up to the cent once (plan D14). Rates are percentages ("10.00").
 */
export function estimatedCost(
  prices: readonly { gross: Decimal; rate: Decimal }[],
  marginBp: number | null,
): Decimal | null {
  if (marginBp === null) return null;
  // A price without VAT need not end as a decimal, so the sum is taken over one common
  // denominator, the product of each rate's (100 + rate), and divided only for the final cent.
  const grossByRate = new Map<Decimal, Decimal>();
  for (const { gross, rate } of prices) {
    grossByRate.set(rate, addDecimal(grossByRate.get(rate) ?? decimal("0"), gross));
  }
  const divisors = [...grossByRate.keys()].map((rate) => addDecimal(HUNDRED, rate));
  const numerator = sumDecimals(
    [...grossByRate.values()].map((gross, i) =>
      divisors.reduce(
        (product, divisor, j) => (i === j ? product : multiplyDecimal(product, divisor)),
        multiplyDecimal(gross, HUNDRED),
      ),
    ),
  );
  return divideDecimal(
    multiplyDecimal(numerator, decimal(String(10000 - marginBp))),
    multiplyDecimal(divisors.reduce(multiplyDecimal, ONE), WHOLE_BP),
    2,
  );
}

function among(column: SQLWrapper, ids: readonly string[]): SQL {
  return sql`${column} in (select value from json_each(${JSON.stringify([...new Set(ids)])}))`;
}

function dayBefore(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * The period's free dishes and bills, oldest first: the Adjustments report's entries on the bills
 * opened over the period's first to last business day (D10) that are not cancels and left their
 * subject at zero, less a dish's whose line has since left the bill (D3).
 */
export async function listFreeItems(
  tx: Transaction,
  clock: BusinessDayClock,
  { year, period }: { year: number; period: LiquidationPeriod },
): Promise<FreeItem[]> {
  validatePeriod(year, period);
  const { first, next } = periodDays(year, period);
  const entries: AdjustmentEntry[] = [];
  let after: EntryCursor | null = null;
  do {
    const page = await listAdjustmentEntries(tx, {
      ...clock,
      fromBusinessDay: first,
      toBusinessDay: dayBefore(next),
      limit: MAX_ENTRY_PAGE_SIZE,
      ...(after === null ? {} : { after }),
    });
    entries.push(
      ...page.entries.filter(
        (entry) => entry.action !== "cancel" && isZeroDecimal(entry.afterAmount),
      ),
    );
    after = page.next;
  } while (after !== null);
  if (entries.length === 0) return [];
  entries.reverse();

  // The rows each adjustment took money off that are still on a bill.
  const reduced = await tx
    .select({
      adjustmentId: adjustmentLines.adjustmentId,
      id: workingOrderLines.id,
      workingOrderId: workingOrderLines.workingOrderId,
      parentLineId: workingOrderLines.parentLineId,
      offerDepartmentId: workingOrderLines.offerDepartmentId,
      vatClass: workingOrderLines.vatClass,
      takeawayVatClass: workingOrderLines.takeawayVatClass,
      unitPriceGross: workingOrderLines.unitPriceGross,
      listUnitPriceGross: workingOrderLines.listUnitPriceGross,
      quantity: workingOrderLines.quantity,
      priceQuantity: workingOrderLines.priceQuantity,
    })
    .from(adjustmentLines)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, adjustmentLines.lineId))
    .where(
      among(
        adjustmentLines.adjustmentId,
        entries.map((entry) => entry.id),
      ),
    )
    .orderBy(asc(workingOrderLines.lineNo));
  const linesOf = new Map<string, typeof reduced>();
  for (const line of reduced) {
    const list = linesOf.get(line.adjustmentId) ?? [];
    list.push(line);
    linesOf.set(line.adjustmentId, list);
  }
  const bills = await tx
    .select({
      id: workingOrders.id,
      departmentId: workingOrders.departmentId,
      dining: workingOrders.dining,
      seriesCode: invoiceSeries.code,
      number: sales.invoiceNumber,
    })
    .from(workingOrders)
    .leftJoin(sales, eq(sales.workingOrderId, workingOrders.id))
    .leftJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(
      among(workingOrders.id, [
        ...entries.map((entry) => entry.workingOrderId),
        ...reduced.map((line) => line.workingOrderId),
      ]),
    );
  const billById = new Map(bills.map((bill) => [bill.id, bill]));
  const departmentIds = [
    ...reduced.flatMap((line) => line.offerDepartmentId ?? []),
    ...bills.flatMap((bill) => bill.departmentId ?? []),
  ];
  const named = await tx
    .select({
      id: departments.id,
      name: departments.name,
      marginBp: departments.estimatedMarginBp,
    })
    .from(departments)
    .where(among(departments.id, departmentIds));
  const departmentById = new Map(named.map((department) => [department.id, department]));

  const items: FreeItem[] = [];
  for (const entry of entries) {
    const date = civilDateOf(new Date(entry.createdAt), clock.timeZone);
    const rateOf = (line: (typeof reduced)[number], dining: string): Decimal =>
      vatRateOn((dining === "takeaway" ? line.takeawayVatClass : line.vatClass) as VatClass, date);
    const lines = linesOf.get(entry.id) ?? [];
    let bill: (typeof bills)[number];
    let departmentId: string | null;
    let menuPrice: Decimal;
    let prices: { gross: Decimal; rate: Decimal }[];
    if (entry.lineId === null) {
      bill = billById.get(entry.workingOrderId)!;
      departmentId = bill.departmentId;
      prices = lines.map((line) => ({
        gross: divideDecimal(
          multiplyDecimal(
            centsToDecimal(line.listUnitPriceGross ?? line.unitPriceGross),
            thousandthsToDecimal(line.quantity),
          ),
          thousandthsToDecimal(line.priceQuantity),
          2,
        ),
        rate: rateOf(line, billById.get(line.workingOrderId)!.dining),
      }));
      menuPrice = sumDecimals(prices.map(({ gross }) => gross));
    } else {
      const line = lines.find((one) => one.parentLineId === null) ?? lines[0];
      if (line === undefined) continue;
      bill = billById.get(line.workingOrderId)!;
      departmentId = line.offerDepartmentId ?? bill.departmentId;
      menuPrice = entry.nominalValue;
      prices = [{ gross: entry.nominalValue, rate: rateOf(line, bill.dining) }];
    }
    const department = departmentId === null ? undefined : departmentById.get(departmentId);
    items.push({
      adjustmentId: entry.id,
      date,
      invoice:
        bill.seriesCode === null || bill.number === null
          ? null
          : { seriesCode: bill.seriesCode, number: bill.number },
      item: entry.lineName,
      quantity: entry.quantity,
      kind: entry.action === "comp" ? "comp" : "discount",
      department: department?.name ?? null,
      menuPrice,
      amountTakenOff: entry.reduction,
      estimatedCost: estimatedCost(prices, department?.marginBp ?? null),
      reason: entry.reasonName,
      note: entry.note,
    });
  }
  return items;
}
