import { randomUUID } from "node:crypto";
import type { Decimal } from "@waitron/shared";
import type { Database } from "@waitron/db";
import { reversePayment } from "@waitron/payments";
import type { PaymentResult } from "@waitron/payments";

/** Structural, so `reverseViaStripe` takes either `StripeClient` or `StripeDeviceClient`. */
export interface StripeRefunder {
  refund(params: {
    paymentIntentId: string;
    amount?: Decimal;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "succeeded" | "pending" | "failed" }>;
}

export interface ReverseViaStripeOptions {
  /** Maps the stored `external_ref` to the identifier `stripe.refunds` addresses. Defaults to
   * identity, which suits the terminal and on-device rows (they store a PaymentIntent id); a hosted
   * row stores a Checkout Session id, which the refund API cannot address. */
  resolveProcessorRef?: (externalRef: string) => Promise<string>;
}

// A fresh key keeps independent equal partial refunds separate; it does not protect a resend.
export function reverseViaStripe(
  db: Database,
  client: StripeRefunder,
  provider: string,
  ref: string,
  kind: "void" | "refund",
  amount: Decimal | undefined,
  {
    resolveProcessorRef = (externalRef) => Promise.resolve(externalRef),
  }: ReverseViaStripeOptions = {},
): Promise<PaymentResult> {
  return reversePayment(db, { provider, paymentRef: ref, kind, amount }, async (externalRef) => {
    const processorRef = await resolveProcessorRef(externalRef);
    const outcome = await client.refund({
      paymentIntentId: processorRef,
      ...(amount ? { amount } : {}),
      idempotencyKey: randomUUID(),
    });
    return outcome.status === "failed" ? "refused" : "accepted";
  });
}
