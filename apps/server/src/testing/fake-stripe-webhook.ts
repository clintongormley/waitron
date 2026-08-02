import { createHmac } from "node:crypto";
import type Stripe from "stripe";

/**
 * A deterministic stand-in for Stripe's webhook HMAC. The real SDK signs the EXACT received bytes
 * with the endpoint's signing secret; this models the same two dependences so a hermetic test can
 * prove both properties the endpoint's security rests on:
 *
 * - **byte-exactness** — a body re-serialised (parsed then `JSON.stringify`d) no longer matches, so
 *   a test that signs a whitespace-irregular body pins that the route reads the RAW bytes
 *   (`c.req.text()`), never a JSON round-trip;
 * - **secret-dependence** — a body signed with tenant A's secret does not verify under tenant B's,
 *   so a test proves the per-tenant secret SELECTION rather than a single shared secret.
 */
export function signStripeBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * A `Stripe` SDK double exposing only `webhooks.constructEvent` — the single call
 * `stripeHostedClient` makes to verify an inbound webhook. Verification is local HMAC (no network),
 * byte-exact and secret-dependent, and throws exactly as the SDK does on a bad signature. Returns
 * the raw Stripe event shape the hosted client maps from (`event.data.object` = the Checkout
 * Session, `event.created` = unix seconds). Never the API surface — nothing here reaches Stripe.
 */
export function verifyingStripe(): Stripe {
  return {
    webhooks: {
      constructEvent(payload: string, header: string, secret: string): unknown {
        if (signStripeBody(payload, secret) !== header) {
          throw new Error("fake-stripe: no signatures found matching the expected signature");
        }
        return JSON.parse(payload) as unknown;
      },
    },
  } as unknown as Stripe;
}

/**
 * The raw JSON bytes of a `checkout.session.*` event — the shape
 * `stripeHostedClient.constructWebhookEvent` decodes. Returned as an explicit string so a test
 * controls the EXACT bytes it signs; `amount_total` is minor units (cents), `created` unix seconds.
 */
export function stripeSessionEvent(e: {
  type: string;
  sessionId: string;
  amountTotalMinor: number | null;
  created: number;
}): string {
  return JSON.stringify({
    type: e.type,
    created: e.created,
    data: { object: { id: e.sessionId, amount_total: e.amountTotalMinor } },
  });
}
