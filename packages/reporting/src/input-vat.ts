import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { TenantId } from "@waitron/shared";
import { addDecimal, compareDecimal, decimal } from "@waitron/shared";
import { periodDateFilter, validatePeriod, type LiquidationPeriod } from "./period.js";
import type { InputVatRateLine, InputVatReturn, PurchaseVatKind } from "./types.js";

export interface InputVatInput {
  /** The obligado — aggregates ALL nodes of the legal entity (no node predicate), like the output side. */
  tenantId: TenantId;
  /** Civil calendar year of the liquidation period. */
  year: number;
  /** The liquidation period (month/quarter/year); the deduction window over `received_on`. */
  period: LiquidationPeriod;
}

// ordinary (corrientes, casilla 28/29) before capital (bienes de inversión, casilla 30/31) — the
// casilla order, not alphabetical ('capital' < 'ordinary' would invert it).
const KIND_ORDER: Record<PurchaseVatKind, number> = { ordinary: 0, capital: 1 };

/**
 * The modelo 303 input-VAT (*IVA deducible/soportado*) aggregate over one liquidation period
 * (month/quarter/year), for one obligado (tenant), across ALL nodes — the input-side counterpart to
 * `computeVatReturn`. Reads `purchase_invoice_vat` joined to its `purchase_invoices` header, filtered
 * to `regime = 'general'` (recargo de equivalencia is non-deductible and off the 303, spec §D4),
 * bucketed by `received_on` civil date in the period (the deduction period, spec §D3), grouped by
 * (rate, kind).
 *
 * `base` is summed in full; the deductible `tax` (cuota) is `Σ round(filed cuota ×
 * deductible_proportion/100)` — rounded PER invoice line, then summed, never re-rounded on the monthly
 * base. That is the same "sum the filed per-invoice cuotas, never `round(Σ base × rate)`" exactness
 * rule the output side follows (#76/#66); with the default proportion 100 it collapses to `Σ` of the
 * filed cuotas verbatim. The explicit `p.tenant_id` predicate scopes the query to the requested
 * tenant across all its nodes (mirrors `aggregateVatByRate`).
 *
 * The result carries every (rate, kind) line UNFILTERED — the casilla 28/29 (corrientes) vs 30/31
 * (bienes de inversión) split is applied DOWNSTREAM in `mapModelo303`, which sums `deductible.byRate`
 * by `kind`; this aggregate deliberately does not pre-filter to one kind.
 */
export async function computeInputVat(
  tx: Transaction,
  input: InputVatInput,
): Promise<InputVatReturn> {
  // Caller preconditions validated BEFORE any query (plain Error, shared with computeVatReturn).
  validatePeriod(input.year, input.period);

  const dateFilter = periodDateFilter(sql`p.received_on`, input.year, input.period);

  // The deductible cuota is rounded (half away from zero, Postgres `round(numeric, 2)`) PER invoice
  // line before summing — matching `@waitron/shared`'s `percentOf` rounding and the per-invoice
  // exactness rule. The rate is grouped as `numeric(5,2)::text` so two spellings of one rate cannot
  // split into two lines (defensive; production rates are already 2-dp literals), exactly as
  // `aggregateVatByRate` does on the output side.
  const { rows } = await tx.execute<{
    rate: string;
    kind: PurchaseVatKind;
    base: string;
    tax: string;
  }>(sql`
    select
      (v.rate)::numeric(5, 2)::text as rate,
      v.kind as kind,
      sum(v.base)::numeric(12, 2)::text as base,
      sum(round(v.tax * p.deductible_proportion / 100, 2))::numeric(12, 2)::text as tax
    from purchase_invoice_vat v
    join purchase_invoices p on p.id = v.purchase_invoice_id
    where p.tenant_id = ${input.tenantId}
      and p.regime = 'general'
      and ${dateFilter}
    group by (v.rate)::numeric(5, 2)::text, v.kind
  `);

  const lines: InputVatRateLine[] = rows
    .map((r) => ({
      rate: decimal(r.rate),
      base: decimal(r.base),
      tax: decimal(r.tax),
      kind: r.kind,
    }))
    .sort((a, b) => {
      const byRate = compareDecimal(a.rate, b.rate);
      return byRate !== 0 ? byRate : KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    });

  let baseTotal = decimal("0.00");
  let taxTotal = decimal("0.00");
  for (const line of lines) {
    baseTotal = addDecimal(baseTotal, line.base);
    taxTotal = addDecimal(taxTotal, line.tax);
  }

  return {
    tenantId: input.tenantId,
    year: input.year,
    period: input.period,
    byRate: lines,
    baseTotal,
    taxTotal,
  };
}
