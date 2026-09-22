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
  // whole basis points — 10000 of them is the whole of the tax. The rounding goes to whole CENTS,
  // half away from zero, PER invoice line and only then summed, which is the per-invoice exactness
  // rule the output side follows.
  //
  // WHY THE EXPRESSION LOOKS LIKE THAT. It was `round(v.tax * p.deductible_proportion::numeric /
  // 10000, 0)`. This engine has no exact decimal type: `/ 10000` between two integers is INTEGER
  // division, which truncates, and `/ 10000.0` is binary floating point, whose `round` then answers
  // a REAL — and a real read back as text renders `"0.0"`, which `rawCentsToDecimal` refuses
  // outright. So the whole thing is done in integers: `(abs(x) + 5000) / 10000` is half-up on the
  // MAGNITUDE, and multiplying the sign back on makes that half away from zero, matching
  // PostgreSQL's `round(numeric, 0)` and `@waitron/shared`'s `percentOf`. A rectificativa's negative
  // cuota is the reason the sign cannot be dropped.
  //
  // Measured against PGlite 0.5.8 (PostgreSQL 18.3), 2026-09-22: 220 (tax, proportion) pairs — 22
  // cuotas including zero, negatives and every exact-tie magnitude × 10 proportions including 0,
  // 10000 and three that land on a tie — compared with `round(t * p::numeric / 10000, 0)::text`.
  // The integer form above agreed on 220 of 220. The floating form disagreed on 220 of 220, which
  // is the control in the other direction, and it is not a near miss: every answer carried a
  // decimal point the reader would have thrown on.
  //
  // Each sum is a count of whole cents read raw, handed over as TEXT by `cast(… as text)` — what
  // `::text` was — and converted by `rawCentsToDecimal`; see its doc comment.
  //
  // The rate is grouped on the column itself. The `numeric(5,2)` cast this replaced was there so
  // that two spellings of one rate could not split into two lines; a whole number of basis points
  // has one spelling, so there is nothing left to normalise — the normalisation moved to
  // `decimalToBasisPoints` on the way in. The output side still reads its rate out of a JSON
  // document, where two spellings ARE possible, so `aggregateVatByRate` keeps normalising.
  const { rows } = await tx.execute<{
    rate: string;
    kind: PurchaseVatKind;
    base: string;
    tax: string;
  }>(sql`
    select
      cast(v.rate as text) as rate,
      v.kind as kind,
      cast(sum(v.base) as text) as base,
      cast(sum(
        (abs(v.tax * p.deductible_proportion) + 5000) / 10000
          * sign(v.tax * p.deductible_proportion)
      ) as text) as tax
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
