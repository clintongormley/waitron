import "./errors.js";
import { and, eq, isNull } from "drizzle-orm";
import { invoiceSeries, saleLines, sales, type Transaction } from "@waitron/db";
import { formatInvoiceNumber } from "@waitron/core";
import { AppError } from "@waitron/shared";

/**
 * Refuses `advance.taken_off_final_invoice` once an invoice has taken the advance `saleId` off: a
 * sale of its own (not a corrective) has a line deducting it. A whole credit of that invoice
 * leaves the refusal in place.
 */
export async function refuseTakenOffAdvance(tx: Transaction, saleId: string): Promise<void> {
  const [final] = await tx
    .select({ id: sales.id, code: invoiceSeries.code, number: sales.invoiceNumber })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(and(eq(saleLines.deductsSaleId, saleId), isNull(sales.correctsSaleId)))
    .limit(1);
  if (final === undefined) return;
  throw new AppError("advance.taken_off_final_invoice", {
    saleId,
    finalSaleId: final.id,
    invoiceNumber: formatInvoiceNumber(final.code, final.number),
  });
}
