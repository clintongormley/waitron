import "./errors.js";
import { and, eq, inArray, isNotNull, isNull, notExists } from "drizzle-orm";
import {
  invoiceSeries,
  saleLines,
  sales,
  saleSettlements,
  saleSubstitutions,
  saleVoids,
  type Transaction,
} from "@waitron/db";
import { SQL_VARIABLE_LIMIT } from "@waitron/store";
import { formatInvoiceNumber } from "@waitron/core";
import {
  AppError,
  compareDecimal,
  decimal,
  saleId as brandSaleId,
  sumDecimals,
  type ErrorParams,
} from "@waitron/shared";
import { paidOnIssuedBill } from "./bill-payments.js";
import { readRefundableTenders } from "./tender-refund-balance.js";
import { readInvoiceNumber, readInvoiceNumbers } from "./stored-order-lines.js";

const ZERO = decimal("0.00");

/** The invoice that took an advance off. */
export interface TakenOffBy {
  saleId: string;
  invoiceNumber: string;
}

/**
 * The invoice that took each of the advances `advanceSaleIds` off, by advance: the earliest sale
 * with a line deducting it that is neither a corrective nor a full invoice issued in substitution.
 * A corrective, a replacement or a substitution copies that line, so it is never the one named;
 * an advance no invoice took off is absent. One read per {@link SQL_VARIABLE_LIMIT} advances.
 */
export async function advancesTakenOff(
  tx: Transaction,
  advanceSaleIds: readonly string[],
): Promise<Map<string, TakenOffBy>> {
  const takenOff = new Map<string, TakenOffBy>();
  for (let start = 0; start < advanceSaleIds.length; start += SQL_VARIABLE_LIMIT) {
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
      .where(
        and(
          inArray(saleLines.deductsSaleId, advanceSaleIds.slice(start, start + SQL_VARIABLE_LIMIT)),
          isNull(sales.correctsSaleId),
          notExists(
            tx
              .select({ id: saleSubstitutions.id })
              .from(saleSubstitutions)
              .where(eq(saleSubstitutions.substitutionSaleId, sales.id)),
          ),
        ),
      )
      .orderBy(sales.issuedAt, sales.invoiceNumber);
    for (const row of rows)
      if (!takenOff.has(row.advanceId!))
        takenOff.set(row.advanceId!, {
          saleId: row.id,
          invoiceNumber: formatInvoiceNumber(row.code, row.number),
        });
  }
  return takenOff;
}

/**
 * The invoice numbers of the advances the invoice `finalSaleId` took off ({@link advancesTakenOff})
 * whose payments still hold money, tips aside, that a plain refund could give back, as Refund a payment's cap reads
 * it ({@link readRefundableTenders}), in its lines' order; none for a corrective or substitution,
 * which only copy the deduction lines.
 */
export async function refundableAdvanceNumbersTakenOffBy(
  tx: Transaction,
  finalSaleId: string,
): Promise<string[]> {
  const lines = await tx
    .select({ advanceId: saleLines.deductsSaleId })
    .from(saleLines)
    .where(and(eq(saleLines.saleId, finalSaleId), isNotNull(saleLines.deductsSaleId)))
    .orderBy(saleLines.lineNo);
  const advanceIds = [...new Set(lines.map((line) => line.advanceId!))];
  const takenOff = await advancesTakenOff(tx, advanceIds);
  const refundableIds: string[] = [];
  for (const id of advanceIds) {
    if (takenOff.get(id)?.saleId !== finalSaleId) continue;
    const left = sumDecimals([
      ZERO,
      ...(await readRefundableTenders(tx, id)).map((row) => decimal(row.appliedRemaining)),
    ]);
    if (compareDecimal(left, ZERO) > 0) refundableIds.push(id);
  }
  const numbers = await readInvoiceNumbers(tx, refundableIds);
  return refundableIds.map((id) => numbers.get(id)!);
}

