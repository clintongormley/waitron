import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { subtractDecimal } from "@waitron/shared";
import { aggregateVatByRate } from "./vat-summary.js";
import { computeInputVat } from "./input-vat.js";
import { calendarMonthFilter, validateLiquidationPeriod } from "./period.js";
import type { VatReturn, VatReturnInput } from "./types.js";

/**
 * The modelo 303 aggregate over one calendar month, for one obligado (tenant), across ALL nodes of
 * the legal entity — now BOTH sides of the return:
 *
 *   - *IVA devengado* (output): the régimen-general per-rate `Σ` over the filed `sales.vat_breakdown`
 *     (`byRate`/`baseTotal`/`taxTotal`), bucketed by the filed *fecha de expedición*, corrections
 *     netted — the casilla 27 side. Unchanged from #76; those fields keep their shape and meaning.
 *   - *IVA deducible* (input): `computeInputVat`'s régimen-general per-(rate, kind) aggregate over the
 *     received supplier invoices, bucketed by `received_on` — the casilla 45 side (`deductible`).
 *   - `result`: the régimen-general result `taxTotal − deductible.taxTotal` (casilla 46 = 27 − 45).
 *
 * Both sides SUM the filed per-invoice cuotas and never `round(Σ base × rate)`, so `result` is exact
 * (#76/#66). There is no gross box on a 303, so `VatReturn` omits `grossTotal`.
 *
 * Bucketing is by the filed *fecha de expedición* on the output side (a CIVIL calendar date, not the
 * operational business day, spec §4/D4): the filed `FechaExpedicionFactura` is the civil-local date of
 * the issuance instant using the sale's OWN snapshotted offset, exactly what AEAT received
 * (`formatDate(issued_at, issued_offset_minutes)` — `packages/verifactu/src/format.ts`). The SQL below
 * applies the same fixed snapshot offset to the same instant and reads the same date components, so it
 * yields the same civil date `formatDate` filed and needs no `timeZone` input. The +120-offset
 * July/August boundary case in `vat-return.test.ts` pins that equivalence. The input side buckets by
 * the civil `received_on` (the deduction period, spec §D3).
 */
export async function computeVatReturn(tx: Transaction, input: VatReturnInput): Promise<VatReturn> {
  // Caller preconditions — a bad year/month is a plain Error, thrown BEFORE any query (shared with
  // computeInputVat; see period.ts for the four-digit-year rationale).
  validateLiquidationPeriod(input.year, input.month);

  // The filed fecha de expedición = shift(issued_at, issued_offset_minutes) then read the civil date —
  // byte-identical to verifactu/format.ts's formatDate (spec §4). `at time zone 'UTC'` yields the UTC
  // wall-clock timestamp of the stored timestamptz; adding the snapshot offset reproduces the filed
  // local calendar date without re-deriving any zone.
  const filedDate = sql`((s.issued_at at time zone 'UTC') + make_interval(mins => s.issued_offset_minutes))::date`;
  const dateFilter = calendarMonthFilter(filedDate, input.year, input.month);

  const summary = await aggregateVatByRate(tx, { tenantId: input.tenantId, dateFilter });
  const deducible = await computeInputVat(tx, {
    tenantId: input.tenantId,
    year: input.year,
    month: input.month,
  });

  return {
    tenantId: input.tenantId,
    year: input.year,
    month: input.month,
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
