import { and, asc, eq, ne } from "drizzle-orm";
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
  MONEY_SCALE,
  multiplyDecimal,
  sumDecimals,
  thousandthsToDecimal,
  vatRateOn,
  type BusinessDayClock,
  type Decimal,
  type VatClass,
} from "@waitron/shared";
import { addDays } from "@waitron/venue-service";
import { inIds } from "./kitchen-print.js";

/** One dish or bill given free: a comp, or a discount that left it at zero. */
export interface FreeItem {
  adjustmentId: string;
  /** The adjustment's civil date in the venue's zone. */
  date: string;
  /** The invoice of the bill the dish is on now, or of the discounted bill; null when none. */
  invoice: { seriesCode: string; number: number } | null;
  /** The line's name; null for the whole bill. */
  item: string | null;
  /** How much of the dish is still on a bill; null for the whole bill. */
  quantity: Decimal | null;
  kind: "comp" | "discount";
  department: string | null;
  /** The list value of the rows the adjustment took money off that are still on a bill. */
  menuPrice: Decimal;
  /** What the adjustment took off those rows. */
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
 * `Σ numerator ÷ denominator`, rounded half up to the cent once. A quotient need not end as a
 * decimal, so the sum is taken over one common denominator and divided only for the final cent.
 */
function sumOfQuotients(parts: readonly { numerator: Decimal; denominator: Decimal }[]): Decimal {
  const byDenominator = new Map<Decimal, Decimal>();
  for (const { numerator, denominator } of parts) {
    byDenominator.set(
      denominator,
      addDecimal(byDenominator.get(denominator) ?? decimal("0"), numerator),
    );
  }
  const denominators = [...byDenominator.keys()];
  const numerator = sumDecimals(
    [...byDenominator.values()].map((sum, i) =>
      denominators.reduce(
        (product, denominator, j) => (i === j ? product : multiplyDecimal(product, denominator)),
        sum,
      ),
    ),
  );
  return divideDecimal(numerator, denominators.reduce(multiplyDecimal, ONE), MONEY_SCALE);
}

/**
 * The prices without VAT, summed, less the margin: `Σ gross ÷ (1 + rate) × (10000 − margin) ÷
 * 10000`, rounded half up to the cent once (plan D14). Rates are percentages ("10.00").
 */
export function estimatedCost(
  prices: readonly { gross: Decimal; rate: Decimal }[],
  marginBp: number | null,
): Decimal | null {
  if (marginBp === null) return null;
  const kept = decimal(String(10000 - marginBp));
  return sumOfQuotients(
    prices.map(({ gross, rate }) => ({
      numerator: multiplyDecimal(multiplyDecimal(gross, HUNDRED), kept),
      denominator: multiplyDecimal(addDecimal(HUNDRED, rate), WHOLE_BP),
    })),
  );
}

/**
 * The period's free dishes and bills, oldest first: the Adjustments report's entries on the bills
 * opened over the period's first to last business day (D10) that are not cancels and left their
 * subject at zero, each told by the rows it took money off that are still on a bill, and left out
 * when none is (D3).
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
      toBusinessDay: addDays(next, -1),
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

  // A split after printing abandons the bill and copies its rows, with what each adjustment took
  // off them, to a new one; cancelling a placed bill abandons it too. Neither leaves its rows on a
  // bill.
  const reduced = await tx
    .select({
      adjustmentId: adjustmentLines.adjustmentId,
      reduction: adjustmentLines.reduction,
      reducedQuantity: adjustmentLines.quantity,
      workingOrderId: workingOrderLines.workingOrderId,
      dining: workingOrders.dining,
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
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(
      and(
        inIds(
          adjustmentLines.adjustmentId,
          entries.map((entry) => entry.id),
        ),
        ne(workingOrders.status, "abandoned"),
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
      status: workingOrders.status,
      departmentId: workingOrders.departmentId,
      seriesCode: invoiceSeries.code,
      number: sales.invoiceNumber,
    })
    .from(workingOrders)
    .leftJoin(sales, eq(sales.workingOrderId, workingOrders.id))
    .leftJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(
      inIds(workingOrders.id, [
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
    .where(inIds(departments.id, departmentIds));
  const departmentById = new Map(named.map((department) => [department.id, department]));

  const items: FreeItem[] = [];
  for (const entry of entries) {
    const lines = linesOf.get(entry.id) ?? [];
    if (lines.length === 0) continue;
    const date = civilDateOf(new Date(entry.createdAt), clock.timeZone);
    const dishes = lines.filter((line) => line.parentLineId === null);
    const first = dishes[0] ?? lines[0]!;
    const own = billById.get(entry.workingOrderId)!;
    const bill =
      entry.lineId === null && own.status !== "abandoned"
        ? own
        : billById.get(first.workingOrderId)!;
    const departmentId =
      entry.lineId === null ? bill.departmentId : (first.offerDepartmentId ?? bill.departmentId);
    const department = departmentId === null ? undefined : departmentById.get(departmentId);
    const prices = lines.map((line) => ({
      gross: divideDecimal(
        multiplyDecimal(
          centsToDecimal(line.listUnitPriceGross ?? line.unitPriceGross),
          thousandthsToDecimal(line.quantity),
        ),
        thousandthsToDecimal(line.priceQuantity),
        MONEY_SCALE,
      ),
      rate: vatRateOn(
        (line.dining === "takeaway" ? line.takeawayVatClass : line.vatClass) as VatClass,
        date,
      ),
    }));
    items.push({
      adjustmentId: entry.id,
      date,
      invoice:
        bill.seriesCode === null || bill.number === null
          ? null
          : { seriesCode: bill.seriesCode, number: bill.number },
      item: entry.lineName,
      quantity:
        entry.lineId === null
          ? null
          : thousandthsToDecimal(
              (dishes.length > 0 ? dishes : lines).reduce((sum, line) => sum + line.quantity, 0),
            ),
      kind: entry.action === "comp" ? "comp" : "discount",
      department: department?.name ?? null,
      menuPrice: sumDecimals(prices.map(({ gross }) => gross)),
      // Each row records what was taken off the quantity its line held then; a row split off
      // since carries the same figures, so a row's part is its share of that quantity.
      amountTakenOff: sumOfQuotients(
        lines.map((line) => ({
          numerator: multiplyDecimal(
            centsToDecimal(line.reduction),
            thousandthsToDecimal(line.quantity),
          ),
          denominator: thousandthsToDecimal(line.reducedQuantity),
        })),
      ),
      estimatedCost: estimatedCost(prices, department?.marginBp ?? null),
      reason: entry.reasonName,
      note: entry.note,
    });
  }
  return items;
}
