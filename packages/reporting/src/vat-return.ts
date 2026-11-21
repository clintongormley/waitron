import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { isZeroDecimal, subtractDecimal } from "@waitron/shared";
import { sumByRate } from "./vat-summary.js";
import { computeInputVat } from "./input-vat.js";
import { validatePeriod } from "./period.js";
import type { LiquidationPeriod } from "./period.js";
import type { VatReturn, VatReturnInput } from "./types.js";
import { vatMovements } from "./vat-movements.js";

/**
 * The civil date `"YYYY-MM-DD"` a sale's VAT belongs to now: the `supply_day` of the replacement
 * that repeats it, else its own `supply_day`, else its filed issue date.
 */
export function saleVatDay(sale: {
  replacementSupplyDay: SQLWrapper;
  supplyDay: SQLWrapper;
  issuedAt: SQLWrapper;
  issuedOffsetMinutes: SQLWrapper;
}): SQL<string> {
  // `date(stamp, '<n> minutes')` reads the stored stamp as the instant it names and renders the
  // shifted civil date as `"YYYY-MM-DD"`, the shape `periodDateFilter` compares against. The explicit
  // sign is for a reader: SQLite reads an unsigned modifier as positive.
  const filedDate = sql`date(${sale.issuedAt}, printf('%+d minutes', ${sale.issuedOffsetMinutes}))`;
  return sql<string>`coalesce(${sale.replacementSupplyDay}, ${sale.supplyDay}, ${filedDate})`;
}

/** The period's first day and the day after its last, as `"YYYY-MM-DD"`. */
function periodBounds(year: number, period: LiquidationPeriod): { first: string; next: string } {
  const [firstMonth, months] =
    period.kind === "month"
      ? [period.month, 1]
      : period.kind === "quarter"
        ? [3 * period.quarter - 2, 3]
        : [1, 12];
  const day = (month: number) => new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  return { first: day(firstMonth), next: day(firstMonth + months) };
}

/**
 * The modelo 303 aggregate over one liquidation period (month/quarter/year), across ALL nodes of the
 * legal entity, both sides of the return:
 *
 *   - *IVA devengado* (output), the casilla 27 side: the per-rate sum of the VAT movements
 *     (`vatMovements`) that belong to the period and were made by its last day, so a period that
 *     has ended never changes. A movement made later for an earlier period is on the corrections of
 *     the period it was made in, never in a return. A rate line whose base and VAT both net to zero
 *     is left out.
 *   - *IVA deducible* (input): `computeInputVat`'s régimen-general per-(rate, kind) aggregate over the
 *     received supplier invoices, bucketed by `received_on` — the casilla 45 side (`deductible`).
 *   - `result`: the régimen-general result `taxTotal − deductible.taxTotal` (casilla 46 = 27 − 45).
 *
 * Both sides SUM the filed per-invoice cuotas and never `round(Σ base × rate)`, so `result` is exact.
 * There is no gross box on a 303, so `VatReturn` omits `grossTotal`.
 */
export async function computeVatReturn(tx: Transaction, input: VatReturnInput): Promise<VatReturn> {
  validatePeriod(input.year, input.period);

  const { first, next } = periodBounds(input.year, input.period);
  const movements = await vatMovements(tx, { year: input.year, period: input.period });
  const summary = sumByRate(
    movements.filter((m) => m.belongsDay >= first && m.belongsDay < next && m.madeDay < next),
  );
  const deducible = await computeInputVat(tx, {
    year: input.year,
    period: input.period,
  });

  return {
    year: input.year,
    period: input.period,
    byRate: summary.byRate.filter((line) => !(isZeroDecimal(line.base) && isZeroDecimal(line.tax))),
    baseTotal: summary.baseTotal,
    taxTotal: summary.taxTotal,
    deductible: {
      byRate: deducible.byRate,
      baseTotal: deducible.baseTotal,
      taxTotal: deducible.taxTotal,
    },
    result: subtractDecimal(summary.taxTotal, deducible.taxTotal),
  };
}
