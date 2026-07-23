import { randomUUID } from "node:crypto";
import type { Decimal } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { insertCapturedPayment, recordRefund } from "./store.js";
import type { PaymentRow } from "./store.js";

/**
 * The sentinel `provider` value for a manual / unintegrated card tender — one a merchant takes on a
 * SEPARATE bank card terminal with no electronic link to the POS (the classic "datáfono" case, in a
 * comment where Spanish is allowed). Manual mode is NOT a `PaymentProvider`: it makes no network
 * call and implements no adapter. It reuses the payment store's ledger with this fixed provider id
 * so a manual card tender is uniform with an integrated one for association, reporting and refunds.
 * The word is ordinary English, so it passes `no-provider-vocabulary.test.ts` (which bans SDK/vendor
 * vocabulary, not plain words).
 */
export const MANUAL_PROVIDER = "manual";

export interface ManualCardPaymentParams {
  tenantId: string;
  workingOrderId: string;
  /** Exact decimal, tax-inclusive amount taken on this tender. */
  amount: Decimal;
  /** The instant the tender settled — the SAME reading the caller stamps the sale's tender with, so
   * payment and tender agree on one instant (the repo's one-clock-reading-per-event discipline). */
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
 * Record a manual (unintegrated) card tender: a `captured` `payments` row under the sentinel
 * `manual` provider, with a freshly minted `paymentRef` and the optional `externalRef`. Makes NO
 * network call — there is no provider to call — so it can, and should, run INSIDE the sale
 * transaction alongside `recordSale` and `associatePaymentWithSale`, giving manual mode an atomic
 * capture with no orphan window.
 */
export async function recordManualCardPayment(
  tx: Transaction,
  params: ManualCardPaymentParams,
): Promise<ManualCardPaymentResult> {
  const paymentRef = `manual-${randomUUID()}`;
  await insertCapturedPayment(tx, {
    tenantId: params.tenantId,
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
 * Record a refund staff performed on the bank terminal, mirroring what happened there — a
 * `payment_refunds` row under the `manual` provider, advancing the payment to
 * `refunded`/`partially_refunded`. Reuses `recordRefund`, pinning the sentinel provider. Never
 * touches the fiscal record: reversing the SALE (a rectificativa) is a separate, deliberate action
 * through the existing `recordVoid` path, not a side effect of this.
 */
export async function recordManualRefund(
  tx: Transaction,
  params: { tenantId: string; paymentRef: string; amount: Decimal },
): Promise<PaymentRow> {
  return recordRefund(tx, {
    tenantId: params.tenantId,
    provider: MANUAL_PROVIDER,
    paymentRef: params.paymentRef,
    amount: params.amount,
  });
}
