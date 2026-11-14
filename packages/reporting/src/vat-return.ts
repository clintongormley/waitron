import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { subtractDecimal } from "@waitron/shared";
import { activeSalesClause } from "./business-day.js";
import { aggregateVatByRate } from "./vat-summary.js";
import { computeInputVat } from "./input-vat.js";
import { periodDateFilter, validatePeriod } from "./period.js";
import type { VatReturn, VatReturnInput } from "./types.js";

/**
 * The modelo 303 aggregate over one liquidation period (month/quarter/year), across ALL nodes of the
 * legal entity, both sides of the return:
 *
 *   - *IVA devengado* (output): the régimen-general per-rate `Σ` over the filed `sales.vat_breakdown`
 *     (`byRate`/`baseTotal`/`taxTotal`), corrections netted — the casilla 27 side. A replaced sale
 *     counts once, through the original; its replacement is left out (`activeSalesClause`).
 *   - *IVA deducible* (input): `computeInputVat`'s régimen-general per-(rate, kind) aggregate over the
 *     received supplier invoices, bucketed by `received_on` — the casilla 45 side (`deductible`).
 *   - `result`: the régimen-general result `taxTotal − deductible.taxTotal` (casilla 46 = 27 − 45).
 *
 * Both sides SUM the filed per-invoice cuotas and never `round(Σ base × rate)`, so `result` is exact.
 * There is no gross box on a 303, so `VatReturn` omits `grossTotal`.
 *
 * The output side buckets a sale by a CIVIL date, not the operational business day, so it needs no
 * `timeZone` input: its replacement's `supply_day` when it has one, else its own filed *fecha de
 * expedición* — the issuance instant shifted by the sale's own snapshotted offset, the date
 * `@waitron/verifactu`'s `formatDate(issued_at, issued_offset_minutes)` filed.
 */
export async function computeVatReturn(tx: Transaction, input: VatReturnInput): Promise<VatReturn> {
  validatePeriod(input.year, input.period);

  // `date(stamp, '<n> minutes')` reads the stored stamp as the instant it names and renders the
  // shifted civil date as `"YYYY-MM-DD"`, the shape `periodDateFilter` compares against. The explicit
  // sign is for a reader: SQLite reads an unsigned modifier as positive.
  const filedDate = sql`date(s.issued_at, printf('%+d minutes', s.issued_offset_minutes))`;
  // `sales_one_replacement_uq` admits at most one replacement per sale, so the join adds no rows.
  const summary = await aggregateVatByRate(tx, {
    joined: sql`left join sales repl on repl.corrects_sale_id = s.id and repl.replaces_original = 1`,
    counted: sql`${periodDateFilter(
      sql`coalesce(repl.supply_day, ${filedDate})`,
      input.year,
      input.period,
    )} and ${activeSalesClause()}`,
  });
  const deducible = await computeInputVat(tx, {
    year: input.year,
    period: input.period,
  });

  return {
    year: input.year,
    period: input.period,
    byRate: summary.byRate,
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