/**
 * What Correct invoice on the invoice `finalSaleId` can give back, tips aside: once it is paid, the
 * money its payments still hold, as `invoice_correction.money_short` reads it; while its bill is
 * still being paid, the money paid on it so far, which Correct invoice can give back only once the
 * bill is fully paid (`finalNotFullyPaid`).
 */
async function moneyLeftOn(
  tx: Transaction,
  finalSaleId: string,
): Promise<Pick<TakenOffParams, "finalMoneyLeft" | "finalNotFullyPaid">> {
  const [sale] = await tx
    .select({
      workingOrderId: sales.workingOrderId,
      settled: saleSettlements.id,
      voided: saleVoids.id,
    })
    .from(sales)
    .leftJoin(saleSettlements, eq(saleSettlements.saleId, sales.id))
    .leftJoin(saleVoids, eq(saleVoids.saleId, sales.id))
    .where(eq(sales.id, finalSaleId));
  if (sale?.settled === null && sale.voided === null && sale.workingOrderId !== null) {
    const paid = await paidOnIssuedBill(tx, sale.workingOrderId);
    return compareDecimal(paid, ZERO) > 0
      ? { finalMoneyLeft: paid, finalNotFullyPaid: true }
      : { finalMoneyLeft: ZERO };
  }
  const refundable = await readRefundableTenders(tx, finalSaleId);
  return {
    finalMoneyLeft: sumDecimals([ZERO, ...refundable.map((row) => decimal(row.appliedRemaining))]),
  };
}

type TakenOffParams = ErrorParams["advance.taken_off_final_invoice"];

/** {@link refuseTakenOffAdvance}'s refusal's params, once an invoice took the advance off. */
async function takenOffParams(
  tx: Transaction,
  saleId: string,
): Promise<TakenOffParams | undefined> {
  const final = (await advancesTakenOff(tx, [saleId])).get(saleId);
  if (final === undefined) return undefined;
  return {
    saleId,
    finalSaleId: final.saleId,
    invoiceNumber: final.invoiceNumber,
    ...(await moneyLeftOn(tx, final.saleId)),
  };
}

/**
 * Refuses `advance.taken_off_final_invoice` once an invoice has taken the advance `saleId` off
 * ({@link advancesTakenOff}). A whole credit of that invoice leaves the refusal in place.
 */
export async function refuseTakenOffAdvance(tx: Transaction, saleId: string): Promise<void> {
  const params = await takenOffParams(tx, saleId);
  if (params !== undefined) throw new AppError("advance.taken_off_final_invoice", params);
}

/**
 * Refuses a plain refund (Refund a payment) of the advance `saleId`'s money with
 * `tender.refund_of_advance` until an invoice took the advance off; then with
 * {@link refuseTakenOffAdvance}'s refusal while Correct invoice on that invoice can still give
 * money back, and not once it cannot.
 */
export async function refusePlainRefundOfAdvance(
  tx: Transaction,
  saleId: string,
  params: Omit<ErrorParams["tender.refund_of_advance"], "saleId" | "invoiceNumber">,
): Promise<void> {
  const takenOff = await takenOffParams(tx, saleId);
  if (takenOff === undefined)
    await refuseNamingAdvance(tx, saleId, "tender.refund_of_advance", params);
  else if (compareDecimal(decimal(takenOff.finalMoneyLeft), ZERO) > 0)
    throw new AppError("advance.taken_off_final_invoice", takenOff);
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
  return refuseNamingAdvance(tx, saleId, code, params);
}

/** Refuses `code`, naming the advance `saleId` and its invoice number. */
async function refuseNamingAdvance<C extends AdvanceRefundCode>(
  tx: Transaction,
  saleId: string,
  code: C,
  params: Omit<ErrorParams[C], "saleId" | "invoiceNumber">,
): Promise<never> {
  const invoiceNumber = await readInvoiceNumber(tx, brandSaleId(saleId));
  throw new AppError<AdvanceRefundCode>(code, {
    ...params,
    saleId,
    invoiceNumber,
  } as ErrorParams[C]);
}
