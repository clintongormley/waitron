import type Stripe from "stripe";
import type { StripeClient } from "./client.js";
import { toMinorUnits } from "./client.js";

export function stripeClient(stripe: Stripe): StripeClient {
  return {
    async createPaymentIntent({ amount, currency, idempotencyKey }) {
      const pi = await stripe.paymentIntents.create(
        {
          amount: toMinorUnits(amount),
          currency,
          payment_method_types: ["card_present"],
          capture_method: "automatic",
        },
        { idempotencyKey },
      );
      return { id: pi.id };
    },
    async processPaymentIntent(readerId, paymentIntentId) {
      await stripe.terminal.readers.processPaymentIntent(readerId, {
        payment_intent: paymentIntentId,
      });
    },
    async readerOutcome(readerId) {
      const reader = await stripe.terminal.readers.retrieve(readerId);
      // A deleted reader has no `.action`, and reads like a reader with no action.
      const action = "action" in reader ? reader.action : null;
      if (!action || action.status === "in_progress") return { status: "in_progress" };
      if (action.status === "succeeded") return { status: "succeeded" };
      return { status: "failed", failureCode: action.failure_code ?? undefined };
    },
    async cancelReaderAction(readerId) {
      await stripe.terminal.readers.cancelAction(readerId);
    },
    async refund({ paymentIntentId, amount, idempotencyKey }) {
      const refund = await stripe.refunds.create(
        { payment_intent: paymentIntentId, ...(amount ? { amount: toMinorUnits(amount) } : {}) },
        { idempotencyKey },
      );
      const status =
        refund.status === "succeeded" || refund.status === "pending" ? refund.status : "failed";
      return { id: refund.id, status };
    },
  };
}
