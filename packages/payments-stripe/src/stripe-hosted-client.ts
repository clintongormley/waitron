import type Stripe from "stripe";
import { toMinorUnits } from "./client.js";
import type { ParsedHostedEvent, StripeHostedClient } from "./hosted-client.js";

/** The real `StripeHostedClient`, wrapping the `stripe` SDK's Checkout + webhooks API. Coverage-excluded
 * (see vitest.config.ts): a thin call-mapping boundary whose logic is the SDK's. `createCheckoutSession`
 * is exercised by the nightly sandbox (real test-mode); `constructWebhookEvent` verifies a real
 * signature (proven by the hermetic run through `FakeStripeHosted`, never this file).
 *
 * `config` is deployment-injected (SP7/SP9): `successUrl`/`cancelUrl` are where the hosted page returns
 * the customer, and `webhookSecret` is the endpoint's signing secret. Provisioning them is out of scope
 * here, exactly as reader provisioning and per-tenant keys were throughout 2a/2b. */
export function stripeHostedClient(
  stripe: Stripe,
  config: { successUrl: string; cancelUrl: string; webhookSecret: string },
): StripeHostedClient {
  return {
    async createCheckoutSession({ amount, currency, idempotencyKey, metadata }) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          // Stamped on the session AND, via `payment_intent_data`, forwarded onto the PaymentIntent
          // Checkout creates behind it — session metadata does NOT propagate there on its own. The
          // reconciliation audit's settlement report is keyed off the PaymentIntent/charge, so without
          // this the audit would need an extra `expand` on its main list call just to read metadata
          // that lives on the session instead.
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
        // A `mode: "payment"` session always has a hosted url; guard defensively so the caller never
        // gets a null url masquerading as a valid one.
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
