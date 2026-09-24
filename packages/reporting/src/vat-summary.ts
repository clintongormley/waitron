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
 * from `sales.vat_breakdown` — the cuota as filed, whichever method (direct or difference) computed
 * it — and sums base and tax per rate. Corrections (negative breakdowns) net in; voided sales and
 * F3-canje substitutes are excluded. Callers differ only in their issuance-date `dateFilter` and
 * whether a node is fixed.
 *
 * Exported for `vat-return.ts`'s modelo 303 aggregate; not in the public barrel.
 */
export async function aggregateVatByRate(
  tx: Transaction,
  scope: { nodeId?: NodeId; dateFilter: SQL },
): Promise<VatSummary> {
  const nodeClause = nodeScopeClause(scope.nodeId);
  // `sales.vat_breakdown` is a JSON document whose `base` and `tax` are the decimal literals filed
  // with the invoice, not integer cents, and this engine has no exact decimal type, so the sum is
  // taken here in Decimal arithmetic, one JSON element per row. Each element is rounded to cents
  // (half away from zero) before it is added, and the rate is normalised the same way, so "21" and
  // "21.00" cannot split into two lines. Nothing in this path bounds an element's width: an amount
  // of any width is summed, and a rate of any width keys its own line, rather than either being
  // refused.
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

  // Numerically, never in text order (4.00 before 21.00), so the Map's insertion order — whichever
  // sale the engine returned first — never reaches a caller.
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

/** VAT summary for one node, or the whole venue, over one business day, anchored on issuance. */
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
 * VAT summary over a closed RANGE of business days, anchored on issuance, for one node or, when
 * `nodeId` is omitted, the whole venue. Same bucketing and exclusions as the daily close. Invalid
 * inputs are a caller precondition and throw a plain `Error`.
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
