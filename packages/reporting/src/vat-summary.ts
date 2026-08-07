import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { addDecimal, compareDecimal, decimal } from "@waitron/shared";
import { activeSalesClause, businessDayClause } from "./business-day.js";
import type { DailyCloseInput, VatSummary } from "./types.js";

/**
 * VAT summary for one (tenant, node) over one business day, anchored on issuance. Reads the filed
 * per-rate desglose from `sales.vat_breakdown` (migration 0031) — the exact cuota AEAT received,
 * whichever method (direct or difference) filed it — by unnesting the jsonb array and summing base
 * and tax per rate. Corrections (negative breakdowns) net in for free; voided sales and F3-canje
 * substitutes are excluded. The explicit tenant/node predicates are belt-and-suspenders over RLS
 * (mirrors listOutstandingSales).
 */
export async function computeVatSummary(
  tx: Transaction,
  input: DailyCloseInput,
): Promise<VatSummary> {
  const { rows } = await tx.execute<{ rate: string; base: string; tax: string }>(sql`
    select
      b->>'rate' as rate,
      sum((b->>'base')::numeric(12, 2))::numeric(12, 2)::text as base,
      sum((b->>'tax')::numeric(12, 2))::numeric(12, 2)::text as tax
    from sales s
    cross join lateral jsonb_array_elements(s.vat_breakdown) as b
    where s.tenant_id = ${input.tenantId}
      and s.node_id = ${input.nodeId}
      and ${businessDayClause(sql`s.issued_at`, input)}
      and ${activeSalesClause(input)}
    group by b->>'rate'
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
