import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { Decimal, NodeId } from "@waitron/shared";
import { addDecimal, compareDecimal, decimal, MONEY_SCALE, toScale } from "@waitron/shared";
import {
  activeSalesClause,
  businessDayClause,
  businessDayRangeClause,
  nodeScopeClause,
  validateBusinessDayRange,
  validateCutover,
  validateTimeZone,
} from "./business-day.js";
import type { DailyCloseInput, PeriodVatInput, VatSummary } from "./types.js";

/**
 * The shared VAT-aggregation core behind every per-rate summary. Reads the filed per-rate desglose
 * from `sales.vat_breakdown` — the exact cuota AEAT received, whichever method (direct or difference)
 * filed it — by unnesting the JSON array and summing base and tax per rate. Corrections (negative
 * breakdowns) net in for free; voided sales and F3-canje substitutes are excluded. The node predicate
 * is applied only when `scope.nodeId` is given; a tenant-wide aggregate — e.g. modelo 303 — omits it
 * and reads every sale in the database, which holds one tenant. Callers differ only in their
 * issuance-date `dateFilter` and whether a node is fixed.
 *
 * Exported for `vat-return.ts`'s modelo 303 aggregate to reuse; package-internal, deliberately NOT in
 * the public barrel (`index.ts`).
 */
export async function aggregateVatByRate(
  tx: Transaction,
  scope: { nodeId?: NodeId; dateFilter: SQL },
): Promise<VatSummary> {
  const nodeClause = nodeScopeClause(scope.nodeId);
  // No cents here, unlike every other money read in this package: `sales.vat_breakdown` is a JSON
  // document whose `base` and `tax` are the DECIMAL LITERALS filed with the invoice, not the integer
  // cents a money COLUMN holds. So this is the one read in the package where the amount arrives as
  // an amount, and the arithmetic over it has to stay exact.
  //
  // THE GROUPING AND THE SUM MOVED OUT OF SQL, and that is the whole of the change. It was
  // `sum((b->>'base')::numeric(12, 2))` over a `jsonb_array_elements` lateral; this engine has no
  // lateral, and — the reason that matters more — no exact decimal type at all, so summing filed
  // cuotas in SQL would sum them as binary floating point. The rows come back one JSON element at a
  // time and `@waitron/shared`'s Decimal arithmetic folds them, which is exact by construction.
  //
  // `toScale(…, MONEY_SCALE)` per element reproduces the `::numeric(12, 2)` cast PostgreSQL applied
  // to each element BEFORE summing, half away from zero either way; the accumulator starts at
  // "0.00" so the result carries two places even when every addend is written without them. The
  // rate is normalised the same way rather than grouped on the raw JSON string, so two spellings of
  // one rate ("21" vs "21.00") still cannot split into two byRate lines — every production rate is
  // a fixed 2-dp literal (`buildVatBreakdown`/`priceRows`), so this stays defensive normalisation.
  //
  // Measured whole against PGlite 0.5.8 (PostgreSQL 18.3), 2026-09-22: eight breakdowns mixing three
  // rates, three rate spellings, negative (rectificativa) documents and per-element values needing
  // half-away-from-zero rounding, aggregated both ways — four rate lines, identical rate, base and
  // tax on every one. Two controls, each of which breaks it: folding without the per-element
  // `toScale` disagrees on 2 of the 4 lines (33.335 against PostgreSQL's 33.34), and grouping on the
  // raw rate string yields 7 lines instead of 4.
  //
  // WHAT IS LOST, plainly: `::numeric(12, 2)` REFUSED an element past ten integer digits with a
  // 22003 and `::numeric(5, 2)` refused a rate past three, and neither refusal survives — an
  // out-of-range filed amount is now summed rather than rejected. And the row count changed: this
  // reads one row per breakdown ELEMENT of every matching sale, where the old query returned one row
  // per rate. Over a modelo 303 year that is the whole period's sales rather than a handful of rows.
  const { rows } = await tx.execute<{ rate: string; base: string; tax: string }>(sql`
    select
      b.value ->> 'rate' as rate,
      b.value ->> 'base' as base,
      b.value ->> 'tax' as tax
    from sales s, json_each(s.vat_breakdown) b
    where ${scope.dateFilter}
      ${nodeClause}
      and ${activeSalesClause()}
  `);

  const byRate = new Map<string, { rate: Decimal; base: Decimal; tax: Decimal }>();
  for (const r of rows) {
    const rate = toScale(decimal(r.rate), MONEY_SCALE);
    let line = byRate.get(rate);
    if (line === undefined) {
      line = { rate, base: decimal("0.00"), tax: decimal("0.00") };
      byRate.set(rate, line);
    }
    line.base = addDecimal(line.base, toScale(decimal(r.base), MONEY_SCALE));
    line.tax = addDecimal(line.tax, toScale(decimal(r.tax), MONEY_SCALE));
  }

  // Sorted numerically (compareDecimal, never the text order — 4.00 must precede 21.00), which is
  // also what stops the Map's insertion order — whichever sale the engine returned first — from
  // reaching a caller.
  const lines = [...byRate.values()].sort((a, b) => compareDecimal(a.rate, b.rate));

  let baseTotal = decimal("0.00");
  let taxTotal = decimal("0.00");
  for (const line of lines) {
    baseTotal = addDecimal(baseTotal, line.base);
    taxTotal = addDecimal(taxTotal, line.tax);
  }

  return {
    byRate: lines,
    baseTotal,
    taxTotal,
    grossTotal: addDecimal(baseTotal, taxTotal),
  };
}

/**
 * VAT summary for one node over one business day, anchored on issuance. Delegates to the
 * shared `aggregateVatByRate` core with the daily-close's `= businessDay` date filter, so its suite is
 * the behaviour-preserving guard for the extraction.
 */
export async function computeVatSummary(
  tx: Transaction,
  input: DailyCloseInput,
): Promise<VatSummary> {
  return aggregateVatByRate(tx, {
    nodeId: input.nodeId,
    dateFilter: businessDayClause(sql`s.issued_at`, input),
  });
}

/**
 * VAT summary over a closed RANGE of business days (a weekly/period roll-up), anchored on issuance,
 * at the node grain when `nodeId` is given or tenant-wide when it is omitted. Same cutover-shifted
 * business-day bucketing and same exclusions as the daily close, extended from `= businessDay` to
 * `between from and to`; the aggregate is `Σ` of the already-filed per-invoice figures over more
 * days, so exactness is inherited, not re-derived. Invalid inputs are a caller precondition and throw
 * a plain `Error` (matching `business-day.ts`'s validators — no registered error code).
 */
export async function computeVatSummaryForPeriod(
  tx: Transaction,
  input: PeriodVatInput,
): Promise<VatSummary> {
  validateTimeZone(input.timeZone);
  validateCutover(input.dayCutover);
  validateBusinessDayRange(input);
  return aggregateVatByRate(tx, {
    nodeId: input.nodeId,
    dateFilter: businessDayRangeClause(sql`s.issued_at`, input),
  });
}
