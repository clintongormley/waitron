import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import {
  MONEY_SCALE,
  addDecimal,
  compareDecimal,
  decimal,
  divideDecimal,
  multiplyDecimal,
} from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { activeSalesClause, businessDayClause } from "./business-day.js";
import type { DailyCloseInput, VatSummary } from "./types.js";

/**
 * `ratePercent`% of `base` (the VAT tax amount — the fiscal *cuota*), exact, half away from zero at
 * money scale. Identical composition to `@waitron/core`'s `percentOf` (packages/core/src/vat.ts) —
 * kept local so reporting depends only on db + shared, not the write layer. It reuses the same rounding
 * primitive (`divideDecimal`) as `buildVatBreakdown`, applied at the per-`(invoice, rate)` grain (the
 * `group by s.id, sl.vat_rate` below, §4).
 *
 * CAVEAT (2026-08-05, feat/catalogue-model): this MULTIPLICATIVE recompute (`base × rate`) reproduces
 * the filed cuota ONLY for a sale filed via `buildVatBreakdown` (its default). A gross-inclusive
 * catalogue sale files its cuota by the DIFFERENCE method (`gross − base`, `@waitron/catalogue`'s
 * `priceBasket` → `recordSale`'s supplied `vatBreakdown`), which can differ by a rounding céntimo per
 * (invoice, rate) group — so for such sales this daily VAT summary does NOT equal the filed
 * per-invoice cuotas. The filed difference-method desglose is not persisted queryably (it lives only
 * inside the hash-chained `registros_facturacion`; the per-rate *gross* is not stored, only the
 * per-rate base via `sale_lines.line_total`), so reporting cannot yet recompute it. Closing this needs
 * the filed desglose persisted and read here — tracked in docs/backlog.md. Not reachable until the
 * till (#7) rings catalogue sales; no such sale exists today. Named in English (not `cuotaOf`) so this
 * generic package stays inside the english-only guard.
 */
function taxOf(base: Decimal, ratePercent: Decimal): Decimal {
  return divideDecimal(multiplyDecimal(base, ratePercent), "100" as Decimal, MONEY_SCALE);
}

/**
 * VAT summary for one (tenant, node) over one business day, anchored on issuance. Reads `sale_lines`
 * joined to `sales`; groups by (sale, rate) so the tax (cuota) is rounded PER INVOICE and then summed
 * (design §4). Corrections (negative lines) net in for free; voided sales and F3-canje substitutes are
 * excluded. The explicit tenant/node predicates are belt-and-suspenders over RLS (mirrors
 * listOutstandingSales).
 */
export async function computeVatSummary(
  tx: Transaction,
  input: DailyCloseInput,
): Promise<VatSummary> {
  const { rows } = await tx.execute<{ rate: string; base: string }>(sql`
    select
      sl.vat_rate::text as rate,
      sum(sl.line_total)::numeric(12, 2)::text as base
    from sales s
    join sale_lines sl on sl.sale_id = s.id and sl.tenant_id = ${input.tenantId}
    where s.tenant_id = ${input.tenantId}
      and s.node_id = ${input.nodeId}
      and ${businessDayClause(sql`s.issued_at`, input)}
      and ${activeSalesClause(input)}
    group by s.id, sl.vat_rate
  `);

  // Per (sale, rate) rows → tax per row (per-invoice rounding) → accumulate by rate.
  const byRate = new Map<string, { rate: Decimal; base: Decimal; tax: Decimal }>();
  let baseTotal = decimal("0.00");
  let taxTotal = decimal("0.00");
  for (const r of rows) {
    const rate = decimal(r.rate);
    const base = decimal(r.base);
    const tax = taxOf(base, rate);
    const acc = byRate.get(r.rate);
    if (acc === undefined) {
      byRate.set(r.rate, { rate, base, tax });
    } else {
      acc.base = addDecimal(acc.base, base);
      acc.tax = addDecimal(acc.tax, tax);
    }
    baseTotal = addDecimal(baseTotal, base);
    taxTotal = addDecimal(taxTotal, tax);
  }

  // The map values are already exactly VatRateLine; return them sorted, no rebuild.
  const lines = [...byRate.values()].sort((a, b) => compareDecimal(a.rate, b.rate));
  return {
    byRate: lines,
    baseTotal,
    taxTotal,
    grossTotal: addDecimal(baseTotal, taxTotal),
  };
}
