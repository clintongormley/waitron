import { randomUUID } from "node:crypto";
import { AppError, decimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { PaymentResult } from "@waitron/payments";
import {
  assertReversible,
  findPaymentByRef,
  recordFailedRefund,
  recordRefund,
  recordVoid,
} from "@waitron/payments";

/** Structural, so `reverseViaStripe` takes either `StripeClient` or `StripeDeviceClient`. */
export interface StripeRefunder {
  refund(params: {
    paymentIntentId: string;
    amount?: Decimal;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "succeeded" | "pending" | "failed" }>;
}

export interface ReverseViaStripeOptions {
  /** Not read by `reverseViaStripe`. */
  nodeId: string;
  /** Maps the stored `external_ref` to the identifier `stripe.refunds` addresses. Defaults to
   * identity, which suits the terminal and on-device rows (they store a PaymentIntent id); a hosted
   * row stores a Checkout Session id, which the refund API cannot address. */
  resolveProcessorRef?: (externalRef: string) => Promise<string>;
}

/** The reversibility pre-check runs BEFORE the network refund, so an invalid local state fails
 * without moving money. A Stripe-refused refund records a failure row and leaves the payment state
 * untouched; any other status, `pending` included, is treated as accepted. The idempotency key is
 * fresh per call, so two independent equal partial refunds each issue a real refund.
 * SAME-reversal retry-safety (a persisted per-reversal id) is deferred. */
export async function reverseViaStripe(
  db: Database,
  client: StripeRefunder,
  provider: string,
  ref: string,
  kind: "void" | "refund",
  amount: Decimal | undefined,
  { resolveProcessorRef = (externalRef) => Promise.resolve(externalRef) }: ReverseViaStripeOptions,
): Promise<PaymentResult> {
  // Network calls — the refund and `resolveProcessorRef` — stay outside every transaction.
  const inTransaction = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTransaction(db, fn);

  const found = await inTransaction(async (tx) => {
    const f = await findPaymentByRef(tx, provider, ref);
    if (f === undefined || f.externalRef === null) {
      throw new AppError("payment.not_found", { provider, paymentRef: ref });
    }
    const externalRef = f.externalRef;
    await assertReversible(tx, { provider, paymentRef: ref, kind, amount });
    return { ...f, externalRef };
  });
  const key = { provider, paymentRef: ref };

  // After `assertReversible`, so the processor is not asked about a payment we already refuse.
  const processorRef = await resolveProcessorRef(found.externalRef);
  const outcome = await client.refund({
    paymentIntentId: processorRef,
    ...(amount ? { amount } : {}),
    idempotencyKey: randomUUID(),
  });

  if (outcome.status === "failed") {
    await inTransaction((tx) =>
      recordFailedRefund(tx, { ...key, amount: amount ?? decimal(found.amount) }),
    );
    return {
      provider,
      paymentRef: ref,
      state: found.state,
      amount: amount ?? decimal(found.amount),
      settledAt: null,
    };
  }

  const row = await inTransaction((tx) =>
    kind === "void"
      ? recordVoid(tx, key)
      : recordRefund(tx, { ...key, amount: amount ?? decimal(found.amount) }),
  );
  return {
    provider,
    paymentRef: ref,
    state: row.state,
    amount: amount ?? decimal(row.amount),
    settledAt: null,
  };
}
