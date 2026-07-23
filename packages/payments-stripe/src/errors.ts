import "@waitron/shared";

/** `@waitron/payments-stripe`'s contribution to the shared error registry — Stripe-adapter-specific
 * failures the neutral `payment.*` codes don't cover. */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** The reader did not resolve its action within the poll window; the action was cancelled and
     * the payment failed. */
    "stripe.collect_timeout": { paymentRef: string; readerId: string };
  }
}
