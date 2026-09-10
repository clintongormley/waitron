import "@waitron/shared";

/** `@waitron/payments-sumup`'s contribution to the shared error registry — the one SumUp-adapter
 * failure the neutral `payment.*` codes do not cover. The sibling of `stripe.tenant_mismatch`
 * (`packages/payments-stripe/src/errors.ts`): same concept, same shape. */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** A `collect` was handed params for a different tenant than the provider was constructed
     * for — a host wiring error. Raised BEFORE any network call, so no money moves. */
    "sumup.tenant_mismatch": { expected: string; supplied: string };
  }
}
