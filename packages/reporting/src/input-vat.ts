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
 * (month/quarter/year), across ALL nodes — the input-side counterpart to `computeVatReturn`. Reads
 * `purchase_invoice_vat` joined to its `purchase_invoices` header, `regime = 'general'` only
 * (recargo de equivalencia is not deductible and not on the 303), bucketed by the civil
 * `received_on` date, grouped by (rate, kind).
 *
 * `base` is summed in full; the deductible `tax` is `Σ round(filed cuota × deductible_proportion /
 * 10000)`, rounded PER invoice line and then summed, never re-rounded on the period's base — the
 * exactness rule the output side follows. With the default full proportion it is the sum of the
 * filed cuotas.
 *
 * Every (rate, kind) line is returned; `mapModelo303` splits casillas 28/29 (corrientes) from 30/31
 * (bienes de inversión) by `kind`.
 */
export async function computeInputVat(
  tx: Transaction,
  input: InputVatInput,
): Promise<InputVatReturn> {
  validatePeriod(input.year, input.period);

  const dateFilter = periodDateFilter(sql`p.received_on`, input.year, input.period);

  // `base` and `tax` count whole cents and `deductible_proportion` whole basis points (10000 is the
  // whole tax). This engine has no exact decimal type: `/ 10000` between integers truncates, and
  // `/ 10000.0` is floating point, whose result `rawCentsToDecimal` refuses. So the rounding is done
  // in integers: `(abs(x) + 5000) / 10000` rounds the magnitude half up, and the sign multiplied
  // back makes it half away from zero, as `percentOf` rounds. A rectificativa's negative cuota is
  // why the sign cannot be dropped.
  //
  // The rate is grouped on the column itself: a count of basis points has one spelling.
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
