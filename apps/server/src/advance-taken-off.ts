import "./errors.js";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { invoiceSeries, saleLines, sales, type Transaction } from "@waitron/db";
import { formatInvoiceNumber } from "@waitron/core";
import { AppError, saleId as brandSaleId, type ErrorParams } from "@waitron/shared";
import { readInvoiceNumber } from "./working-order.js";

/** The invoice that took an advance off. */
export interface TakenOffBy {
  saleId: string;
  invoiceNumber: string;
}

/**
 * The invoice that took each of the advances `advanceSaleIds` off, by advance: a sale of its own
 * (not a corrective) with a line deducting it. A credit note or replacement copies that line but
 * corrects a sale, so it is never the one named; an advance no invoice took off is absent.
 */
export async function advancesTakenOff(
  tx: Transaction,
  advanceSaleIds: readonly string[],
): Promise<Map<string, TakenOffBy>> {
  const takenOff = new Map<string, TakenOffBy>();
  if (advanceSaleIds.length === 0) return takenOff;
  const rows = await tx
    .select({
      advanceId: saleLines.deductsSaleId,
      id: sales.id,
      code: invoiceSeries.code,
      number: sales.invoiceNumber,
    })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(and(inArray(saleLines.deductsSaleId, [...advanceSaleIds]), isNull(sales.correctsSaleId)))
    .orderBy(sales.issuedAt, sales.invoiceNumber);
  for (const row of rows)
    if (!takenOff.has(row.advanceId!))
      takenOff.set(row.advanceId!, {
        saleId: row.id,
        invoiceNumber: formatInvoiceNumber(row.code, row.number),
      });
  return takenOff;
}

/**
 * Refuses `advance.taken_off_final_invoice` once an invoice has taken the advance `saleId` off
 * ({@link advancesTakenOff}). A whole credit of that invoice leaves the refusal in place.
 */
export async function refuseTakenOffAdvance(tx: Transaction, saleId: string): Promise<void> {
  const final = (await advancesTakenOff(tx, [saleId])).get(saleId);
  if (final === undefined) return;
  throw new AppError("advance.taken_off_final_invoice", {
    saleId,
    finalSaleId: final.saleId,
    invoiceNumber: final.invoiceNumber,
  });
}

type AdvanceRefundCode = "tender.refund_of_advance" | "bill.refund_of_advance";

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
