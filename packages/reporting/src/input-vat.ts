import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import {
  addDecimal,
  compareDecimal,
  decimal,
  rawBasisPointsToDecimal,
  rawCentsToDecimal,
} from "@waitron/shared";
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
 * deductible_proportion/10000)` — the divisor is ten thousand because the column counts whole BASIS
 * POINTS, so a full proportion is 10000 — rounded PER invoice line, then summed, never re-rounded on
 * the monthly base. That is the same "sum the filed per-invoice cuotas, never `round(Σ base × rate)`"
 * exactness rule the output side follows (#76/#66); with the default full proportion it collapses to
 * `Σ` of the filed cuotas verbatim. It spans every node in the database: one tenant per database, so no tenant
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

  // `purchase_invoice_vat.base` and `.tax` count whole cents, and `deductible_proportion` counts
  // whole basis points — 10000 of them is the whole of the tax. The divisor below moved from 100
  // to 10000 with the scale, so the product is the same numeric count of cents with a fraction it
  // was before, and every amount this reports is the amount it reported before. The rounding goes
  // to 0 decimal places of CENTS — the same granularity (one cent) and the same rule (Postgres
  // `round(numeric, …)` is half away from zero, matching `@waitron/shared`'s `percentOf`). It is
  // still rounded PER invoice line and only then summed, which is the per-invoice exactness rule
  // the output side follows.
  //
  // The proportion is cast `::numeric` because it is an `integer` column now: `bigint * integer`
  // is a `bigint`, and dividing that by 10000 would TRUNCATE rather than leave a fraction for
  // `round` to decide. The cast is what keeps the whole expression in numeric arithmetic, as it
  // was when the column itself was a `numeric`.
  //
  // Each sum is a count of whole cents read raw, cast `::text` and converted by
  // `rawCentsToDecimal` — see its doc comment. `round(numeric, 0)` renders no decimal point, so
  // the tax sum's text is a plain integer like the base's (measured on both engines, 2026-09-20).
  //
  // The rate is grouped on the column itself. The `numeric(5,2)` cast this replaced was there so
  // that two spellings of one rate could not split into two lines; a whole number of basis points
  // has one spelling, so there is nothing left to normalise — the normalisation moved to
  // `decimalToBasisPoints` on the way in. The output side still reads its rate out of a jsonb
  // document, where two spellings ARE possible, so `aggregateVatByRate` keeps its cast.
  const { rows } = await tx.execute<{
    rate: string;
    kind: PurchaseVatKind;
    base: string;
    tax: string;
  }>(sql`
    select
      v.rate::text as rate,
      v.kind as kind,
      sum(v.base)::text as base,
      sum(round(v.tax * p.deductible_proportion::numeric / 10000, 0))::text as tax
    from purchase_invoice_vat v
    join purchase_invoices p on p.id = v.purchase_invoice_id
    where p.regime = 'general'
      and ${dateFilter}
    group by v.rate, v.kind
  `);

  const lines: InputVatRateLine[] = rows
    .map((r) => ({
      rate: rawBasisPointsToDecimal(r.rate),
      base: rawCentsToDecimal(r.base),
      tax: rawCentsToDecimal(r.tax),
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
