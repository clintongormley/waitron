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
     * This is not defence-in-depth against the RLS policy; it is what makes "fails closed" true on
     * the on-device path. There, the provider's own transaction scope and the row's `tenant_id`
     * only meet at `insertCapturedPayment`, which runs AFTER `collectOnDevice` has taken the card
     * payment — so relying on the policy's WITH CHECK to catch a mis-wiring would reproduce this
     * branch's worst defect (money taken, no local row, unattributed) as designed behaviour. */
    "stripe.tenant_mismatch": { expected: string; supplied: string };
  }
}
