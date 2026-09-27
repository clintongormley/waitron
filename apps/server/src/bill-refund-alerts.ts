import type { billPaymentRefunds } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { recordIncidentOnce } from "@waitron/core";
import { AppError, centsToDecimal, tillId as brandTillId } from "@waitron/shared";
import "./errors.js";

/** The incidents a card refund of a bill raises (bill payments design §6b), on the till that gave
 * the money back. */

type RefundRow = typeof billPaymentRefunds.$inferSelect;

const amountOf = (refund: RefundRow) => centsToDecimal(refund.appliedAmount + refund.tipAmount);

export function raiseRefundOutcomeConflict(
  tx: Transaction,
  refund: RefundRow,
  workingOrderId: string,
  providerRefundRef: string | null,
  now: Date,
): Promise<boolean> {
  return recordIncidentOnce(tx, {
    tillId: brandTillId(refund.tillId),
    error: new AppError("payment.refund_outcome_conflict", {
      refundId: refund.id,
      billPaymentId: refund.billPaymentId,
      workingOrderId,
      amount: amountOf(refund),
      providerRefundRef,
    }),
    severity: "error",
    detectedAt: now,
  });
}

export function raiseRefundUnresolved(
  tx: Transaction,
  refund: RefundRow,
  workingOrderId: string,
  now: Date,
): Promise<boolean> {
  return recordIncidentOnce(tx, {
    tillId: brandTillId(refund.tillId),
    error: new AppError("payment.refund_unresolved", {
      refundId: refund.id,
      billPaymentId: refund.billPaymentId,
      workingOrderId,
      amount: amountOf(refund),
      pendingSince: refund.createdAt,
    }),
    severity: "warning",
    detectedAt: now,
  });
}
