import { and, asc, eq, ne } from "drizzle-orm";
import {
  listAdjustmentEntries,
  MAX_ENTRY_PAGE_SIZE,
  standingOff,
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
  rateOn,
  thousandthsToDecimal,
  type BusinessDayClock,
  type DatedRate,
  type Decimal,
  type Dining,
  type VatClass,
} from "@waitron/shared";
import { addDays } from "@waitron/venue-service";
import { inIds } from "./kitchen-print.js";
import { readLineVatRates } from "./line-vat-rates.js";

/** One dish or bill given free: a comp, or a discount that left it at zero. */
export interface FreeItem {
  adjustmentId: string;
  /** The adjustment's civil date in the venue's zone. */
  date: string;
  /** The invoice of the bill these rows are on now; null when it has none. */
  invoice: { seriesCode: string; number: number } | null;
  /** The line's name; null for the whole bill. */
  item: string | null;
  /** How much of the dish is on this bill; null for the whole bill. */
  quantity: Decimal | null;
  kind: "comp" | "discount";
  department: string | null;
  /** The list value of the rows the adjustment took money off that are on this bill. */
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
 * subject at zero, told by the rows each took money off that are still on a bill, one row per bill
 * those rows are on (earliest opened first), and left out when none is (D3).
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
      productId: workingOrderLines.productId,
      setMenuRole: workingOrderLines.setMenuRole,
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
  // Each line's rates as read now, taken on the adjustment's day below. A takeaway product line's
  // are its product's current rows, which may differ from those it was invoiced at.
  const ratesOf = new Map<(typeof reduced)[number], readonly DatedRate[]>();
  for (const dining of ["eat_in", "takeaway"] as const satisfies readonly Dining[]) {
    const lines = reduced.filter((line) => line.dining === dining);
    const rates = await readLineVatRates(
      tx,
      dining,
      lines.map((line) => ({
        productId: line.productId,
        setMenuRole: line.setMenuRole,
        vatClass: line.vatClass as VatClass,
        takeawayVatClass: line.takeawayVatClass as VatClass,
      })),
    );
    lines.forEach((line, i) => ratesOf.set(line, rates[i]!));
  }
  const linesOf = new Map<string, Map<string, typeof reduced>>();
  for (const line of reduced) {
    const byBill = linesOf.get(line.adjustmentId) ?? new Map<string, typeof reduced>();
    byBill.set(line.workingOrderId, [...(byBill.get(line.workingOrderId) ?? []), line]);
    linesOf.set(line.adjustmentId, byBill);
  }
  const bills = await tx
    .select({
      id: workingOrders.id,
      openedAt: workingOrders.openedAt,
      departmentId: workingOrders.departmentId,
      seriesCode: invoiceSeries.code,
      number: sales.invoiceNumber,
    })
    .from(workingOrders)
    .leftJoin(sales, eq(sales.workingOrderId, workingOrders.id))
    .leftJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(
      inIds(
        workingOrders.id,
        reduced.map((line) => line.workingOrderId),
      ),
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
    const date = civilDateOf(new Date(entry.createdAt), clock.timeZone);
    const groups = [...(linesOf.get(entry.id) ?? new Map<string, typeof reduced>())]
      .map(([billId, lines]) => ({ bill: billById.get(billId)!, lines }))
      .sort(
        (a, b) =>
          a.bill.openedAt.localeCompare(b.bill.openedAt) || a.bill.id.localeCompare(b.bill.id),
      );
    for (const { bill, lines } of groups) {
      const dishes = lines.filter((line) => line.parentLineId === null);
      const counted = dishes.length > 0 ? dishes : lines;
      const departmentId =
        entry.lineId === null
          ? bill.departmentId
          : (counted[0]!.offerDepartmentId ?? bill.departmentId);
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
        rate: rateOn(ratesOf.get(line)!, date),
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
            : thousandthsToDecimal(counted.reduce((sum, line) => sum + line.quantity, 0)),
        kind: entry.action === "comp" ? "comp" : "discount",
        department: department?.name ?? null,
        menuPrice: sumDecimals(prices.map(({ gross }) => gross)),
        // Each row records what was taken off the quantity its line held then; a row split off
        // since carries the same figures, so a row's part is its share of that quantity.
        amountTakenOff: standingOff(
          lines.map((line) => ({
            reduction: centsToDecimal(line.reduction),
            quantityThen: thousandthsToDecimal(line.reducedQuantity),
            quantityNow: thousandthsToDecimal(line.quantity),
          })),
        ),
        estimatedCost: estimatedCost(prices, department?.marginBp ?? null),
        reason: entry.reasonName,
        note: entry.note,
      });
    }
  }
  return items;
}
