import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import {
  addDecimal,
  rawCentsToDecimal,
  saleId as brandSaleId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Decimal, SaleId, TillId } from "@waitron/shared";

/**
 * A sale issued (invoice printed, chained, filed) but not yet paid. `amountDue` is the printed
 * `total` net of every corrective invoice: a "take a fiver off" shows 65.00 against a 70.00 total.
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
 * The outstanding sales: ordinary sales (`corrects_sale_id` null) that are not settled, not voided
 * and not an F3, which was paid through the tickets it replaces.
 */
export async function listOutstandingSales(tx: Transaction): Promise<OutstandingSale[]> {
  // The money expressions are whole cents cast to text for `rawCentsToDecimal` (see its doc
  // comment). `issued_at` is already a text column on this engine.
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
      s.issued_at      as issued_at,
      s.till_id        as till_id,
      cast(s.total as text) as total,
      cast(coalesce((select sum(c.total) from sales c where c.corrects_sale_id = s.id), 0) as text)
        as correction_total
    from sales s
    where s.corrects_sale_id is null
      and not exists (select 1 from sale_settlements ss where ss.sale_id = s.id)
      and not exists (select 1 from sale_voids sv where sv.sale_id = s.id)
      and not exists (select 1 from sale_substitutions sub where sub.substitution_sale_id = s.id)
    order by s.issued_at, s.invoice_number
  `);

  return result.rows.map((r) => {
    const total = rawCentsToDecimal(r.total);
    const correctionTotal = rawCentsToDecimal(r.correction_total);
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
