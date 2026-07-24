// A bare side-effect import, not a value used here: it makes TypeScript treat "@waitron/shared"
// as a real module to augment rather than declaring a fresh ambient one — the same idiom
// packages/core/src/errors.ts and packages/fiscal/src/errors.ts use for their own contributions.
import "@waitron/shared";

/**
 * packages/payments's contribution to the shared error registry, by declaration merging — the
 * DOMAIN-CONCEPT, lowercase, dot-namespaced convention (`payment.*`), never the package name.
 * packages/shared must never change just because a dependent package adds a code; this is how
 * packages/payments adds its own without packages/shared knowing in advance.
 *
 * Reachability: `./provider.ts` does `import "./errors.js"`, and `./index.ts` re-exports
 * `./provider.ts`, so this augmentation is reachable from the public barrel — see
 * `./errors.reachability.test.ts`.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** Thrown by the store / a provider when `paymentRef` names no `payments` row for this tenant
     * and provider — either it never existed, or RLS hid another tenant's row (identical from
     * here). */
    "payment.not_found": { provider: string; paymentRef: string };
    /** Thrown when a refund (or the running total of refunds) would exceed the captured amount. */
    "payment.refund_exceeds_capture": {
      paymentRef: string;
      captured: string;
      requested: string;
      alreadyRefunded: string;
    };
    /** Thrown by `void` when the payment is not in a voidable state. In 4a `collect` is a single
     * auth+capture message, so only a `captured` payment is voidable (a same-day full reversal,
     * distinct from a refund); a payment already `voided`/`refunded`/`partially_refunded`/`failed`
     * cannot be voided again. */
    "payment.not_voidable": { paymentRef: string; state: string };
    /** Thrown by `recordRefund` when the payment is not in a refundable state — only a `captured`
     * or `partially_refunded` payment can be refunded (a voided/failed/fully-refunded one cannot). */
    "payment.not_refundable": { paymentRef: string; state: string };
    /** Thrown by `associatePaymentWithSale` when the payment already has a `sale_id` — the
     * payment↔sale link is write-once, so a second association attempt is rejected rather than
     * re-pointing the payment at a different sale. */
    "payment.already_associated": { paymentRef: string; saleId: string | null };
    /** Raised as an INCIDENT (never thrown) by a `forward` pass when the network refuses a
     * previously offline-accepted payment. The sale already chained and is immutable, so this is a
     * staff-facing uncollected-receivable / bad-debt notice for the till, not a fiscal reversal. */
    "payment.offline_forward_declined": { paymentRef: string; amount: string };
  }
}
