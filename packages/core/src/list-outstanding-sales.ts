import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { addDecimal, decimal, saleId as brandSaleId, tillId as brandTillId } from "@waitron/shared";
import type { Decimal, SaleId, TenantId, TillId } from "@waitron/shared";

/**
 * A sale issued (invoice printed, chained, filed) but not yet paid — the answer to "what is owed?"
 * under invoice-first. `amountDue` is the printed `total` net of every rectificativa that corrects
 * it; a "take a fiver off" shows here as 65.00 against a 70.00 total (design §3).
 */
export interface OutstandingSale {
  saleId: SaleId;
  invoiceNumber: number;
  issuedAt: string;
  tillId: TillId;
  /** The printed invoice total. */
  total: Decimal;
  /** Signed sum of correctives; "0.00" when none. */
  correctionTotal: Decimal;
  /** total + correctionTotal — what a consumer would collect. */
  amountDue: Decimal;
}

/**
 * Lists a tenant's outstanding sales: ordinary altas (corrects_sale_id NULL) that are neither an F3
 * canje substitute (already paid via their tickets — AEAT "no cobrar dos veces"), settled, nor
 * voided. RLS scopes every table reference to the tenant; the explicit tenant predicate on the outer
 * query AND on each subquery (the corrective sum and the three `not exists` existence checks) is
 * belt-and-suspenders — redundant under RLS and under the composite tenant-consistent FKs, but
 * guarding a non-scoped connection too (mirrors recordCorrection and settleSale). No SECURITY
 * DEFINER — a plain read.
 */
export async function listOutstandingSales(
  tx: Transaction,
  tenantId: TenantId,
): Promise<OutstandingSale[]> {
  const result = await tx.execute<{
    sale_id: string;
    invoice_number: number;
    issued_at: string;
    till_id: string;
    total: string;
    correction_total: string;
  }>(sql`
    select
      s.id             as sale_id,
      s.invoice_number as invoice_number,
      s.issued_at::text as issued_at,
      s.till_id        as till_id,
      s.total::text    as total,
      coalesce((select sum(c.total) from sales c where c.corrects_sale_id = s.id and c.tenant_id = ${tenantId}), 0)::numeric(12, 2)::text
        as correction_total
    from sales s
    where s.tenant_id = ${tenantId}
      and s.corrects_sale_id is null
      and not exists (select 1 from sale_settlements ss where ss.sale_id = s.id and ss.tenant_id = ${tenantId})
      and not exists (select 1 from sale_voids sv where sv.sale_id = s.id and sv.tenant_id = ${tenantId})
      and not exists (select 1 from sale_substitutions sub where sub.substitution_sale_id = s.id and sub.tenant_id = ${tenantId})
    order by s.issued_at, s.invoice_number
  `);

  return result.rows.map((r) => {
    const total = decimal(r.total);
    const correctionTotal = decimal(r.correction_total);
    return {
      saleId: brandSaleId(r.sale_id),
      invoiceNumber: r.invoice_number,
      issuedAt: r.issued_at,
      tillId: brandTillId(r.till_id),
      total,
      correctionTotal,
      amountDue: addDecimal(total, correctionTotal),
    };
  });
}
