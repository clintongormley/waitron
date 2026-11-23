import { eq } from "drizzle-orm";
import { billPayments, type refunds, type Transaction } from "@waitron/db";
import { recordIncidentOnce } from "@waitron/core";
import { AppError, jobOrigin, rawCentsToDecimal, readOrigin, saleId } from "@waitron/shared";
import type { Decimal, Origin } from "@waitron/shared";
import "./errors.js";

type RefundRow = typeof refunds.$inferSelect;

/** What a refund gives back: its applied money and its tip. */
export const refundAmountOf = (refund: RefundRow): Decimal =>
  rawCentsToDecimal(String(refund.appliedAmount + refund.tipAmount));

export function raiseRefundOutcomeConflict(
  tx: Transaction,
  refund: RefundRow,
  workingOrderId: string,
  providerRefundRef: string | null,
  now: Date,
  origin: Origin,
): Promise<boolean> {
  return recordIncidentOnce(tx, {
    origin,
    error: new AppError("payment.refund_outcome_conflict", {
      refundId: refund.id,
      billPaymentId: refund.billPaymentId!,
      workingOrderId,
      amount: refundAmountOf(refund),
      providerRefundRef,
    }),
    severity: "error",
    detectedAt: now,
  });
}

/** Raised by the payment check alone, which finds a refund still pending after an hour. */
export function raiseRefundUnresolved(
  tx: Transaction,
  refund: RefundRow,
  workingOrderId: string,
  now: Date,
): Promise<boolean> {
  return recordIncidentOnce(tx, {
    origin: jobOrigin("payment_check"),
    error: new AppError("payment.refund_unresolved", {
      refundId: refund.id,
      billPaymentId: refund.billPaymentId!,
      workingOrderId,
      amount: refundAmountOf(refund),
      pendingSince: refund.createdAt,
    }),
    severity: "warning",
    detectedAt: now,
  });
}

export function raiseTenderRefundConflict(
  tx: Transaction,
  refund: typeof refunds.$inferSelect,
  providerRefundRef: string | null,
  now: Date,
): Promise<boolean> {
  return recordIncidentOnce(tx, {
    origin: readOrigin(refund.source, refund.deviceId),
    saleId: saleId(refund.saleId!),
    error: new AppError("payment.tender_refund_outcome_conflict", {
      refundId: refund.id,
      saleId: refund.saleId!,
      tenderId: refund.tenderId!,
      amount: refundAmountOf(refund),
      providerRefundRef,
    }),
    severity: "error",
    detectedAt: now,
  });
}

export async function raisePendingRefundUnresolved(
  tx: Transaction,
  refund: typeof refunds.$inferSelect,
  now: Date,
): Promise<boolean> {
  if (refund.billPaymentId !== null) {
    const [parent] = await tx
      .select({ workingOrderId: billPayments.workingOrderId })
      .from(billPayments)
      .where(eq(billPayments.id, refund.billPaymentId));
    return raiseRefundUnresolved(tx, refund, parent!.workingOrderId, now);
  }
  return recordIncidentOnce(tx, {
    origin: jobOrigin("payment_check"),
    saleId: saleId(refund.saleId!),
    error: new AppError("payment.tender_refund_unresolved", {
      refundId: refund.id,
      saleId: refund.saleId!,
      tenderId: refund.tenderId!,
      amount: refundAmountOf(refund),
      pendingSince: refund.createdAt,
    }),
    severity: "warning",
    detectedAt: now,
  });
}
