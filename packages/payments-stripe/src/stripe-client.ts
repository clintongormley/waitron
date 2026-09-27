import type Stripe from "stripe";
import type { StripeClient, StripeRefund } from "./client.js";
import { toMinorUnits } from "./client.js";

function refundOf(refund: Stripe.Refund): StripeRefund {
  return { id: refund.id, status: refund.status ?? "unknown", metadata: refund.metadata ?? {} };
}

/** The SDK's errors carry the HTTP status of Stripe's answer as `statusCode`; a connection error
 * or a timeout carries none. */
function httpStatusOf(error: unknown): number | null {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" ? status : null;
}

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
    async retrievePaymentIntent(paymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      return {
        id: pi.id,
        status: pi.status,
        amount: pi.amount,
        amountReceived: pi.amount_received,
      };
    },
    async cancelPaymentIntent(paymentIntentId) {
      const pi = await stripe.paymentIntents.cancel(paymentIntentId);
      return { status: pi.status };
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
    async createRefund({ paymentIntentId, amount, idempotencyKey, metadata }) {
      // stripe@22.6.2 sends a request once more after its connection closes with ECONNRESET or
      // EPIPE, whatever `maxNetworkRetries` says (`_shouldRetry`, esm/RequestSender.js:183-187;
      // the codes, esm/net/HttpClient.js:38), so a refusal may answer a repeat of an attempt
      // Stripe acted on. Each attempt emits `request` with its key (esm/RequestSender.js:448).
      // Another call in this process under the same key is counted too, which only raises it.
      let attempts = 0;
      const count = (event: { idempotency_key?: string }) => {
        if (event.idempotency_key === idempotencyKey) attempts += 1;
      };
      (stripe.on as (name: "request", handler: typeof count) => void)("request", count);
      try {
        const refund = await stripe.refunds.create(
          { payment_intent: paymentIntentId, amount: toMinorUnits(amount), metadata },
          // Otherwise the SDK also repeats it after any connection error, an answer marked
          // `stripe-should-retry: true`, or a 409 or 5xx not marked `false`
          // (esm/RequestSender.js:188-216).
          { idempotencyKey, maxNetworkRetries: 0 },
        );
        return { ok: true, refund: refundOf(refund) };
      } catch (error) {
        return { ok: false, httpStatus: httpStatusOf(error), attempts };
      } finally {
        (stripe.off as (name: "request", handler: typeof count) => void)("request", count);
      }
    },
    async listRefunds(paymentIntentId) {
      const refunds: StripeRefund[] = [];
      let startingAfter: string | undefined;
      for (;;) {
        const page = await stripe.refunds.list({
          payment_intent: paymentIntentId,
          limit: 100,
          ...(startingAfter === undefined ? {} : { starting_after: startingAfter }),
        });
        refunds.push(...page.data.map(refundOf));
        if (!page.has_more || page.data.length === 0) return refunds;
        startingAfter = page.data.at(-1)!.id;
      }
    },
  };
}
