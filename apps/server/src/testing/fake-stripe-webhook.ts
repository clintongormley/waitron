import { createHmac } from "node:crypto";
import type Stripe from "stripe";

/**
 * A deterministic stand-in for Stripe's webhook HMAC, depending on the EXACT bytes and on the secret,
 * as the real SDK does: a re-serialised body or a wrong secret does not verify.
 */
export function signStripeBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/** A `Stripe` SDK double exposing only `webhooks.constructEvent`, verified by local HMAC. */
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
 * The raw JSON bytes of a `checkout.session.*` event, so a test controls the EXACT bytes it signs.
 * `amount_total` is minor units (cents), `created` unix seconds.
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
