import "@waitron/shared";

/** `@waitron/payments-sumup`'s contribution to the shared error registry — the one SumUp-adapter
 * failure the neutral `payment.*` codes do not cover. The sibling of `stripe.tenant_mismatch`
 * (`packages/payments-stripe/src/errors.ts`): same concept, same shape. */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** A `collect` was handed params for a different tenant than the provider was constructed
     * for — a host wiring error. Raised BEFORE any network call, so no money moves. */
    "sumup.tenant_mismatch": { expected: string; supplied: string };
    /** The API key acts as several merchant accounts and the connect form named none, so the seat
     * cannot choose one to seal. Carries the pickable list — merchant codes and names are not
     * secrets — so the form offers a picker and re-submits with the chosen `merchantCode`. */
    "payment.provider_merchant_ambiguous": { merchants: { code: string; name: string }[] };
  }
}
