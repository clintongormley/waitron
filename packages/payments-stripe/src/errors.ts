import "@waitron/shared";

/** `@waitron/payments-stripe`'s contribution to the shared error registry — Stripe-adapter-specific
 * failures the neutral `payment.*` codes don't cover. */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** The reader did not resolve its action within the poll window; the action was cancelled and
     * the payment failed. */
    "stripe.collect_timeout": { paymentRef: string; readerId: string };
    /** A `collect` was handed params for a different tenant than the provider was constructed for —
     * a host wiring error. Raised BEFORE any network call, so no money moves.
     *
     * The on-device path calls `collectOnDevice` before `insertCapturedPayment`, so the tenant
     * check must precede the network call to refuse a mis-wiring before the card is charged. */
    "stripe.tenant_mismatch": { expected: string; supplied: string };
  }
}
