import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { addDecimal, compareDecimal, decimal } from "@waitron/shared";
import { activeSalesClause, businessDayClause } from "./business-day.js";
import type { DailyCloseInput, VatSummary } from "./types.js";

/**
 * VAT summary for one (tenant, node) over one business day, anchored on issuance. Reads the filed
 * per-rate desglose from `sales.vat_breakdown` — the exact cuota AEAT received,
 * whichever method (direct or difference) filed it — by unnesting the jsonb array and summing base
 * and tax per rate. Corrections (negative breakdowns) net in for free; voided sales and F3-canje
 * substitutes are excluded. The explicit tenant/node predicates are belt-and-suspenders over RLS
 * (mirrors listOutstandingSales).
 */
export async function computeVatSummary(
  tx: Transaction,
  input: DailyCloseInput,
): Promise<VatSummary> {
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
    where s.tenant_id = ${input.tenantId}
      and s.node_id = ${input.nodeId}
      and ${businessDayClause(sql`s.issued_at`, input)}
      and ${activeSalesClause(input)}
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
