import { randomUUID } from "node:crypto";
import type { Decimal, DeviceOrigin, NodeId } from "@waitron/shared";
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
  /** The device the card payment was keyed on. */
  origin: DeviceOrigin;
  workingOrderId: string;
  /** The box that recorded the card payment: its collection owner. */
  nodeId: NodeId;
  /** Tax-inclusive. */
  amount: Decimal;
  /** The SAME clock reading the caller stamps the sale's tender with, so payment and tender agree
   * on one instant. */
  settledAt: Date;
  /** Optional hand-keyed acquirer / bank-terminal operation number — a human reconciliation hook. */
  externalRef?: string;
  externalProvider?: "connected_account" | "other";
  externalMachine?: string;
  /** The bill payment this card payment was taken for; absent for a payment of a whole order. */
  billPaymentId?: string;
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
    origin: params.origin,
    workingOrderId: params.workingOrderId,
    nodeId: params.nodeId,
    provider: MANUAL_PROVIDER,
    paymentRef,
    amount: params.amount,
    settledAt: params.settledAt,
    externalRef: params.externalRef,
    externalProvider: params.externalProvider,
    externalMachine: params.externalMachine,
    billPaymentId: params.billPaymentId,
  });
  return { provider: MANUAL_PROVIDER, paymentRef, settledAt: params.settledAt };
}

/**
 * Mirrors a refund staff performed on the bank terminal. Never touches the fiscal record: reversing
 * the SALE is a separate, deliberate action, not a side effect of this.
 */
export async function recordManualRefund(
  tx: Transaction,
  params: { paymentRef: string; amount: Decimal; authorizedBy?: string },
): Promise<PaymentRow> {
  return recordRefund(tx, {
    provider: MANUAL_PROVIDER,
    paymentRef: params.paymentRef,
    amount: params.amount,
    authorizedBy: params.authorizedBy,
  });
}
