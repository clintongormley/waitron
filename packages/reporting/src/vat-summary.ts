import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { NodeId, TenantId } from "@waitron/shared";
import { addDecimal, compareDecimal, decimal } from "@waitron/shared";
import {
  activeSalesClause,
  businessDayClause,
  businessDayRangeClause,
  validateBusinessDay,
  validateCutover,
  validateTimeZone,
} from "./business-day.js";
import type { DailyCloseInput, PeriodVatInput, VatSummary } from "./types.js";

/**
 * The shared VAT-aggregation core behind every per-rate summary. Reads the filed per-rate desglose
 * from `sales.vat_breakdown` — the exact cuota AEAT received, whichever method (direct or difference)
 * filed it — by unnesting the jsonb array and summing base and tax per rate. Corrections (negative
 * breakdowns) net in for free; voided sales and F3-canje substitutes are excluded. The explicit
 * tenant predicate is belt-and-suspenders over RLS (mirrors listOutstandingSales); the node predicate
 * is applied only when `scope.nodeId` is given (a tenant-wide aggregate — e.g. modelo 303 — omits it,
 * relying on RLS + the tenant predicate). Callers differ only in their issuance-date `dateFilter` and
 * whether a node is fixed.
 *
 * Exported for `vat-return.ts`'s modelo 303 aggregate to reuse; package-internal, deliberately NOT in
 * the public barrel (`index.ts`).
 */
export async function aggregateVatByRate(
  tx: Transaction,
  scope: { tenantId: TenantId; nodeId?: NodeId; dateFilter: SQL },
): Promise<VatSummary> {
  const nodeClause = scope.nodeId ? sql`and s.node_id = ${scope.nodeId}` : sql``;
  // The rate is grouped as `numeric(5,2)::text`, not the raw jsonb string, so two spellings of the
  // same rate ("21" vs "21.00") can never split into two byRate lines. Every production rate is
  // already a fixed 2-dp literal (`buildVatBreakdown`/`priceRows`), so this is defensive normalisation.
  const { rows } = await tx.execute<{ rate: string; base: string; tax: string }>(sql`
    select
      (b->>'rate')::numeric(5, 2)::text as rate,
      sum((b->>'base')::numeric(12, 2))::numeric(12, 2)::text as base,
      sum((b->>'tax')::numeric(12, 2))::numeric(12, 2)::text as tax
    from sales s
    cross join lateral jsonb_array_elements(s.vat_breakdown) as b
    where s.tenant_id = ${scope.tenantId}
      ${nodeClause}
      and ${scope.dateFilter}
      and ${activeSalesClause({ tenantId: scope.tenantId })}
    group by (b->>'rate')::numeric(5, 2)::text
  `);

  // One row per rate already (grouped in SQL); build VatRateLine[] straight from the filed figures,
  // sorted numerically (compareDecimal, not the SQL text order — 4.00 must precede 21.00).
  const lines = rows
    .map((r) => ({ rate: decimal(r.rate), base: decimal(r.base), tax: decimal(r.tax) }))
    .sort((a, b) => compareDecimal(a.rate, b.rate));

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
 * VAT summary for one (tenant, node) over one business day, anchored on issuance. Delegates to the
 * shared `aggregateVatByRate` core with the daily-close's `= businessDay` date filter, so its suite is
 * the behaviour-preserving guard for the extraction.
 */
export async function computeVatSummary(
  tx: Transaction,
  input: DailyCloseInput,
): Promise<VatSummary> {
  return aggregateVatByRate(tx, {
    tenantId: input.tenantId,
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
  validateBusinessDay(input.fromBusinessDay);
  validateBusinessDay(input.toBusinessDay);
  // String compare is correct for the fixed "YYYY-MM-DD" shape the validators enforce.
  if (input.fromBusinessDay > input.toBusinessDay) {
    throw new Error(
      `reporting: fromBusinessDay must be on or before toBusinessDay: ${JSON.stringify(input.fromBusinessDay)} > ${JSON.stringify(input.toBusinessDay)}`,
    );
  }
  return aggregateVatByRate(tx, {
    tenantId: input.tenantId,
    nodeId: input.nodeId,
    dateFilter: businessDayRangeClause(sql`s.issued_at`, input),
  });
}
