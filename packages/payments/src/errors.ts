// A bare side-effect import: it makes TypeScript treat "@waitron/shared" as a real module to
// augment rather than declaring a fresh ambient one.
import "@waitron/shared";

/**
 * Why the sweep is, or is not, reversing one orphaned payment; the gates and their reasons are in
 * `./reconcile.ts`'s claim loop.
 */
export type OrphanRemediation =
  /** The marker is stamped BEFORE the network call, so this means "is reversing it", NOT
   * "succeeded": a refused reversal still reads `claimed` and raises
   * `payment.reconcile_remediation_failed`. */
  | "claimed"
  | "workingOrderNotAbandoned"
  | "stateNotCaptured"
  | "amountDrifted"
  /** An earlier sweep, or a concurrent one that won the race, already owns the reversal. */
  | "alreadyClaimed";

declare module "@waitron/shared" {
  interface ErrorParams {
    "payment.not_found": { provider: string; paymentRef: string };
    "payment.refund_exceeds_capture": {
      paymentRef: string;
      captured: string;
      requested: string;
      alreadyRefunded: string;
    };
    "payment.not_voidable": { paymentRef: string; state: string };
    "payment.not_refundable": { paymentRef: string; state: string };
    /** The payment↔sale link is write-once: a second association is refused rather than
     * re-pointing the payment at a different sale. */
    "payment.already_associated": { paymentRef: string; saleId: string | null };
    /** An INCIDENT, never thrown. The sale already chained and is immutable, so this is an
     * uncollected-receivable notice for the till, not a fiscal reversal. */
    "payment.offline_forward_declined": { paymentRef: string; amount: string };
    /** An INCIDENT, never thrown: the processor's outcome is neither a capture nor a certain
     * refusal. The row is resolved `failed` so the sweep terminates; the incident is what makes a
     * human look. */
    "payment.pending_outcome_unactionable": { paymentRef: string; status: string };
    /** The reconcile incidents are AGGREGATED, one per (till, code) carrying every payment: the
     * open-incident dedup index keys on `(till, code, sale_id)` and these incidents carry no
     * `sale_id`, so one incident per payment would collapse into one. */
    "payment.reconcile_unsettled": {
      payments: { paymentRef: string; amount: string; settledAt: string }[];
      count: number;
    };
    /** Not auto-healed: advancing it would need the sale to be chained, which is app-level
     * orchestration. */
    "payment.reconcile_lost_settlement": {
      payments: { paymentRef: string; amount: string; workingOrderId: string }[];
      count: number;
    };
    "payment.reconcile_orphan": {
      payments: {
        paymentRef: string;
        amount: string;
        workingOrderId: string;
        workingOrderStatus: string;
        remediation: OrphanRemediation;
      }[];
      count: number;
    };
    /** Raised only for a settlement that carried our own identifiers back: an incident needs a
     * till, so unattributable ones are reported in the sweep's result instead. */
    "payment.reconcile_missing_local": {
      settlements: {
        references: string[];
        amount: string;
        settledAt: string;
        paymentRef: string;
      }[];
      count: number;
    };
    /** The amount is never auto-corrected; a human decides. */
    "payment.reconcile_drift": {
      payments: { paymentRef: string; captured: string; settled: string }[];
      count: number;
    };
    /** `reason` is the failed reversal's `AppError` code, or `"unknown"`; never prose. The
     * remediation marker is already stamped for every payment named here, so no later sweep retries
     * them. */
    "payment.reconcile_remediation_failed": {
      payments: { paymentRef: string; amount: string; reason: string }[];
      count: number;
    };
    /** Never carries the rejected key. Registered here, not in an adapter package, because both
     * the SumUp and Stripe seats throw it. */
    "payment.provider_credential_rejected": { providerId: string };
    "payment.provider_duplicate": { providerId: string };
    "payment.provider_unknown": { providerId: string };
  }
}
