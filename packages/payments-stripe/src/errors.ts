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
    /**
     * A tenant's Stripe key belongs to the other environment. A test key on a production
     * deployment takes payments that never settle, and `reconcile` then sweeps a test-mode account
     * against live rows and reports every one as missing upstream. Thrown by the card-provider
     * seat's `connect`/`build` (the `sk_live_`/`sk_test_` prefix guard) and by `apps/server`'s
     * `stripeSecretKeyFrom` at the read site.
     *
     * `payment.*`, not `stripe.*`: it names the payment-credential concept, and the throw sites
     * (this package and `apps/server`, which imports this barrel) both see the augmentation. Carries
     * the key's ENVIRONMENT, never the key or any prefix of it.
     */
    "payment.credential_environment_mismatch": {
      tenantId: string;
      keyEnvironment: string;
      hostEnvironment: string;
    };
  }
}
