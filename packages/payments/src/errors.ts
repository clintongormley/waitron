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
    /** Raised as an INCIDENT (never thrown) by a reconcile sweep: payments we believe settled that
     * the processor's report still shows nothing for, past the in-flight tolerance. AGGREGATED —
     * one incident per (till, code) carrying every payment, because the open-incident dedup index
     * keys on `(tenant, till, code, sale_id)` and these rows share a null sale_id, so N same-key
     * rows would silently collapse into one (the PR #25 lesson, applied deliberately here).
     * `settledAt` is ISO-8601 (never null: a row only reaches this class once it is `captured` or
     * `settled`, and both states always stamp `settled_at` at insert time). */
    "payment.reconcile_unsettled": {
      payments: { paymentRef: string; amount: string; settledAt: string }[];
      count: number;
    };
    /** Reconcile INCIDENT: a payment still `initiated` locally that the processor reports as paid —
     * a missed or late inbound settlement. Not auto-healed: advancing it would need the sale to be
     * chained, which is app-level orchestration. Aggregated per till, as above. */
    "payment.reconcile_lost_settlement": {
      payments: { paymentRef: string; amount: string; workingOrderId: string }[];
      count: number;
    };
    /** Reconcile INCIDENT: money captured against a working order that is settled or abandoned but
     * carries no sale. `remediating` is true when this sweep claimed the payment for reversal — the
     * marker is stamped in T2, BEFORE the reversal is attempted, so `true` here means "this sweep is
     * reversing it", not "this sweep succeeded"; a claimed-but-refused reversal still reads
     * `remediating: true` and separately raises `payment.reconcile_remediation_failed`. On a SETTLED
     * order the orphan is never claimed at all — it may be a lost association, where refunding would
     * hand back money for an invoice the customer owes, so it is reported for a human instead; nor is
     * a payment in the `settled` STATE, which has no reversal path at all, so claiming it would stamp
     * a permanent marker for a reversal that cannot happen. Aggregated per till. */
    "payment.reconcile_orphan": {
      payments: {
        paymentRef: string;
        amount: string;
        workingOrderId: string;
        workingOrderStatus: string;
        remediating: boolean;
      }[];
      count: number;
    };
    /** Reconcile INCIDENT: the processor reports a settlement we hold no payment row for, at any
     * time, in any state — silent data loss. Only raised when the settlement carried our own
     * identifiers back (the `hint`), because an incident needs a till and an unattributable
     * settlement has none; unattributable ones are reported in the result instead. */
    "payment.reconcile_missing_local": {
      settlements: {
        references: string[];
        amount: string;
        settledAt: string;
        paymentRef: string;
      }[];
      count: number;
    };
    /** Reconcile INCIDENT: the processor settled a DIFFERENT amount than we captured. The AMOUNT is
     * never auto-corrected — a human decides. Note this does not veto an orphan reversal: a row that
     * is both an orphan on an abandoned order and a drift is still reversed, at OUR amount, because
     * returning most of the money beats returning none; this incident carries both figures so the
     * remainder is visible. Aggregated per till. */
    "payment.reconcile_drift": {
      payments: { paymentRef: string; captured: string; settled: string }[];
      count: number;
    };
    /** Reconcile INCIDENT: one or more orphan auto-reversals were attempted this sweep and the
     * processor refused (or the payment could not be addressed at all). Aggregated per till, for the
     * same reason `payment.reconcile_orphan` and its siblings are: these payments have a null
     * `sale_id` by definition (that is what makes them orphans), so N same-key incidents racing for
     * one open-incident dedup slot (`tenant, till, code, sale_id`) would silently collapse to one,
     * dropping every failure but the first. Each entry's `reason` is a structured code — the failed
     * reversal's `AppError` code, or the literal `"unknown"` for a non-`AppError` failure — never
     * prose. The remediation marker is already stamped for every payment named here, so none of them
     * will be retried by a later sweep; this incident is a human's to resolve. */
    "payment.reconcile_remediation_failed": {
      payments: { paymentRef: string; amount: string; reason: string }[];
      count: number;
    };
  }
}
