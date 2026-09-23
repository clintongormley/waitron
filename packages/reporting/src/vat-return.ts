import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { subtractDecimal } from "@waitron/shared";
import { aggregateVatByRate } from "./vat-summary.js";
import { computeInputVat } from "./input-vat.js";
import { periodDateFilter, validatePeriod } from "./period.js";
import type { VatReturn, VatReturnInput } from "./types.js";

/**
 * The modelo 303 aggregate over one liquidation period (month/quarter/year), for one obligado
 * (tenant), across ALL nodes of the legal entity — now BOTH sides of the return:
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
 * (`formatDate(issued_at, issued_offset_minutes)` — from `@waitron/verifactu`). The SQL below
 * applies the same fixed snapshot offset to the same instant and reads the same date components, so it
 * yields the same civil date `formatDate` filed and needs no `timeZone` input. The +120-offset
 * July/August boundary case in `vat-return.test.ts` pins that equivalence. The input side buckets by
 * the civil `received_on` (the deduction period, spec §D3).
 */
export async function computeVatReturn(tx: Transaction, input: VatReturnInput): Promise<VatReturn> {
  // Caller preconditions — a bad year/period is a plain Error, thrown BEFORE any query (shared with
  // computeInputVat; see period.ts for the four-digit-year rationale).
  validatePeriod(input.year, input.period);

  // The filed fecha de expedición = shift(issued_at, issued_offset_minutes) then read the civil date —
  // byte-identical to `@waitron/verifactu`'s formatDate (spec §4). `date(stamp, '<n> minutes')` reads
  // the stored stamp as the instant it names and renders the shifted civil date as `"YYYY-MM-DD"`,
  // which is the shape `periodDateFilter` compares against. No zone is re-derived: the sale's own
  // snapshotted offset is the whole of the shift, as it was.
  //
  // It replaces `((s.issued_at at time zone 'UTC') + make_interval(mins => …))::date`, and was
  // measured against it on PGlite 0.5.8 (PostgreSQL 18.3), 2026-09-22: 960 pairs — 80 instants
  // (eight dates including two month ends, a year end and a leap day × ten times of day clustered on
  // midnight and the late-evening hours an offset moves across it) × twelve offsets from -840 to
  // +840 — 0 disagreements. The control that says the measurement can fail: reading the stamp as
  // LOCAL time instead (a trailing `'localtime'` modifier) disagrees on 144 of the 960.
  //
  // `printf('%+d minutes', …)` writes the sign explicitly. Measured, that sign is NOT what makes it
  // work — `'%d minutes'` gives the same 960/960, because SQLite accepts an unsigned modifier as
  // positive — so this is for a reader, not for the engine.
  const filedDate = sql`date(s.issued_at, printf('%+d minutes', s.issued_offset_minutes))`;
  const dateFilter = periodDateFilter(filedDate, input.year, input.period);

  const summary = await aggregateVatByRate(tx, { dateFilter });
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
