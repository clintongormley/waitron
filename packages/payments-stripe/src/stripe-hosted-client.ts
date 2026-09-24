import type Stripe from "stripe";
import { toMinorUnits } from "./client.js";
import type { ParsedHostedEvent, StripeHostedClient } from "./hosted-client.js";

export function stripeHostedClient(
  stripe: Stripe,
  config: { successUrl: string; cancelUrl: string; webhookSecret: string },
): StripeHostedClient {
  return {
    async createCheckoutSession({ amount, currency, idempotencyKey, metadata }) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          // Session metadata does NOT propagate to the PaymentIntent, so it is stamped on both.
          metadata,
          payment_intent_data: { metadata },
          success_url: config.successUrl,
          cancel_url: config.cancelUrl,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency,
                unit_amount: toMinorUnits(amount),
                product_data: { name: "Order" },
              },
            },
          ],
        },
        { idempotencyKey },
      );
      if (session.url === null) {
        throw new Error("stripe: checkout session has no url");
      }
      return { id: session.id, url: session.url };
    },
    constructWebhookEvent(payload, signature): ParsedHostedEvent {
      const event = stripe.webhooks.constructEvent(payload, signature, config.webhookSecret);
      const session = event.data.object as Stripe.Checkout.Session;
      return {
        type: event.type,
        sessionId: session.id,
        amountTotalMinor: session.amount_total,
        createdAt: new Date(event.created * 1000),
      };
    },
  };
}
