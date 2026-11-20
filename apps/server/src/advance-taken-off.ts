import "./errors.js";
import { and, eq, isNull } from "drizzle-orm";
import { invoiceSeries, saleLines, sales, type Transaction } from "@waitron/db";
import { formatInvoiceNumber } from "@waitron/core";
import { AppError, saleId as brandSaleId, type ErrorParams } from "@waitron/shared";
import { readInvoiceNumber } from "./working-order.js";

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

type AdvanceRefundCode = "tender.refund_of_advance" | "bill.payment_has_ticket";

/**
 * Refuses a refund of the advance `saleId`'s money: {@link refuseTakenOffAdvance}'s refusal once an
 * invoice took the advance off, else `code`, naming the advance and its invoice number.
 */
export async function refuseAdvanceRefund<C extends AdvanceRefundCode>(
  tx: Transaction,
  saleId: string,
  code: C,
  params: Omit<ErrorParams[C], "saleId" | "invoiceNumber">,
): Promise<never> {
  await refuseTakenOffAdvance(tx, saleId);
  const invoiceNumber = await readInvoiceNumber(tx, brandSaleId(saleId));
  throw new AppError<AdvanceRefundCode>(code, {
    ...params,
    saleId,
    invoiceNumber,
  } as ErrorParams[C]);
}
