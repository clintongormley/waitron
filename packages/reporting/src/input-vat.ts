import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { addDecimal, centsToDecimal, compareDecimal, decimal } from "@waitron/shared";
import { periodDateFilter, validatePeriod, type LiquidationPeriod } from "./period.js";
import type { InputVatRateLine, InputVatReturn, PurchaseVatKind } from "./types.js";

/** The obligado is the database's one taxpayer, so this aggregates ALL nodes of the legal entity with
 * no node predicate, like the output side — it takes only the period to report on. */
export interface InputVatInput {
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
 * filed cuotas verbatim. It spans every node in the database: one tenant per database, so no tenant
 * predicate is needed (mirrors `aggregateVatByRate`).
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

  // `purchase_invoice_vat.base` and `.tax` count whole cents; `deductible_proportion` is a
  // `numeric(5, 2)` percentage and did NOT move, so the product below is a numeric count of cents
  // with a fraction, and the rounding that used to go to 2 decimal places of EUROS now goes to 0
  // decimal places of CENTS — the same granularity (one cent) and the same rule (Postgres
  // `round(numeric, …)` is half away from zero, matching `@waitron/shared`'s `percentOf`), so every
  // amount this reports is the amount it reported before. It is still rounded PER invoice line and
  // only then summed, which is the per-invoice exactness rule the output side follows.
  //
  // `::int` on each sum keeps it in the width the money column itself has and hands it back as a
  // number; `centsToDecimal` below is the one conversion to an amount. A `numeric(12, 2)` cast
  // would print 4198 cents as "4198.00", a plausible figure a hundred times the cuota.
  //
  // The rate is grouped as `numeric(5,2)::text` so two spellings of one rate cannot split into two
  // lines (defensive; production rates are already 2-dp literals), exactly as `aggregateVatByRate`
  // does on the output side.
  const { rows } = await tx.execute<{
    rate: string;
    kind: PurchaseVatKind;
    base: number;
    tax: number;
  }>(sql`
    select
      (v.rate)::numeric(5, 2)::text as rate,
      v.kind as kind,
      sum(v.base)::int as base,
      sum(round(v.tax * p.deductible_proportion / 100, 0))::int as tax
    from purchase_invoice_vat v
    join purchase_invoices p on p.id = v.purchase_invoice_id
    where p.regime = 'general'
      and ${dateFilter}
    group by (v.rate)::numeric(5, 2)::text, v.kind
  `);

  const lines: InputVatRateLine[] = rows
    .map((r) => ({
      rate: decimal(r.rate),
      base: centsToDecimal(r.base),
      tax: centsToDecimal(r.tax),
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
    year: input.year,
    period: input.period,
    byRate: lines,
    baseTotal,
    taxTotal,
  };
}
