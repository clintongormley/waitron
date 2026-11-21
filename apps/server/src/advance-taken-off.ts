import "./errors.js";
import { and, eq, isNull } from "drizzle-orm";
import { invoiceCorrections, invoiceSeries, saleLines, sales, type Transaction } from "@waitron/db";
import { formatInvoiceNumber, readCorrectableLines } from "@waitron/core";
import type { FiscalBackend } from "@waitron/fiscal";
import {
  AppError,
  basisPointsToDecimal,
  compareDecimal,
  decimal,
  saleId as brandSaleId,
  sumDecimals,
  type ErrorParams,
  type NodeId,
} from "@waitron/shared";
import { readRefundableTenders } from "./tender-refund-balance.js";
import { readInvoiceNumber } from "./working-order.js";

/** The invoice that took the advance `saleId` off: a sale of its own (not a corrective) with a
 * line deducting it. */
async function readTakingInvoice(tx: Transaction, saleId: string) {
  const [final] = await tx
    .select({
      id: sales.id,
      code: invoiceSeries.code,
      number: sales.invoiceNumber,
      issuedAt: sales.issuedAt,
      deductionLineId: saleLines.id,
    })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(and(eq(saleLines.deductsSaleId, saleId), isNull(sales.correctsSaleId)))
    .limit(1);
  return final;
}

function takenOffParams(saleId: string, final: { id: string; code: string; number: number }) {
  return {
    saleId,
    finalSaleId: final.id,
    invoiceNumber: formatInvoiceNumber(final.code, final.number),
  };
}

/**
 * Refuses `advance.taken_off_final_invoice` once an invoice has taken the advance `saleId` off: a
 * sale of its own (not a corrective) has a line deducting it. A whole credit of that invoice
 * leaves the refusal in place.
 */
export async function refuseTakenOffAdvance(tx: Transaction, saleId: string): Promise<void> {
  const final = await readTakingInvoice(tx, saleId);
  if (final === undefined) return;
  throw new AppError("advance.taken_off_final_invoice", takenOffParams(saleId, final));
}

/**
 * Refuses `advance.taken_off_final_invoice` for a leg of the correction `correctionId` of the
 * advance `saleId` when that correction was opened before the invoice that took the advance off
 * was issued: that invoice took the advance off whole, so the correction's money is already on it.
 */
export async function refuseTakenOffSinceOpened(
  tx: Transaction,
  saleId: string,
  correctionId: string,
): Promise<void> {
  const final = await readTakingInvoice(tx, saleId);
  if (final === undefined) return;
  const [correction] = await tx
    .select({ openedAt: invoiceCorrections.createdAt })
    .from(invoiceCorrections)
    .where(eq(invoiceCorrections.id, correctionId));
  if (correction !== undefined && Date.parse(correction.openedAt) >= Date.parse(final.issuedAt))
    return;
  throw new AppError("advance.taken_off_final_invoice", takenOffParams(saleId, final));
}

/**
 * Refuses `advance.final_invoice_first` once an invoice has taken the advance `saleId` off, while
 * that invoice can still give back money for a dish at the advance's rate: `moneyLeft` is the
 * smaller of what is left of its dishes at that rate and the money still refundable on it. A whole
 * credit of that invoice leaves it nothing, and its correctable lines are then unreadable.
 */
export async function refuseFinalInvoiceFirst(
  tx: Transaction,
  backend: FiscalBackend,
  nodeId: NodeId,
  saleId: string,
): Promise<void> {
  const final = await readTakingInvoice(tx, saleId);
  if (final === undefined) return;
  const [credit] = await tx
    .select({ id: saleLines.id })
    .from(saleLines)
    .where(eq(saleLines.correctsLineId, final.deductionLineId))
    .limit(1);
  if (credit !== undefined) return;
  const [own] = await tx
    .select({ rate: saleLines.vatRate })
    .from(saleLines)
    .where(and(eq(saleLines.saleId, saleId), eq(saleLines.advanceRole, "payment_on_account")));
  const rate = basisPointsToDecimal(own!.rate);
  const lines = await readCorrectableLines(tx, backend, brandSaleId(final.id), nodeId);
  const dishes = sumDecimals([
    decimal("0.00"),
    ...lines.filter((line) => compareDecimal(line.rate, rate) === 0).map((line) => line.left),
  ]);
  const money = sumDecimals([
    decimal("0.00"),
    ...(await readRefundableTenders(tx, final.id)).map((row) => decimal(row.appliedRemaining)),
  ]);
  const moneyLeft = compareDecimal(dishes, money) < 0 ? dishes : money;
  if (compareDecimal(moneyLeft, decimal("0.00")) <= 0) return;
  throw new AppError("advance.final_invoice_first", {
    ...takenOffParams(saleId, final),
    rate,
    moneyLeft,
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
