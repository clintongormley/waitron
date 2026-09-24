import { randomUUID } from "node:crypto";
import type { Decimal } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { insertCapturedPayment, recordRefund } from "./store.js";
import type { PaymentRow } from "./store.js";

/**
 * The `provider` value for a card tender taken on a SEPARATE bank terminal with no electronic link
 * to the POS. Manual mode is NOT a `PaymentProvider`; it reuses the payment store's ledger under
 * this fixed id so a manual card tender is uniform with an integrated one for association,
 * reporting and refunds.
 */
export const MANUAL_PROVIDER = "manual";

export interface ManualCardPaymentParams {
  workingOrderId: string;
  /** Tax-inclusive. */
  amount: Decimal;
  /** The SAME clock reading the caller stamps the sale's tender with, so payment and tender agree
   * on one instant. */
  settledAt: Date;
  /** Optional hand-keyed acquirer / bank-terminal operation number — a human reconciliation hook. */
  externalRef?: string;
}

export interface ManualCardPaymentResult {
  provider: string;
  paymentRef: string;
  settledAt: Date;
}

/**
 * Makes NO network call, so it runs INSIDE the sale transaction alongside `recordSale` and
 * `associatePaymentWithSale`: an atomic capture with no orphan window.
 */
export async function recordManualCardPayment(
  tx: Transaction,
  params: ManualCardPaymentParams,
): Promise<ManualCardPaymentResult> {
  const paymentRef = `manual-${randomUUID()}`;
  await insertCapturedPayment(tx, {
    workingOrderId: params.workingOrderId,
    provider: MANUAL_PROVIDER,
    paymentRef,
    amount: params.amount,
    settledAt: params.settledAt,
    externalRef: params.externalRef,
  });
  return { provider: MANUAL_PROVIDER, paymentRef, settledAt: params.settledAt };
}

/**
 * Mirrors a refund staff performed on the bank terminal. Never touches the fiscal record: reversing
 * the SALE is a separate, deliberate action, not a side effect of this.
 */
export async function recordManualRefund(
  tx: Transaction,
  params: { paymentRef: string; amount: Decimal },
): Promise<PaymentRow> {
  return recordRefund(tx, {
    provider: MANUAL_PROVIDER,
    paymentRef: params.paymentRef,
    amount: params.amount,
  });
}
