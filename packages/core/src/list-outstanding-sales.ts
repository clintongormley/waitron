import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import {
  addDecimal,
  centsToDecimal,
  saleId as brandSaleId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Decimal, SaleId, TillId } from "@waitron/shared";

/**
 * A sale issued (invoice printed, chained, filed) but not yet paid — the answer to "what is owed?"
 * under invoice-first. `amountDue` is the printed `total` net of every corrective invoice that corrects
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
 * Lists the outstanding sales: ordinary sales (`corrects_sale_id` NULL) that are neither an F3
 * canje substitute (already paid via their tickets — AEAT "no cobrar dos veces"), settled, nor
 * voided. This is a plain read over the database's one taxpayer.
 */
export async function listOutstandingSales(tx: Transaction): Promise<OutstandingSale[]> {
  // `sales.total` counts whole cents, so both money expressions below return cents and
  // `centsToDecimal` is the one conversion, in the mapping under this query. Neither may be cast
  // to `numeric(12, 2)::text`: that renders a count of 7734 cents as "7734.00", a plausible string
  // a hundred times the amount, and nothing fails (measured on PGlite 0.5.8, 2026-09-20). The sum
  // is cast back to `int` so it arrives as a number, exactly as `invoice_number` alongside it does.
  const result = await tx.execute<{
    sale_id: string;
    invoice_number: number;
    issued_at: string;
    till_id: string;
    total: number;
    correction_total: number;
  }>(sql`
    select
      s.id             as sale_id,
      s.invoice_number as invoice_number,
      s.issued_at::text as issued_at,
      s.till_id        as till_id,
      s.total          as total,
      coalesce((select sum(c.total) from sales c where c.corrects_sale_id = s.id), 0)::int
        as correction_total
    from sales s
    where s.corrects_sale_id is null
      and not exists (select 1 from sale_settlements ss where ss.sale_id = s.id)
      and not exists (select 1 from sale_voids sv where sv.sale_id = s.id)
      and not exists (select 1 from sale_substitutions sub where sub.substitution_sale_id = s.id)
    order by s.issued_at, s.invoice_number
  `);

  return result.rows.map((r) => {
    const total = centsToDecimal(r.total);
    const correctionTotal = centsToDecimal(r.correction_total);
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
