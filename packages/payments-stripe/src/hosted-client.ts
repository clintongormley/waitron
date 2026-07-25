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
    /** Our own identifiers, stamped onto the session so the reconciliation audit can attribute a
     * settlement that has NO local row back to a till. `initiate` calls the network and only THEN
     * writes its row, so a crash in between leaves a settled session with nothing local — reconcile's
     * `missingLocal` class — and without these keys that settlement can only ever be *reported*, never
     * raised as an incident against a till.
     *
     * Which capture modes can actually reach that state is worth stating precisely, because an
     * earlier version of this comment got it wrong and the error hid a real gap:
     *
     * - **Terminal (2a) cannot.** `StripeTerminalProvider.collect` commits an `attempting` row BEFORE
     *   its network call, so a crash always leaves a row behind — that is what `attempting` is for.
     * - **On-device (2b) can.** `StripeOnDeviceProvider.collect` reads the offline policy, collects on
     *   the reader (where the money moves) and writes its row afterwards — the same
     *   network-then-write ordering as this mode. So its create is stamped with these SAME keys.
     *
     * What is still deferred for on-device is the READ side, not the stamp: its metadata lands on the
     * PaymentIntent, and Stripe does not propagate PaymentIntent metadata to the charge, so the audit's
     * main balance-transaction list would need an `expand: ["data.source.payment_intent"]` level to see
     * it — where a hosted session's metadata comes free with the session list it already makes. Until
     * that lands, an on-device `missingLocal` is reported but UNATTRIBUTED: no till, no incident. That
     * is a known gap on Slice B §7's deferred list, not something the mode is incapable of reaching. */
    metadata: { working_order_id: string; payment_ref: string };
  }): Promise<{ id: string; url: string }>;
  /** Verify the webhook signature (THROWS on a bad signature) and return the parsed event. Synchronous:
   * signature verification is local HMAC, not a network call. */
  constructWebhookEvent(payload: string, signature: string): ParsedHostedEvent;
}
