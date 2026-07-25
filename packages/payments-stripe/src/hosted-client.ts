import type { Decimal } from "@waitron/shared";

/** One inbound Stripe webhook event, parsed into the narrow shape `StripeHostedProvider.verifyAndParse`
 * needs — so the provider's mapping logic is hermetic (no `stripe` types leak into it). `type` is the
 * Stripe event type (e.g. `"checkout.session.completed"`); `sessionId` is the Checkout Session id
 * (`event.data.object.id`, our `external_ref`); `amountTotalMinor` is `amount_total` (cents), null when
 * the event carries none; `createdAt` is `event.created` as a Date. */
export interface ParsedHostedEvent {
  type: string;
  sessionId: string;
  amountTotalMinor: number | null;
  createdAt: Date;
}

/** The narrow hosted-checkout Stripe surface `StripeHostedProvider` depends on — the two calls it
 * makes, not the SDK. The real impl (`./stripe-hosted-client.ts`) wraps `stripe.checkout.sessions
 * .create` + `stripe.webhooks.constructEvent` and is coverage-excluded; `FakeStripeHosted`
 * (`./testing/`) models it deterministically. Amounts cross as exact `Decimal`. Separate from
 * `StripeClient`/`StripeDeviceClient` (each provider names only the calls it uses). */
export interface StripeHostedClient {
  /** Mint a hosted Checkout Session for one working order. Returns the session id (our `external_ref`)
   * and the hosted-page url. `idempotencyKey` (the caller's `payment_ref`) makes a retried initiate
   * return the SAME session rather than a duplicate. */
  createCheckoutSession(params: {
    amount: Decimal;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ id: string; url: string }>;
  /** Verify the webhook signature (THROWS on a bad signature) and return the parsed event. Synchronous:
   * signature verification is local HMAC, not a network call. */
  constructWebhookEvent(payload: string, signature: string): ParsedHostedEvent;
}
