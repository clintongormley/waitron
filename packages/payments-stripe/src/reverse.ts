import { randomUUID } from "node:crypto";
import { AppError, decimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import type { Database } from "@waitron/db";
import type { PaymentResult } from "@waitron/payments";
import {
  assertReversible,
  findPaymentByRef,
  recordFailedRefund,
  recordRefund,
  recordVoid,
} from "@waitron/payments";

/** The Stripe refund surface both adapters' clients expose (`StripeClient` and `StripeDeviceClient`
 * declare an identical `refund`). A structural type so `reverseViaStripe` takes either client. */
export interface StripeRefunder {
  refund(params: {
    paymentIntentId: string;
    amount?: Decimal;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "succeeded" | "pending" | "failed" }>;
}

/** The reversal path shared by BOTH Stripe providers (server-driven 2a and on-device 2b) —
 * void/refund/partialRefund via `stripe.refunds`. Find + read-only reversibility pre-check (T1) BEFORE
 * the network refund, so an invalid local state fails fast without moving money; then persist the
 * outcome (T2). A Stripe-refused refund records a `payment_refunds` failure row and leaves the payment
 * state untouched (still `captured`/`partially_refunded`); an accepted one transitions via
 * `recordVoid`/`recordRefund` (any non-`failed` status, incl. `pending`, is treated optimistically as
 * accepted — async settlement confirmation is the deferred webhook path). On success `partialRefund`
 * reports the amount REFUNDED and `refund`/`void` the captured amount; on a FAILED reversal `amount`
 * echoes the ATTEMPTED amount. Reversal `settledAt` is always null — only `collect` settles a tender.
 * A fresh `randomUUID` idempotency key per call: two INDEPENDENT equal partial refunds each issue a
 * real refund; SAME-reversal retry-safety (a persisted per-reversal id) is deferred, and reconcile
 * backstops Stripe-vs-local drift. */
export async function reverseViaStripe(
  db: Database,
  client: StripeRefunder,
  provider: string,
  ref: string,
  kind: "void" | "refund",
  amount?: Decimal,
): Promise<PaymentResult> {
  const found = await db.transaction(async (tx) => {
    const f = await findPaymentByRef(tx, provider, ref);
    if (f === undefined || f.externalRef === null) {
      throw new AppError("payment.not_found", { provider, paymentRef: ref });
    }
    const externalRef = f.externalRef;
    await assertReversible(tx, { tenantId: f.tenantId, provider, paymentRef: ref, kind, amount });
    return { ...f, externalRef };
  });
  const key = { tenantId: found.tenantId, provider, paymentRef: ref };

  const outcome = await client.refund({
    paymentIntentId: found.externalRef,
    ...(amount ? { amount } : {}),
    idempotencyKey: randomUUID(),
  });

  if (outcome.status === "failed") {
    await db.transaction((tx) =>
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

  const row = await db.transaction((tx) =>
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
