// Side-effect only: registers this package's `payment.*` codes on the shared `ErrorParams`
// registry and keeps ./errors.ts reachable from the public barrel (scripts/errors-reachable.test.ts).
import "./errors.js";
import type { Decimal, TillId, WorkingOrderId } from "@waitron/shared";

/**
 * The lifecycle of one electronic tender, provider-neutral. `attempting` is written before an
 * integrated adapter's network call and resolved after it. `initiated` is a hosted payment minted but
 * not yet paid; the inbound settlement advances it to `captured` or `failed`.
 */
export type PaymentState =
  | "attempting"
  | "captured"
  | "voided"
  | "refunded"
  | "partially_refunded"
  | "failed"
  | "accepted_offline"
  | "settled"
  | "declined"
  | "initiated";

/**
 * `network_unavailable` is reported but never persisted: it is returned when the network is down and
 * offline acceptance is refused, and nothing durable is written.
 */
export type PaymentResultState = PaymentState | "network_unavailable";

export interface ProviderCapabilities {
  partialRefund: boolean;
}

export interface CollectParams {
  tillId: TillId;
  workingOrderId: WorkingOrderId;
  /** Tax-inclusive. Split tender is several `collect` calls against one working order, each with
   * its own amount. */
  amount: Decimal;
  /** The vendor's own id for THIS sale's reader. Supplied per collect so one cached provider serves
   * every reader of a vendor. A server-driven reader provider throws without it; a provider with no
   * server-side reader ignores it. */
  readerRef?: string;
  /** Staff consent to accept this card offline if the network is down (default false). Even when
   * true, the venue's policy must allow it and the amount be within its cap. */
  allowOffline?: boolean;
  /** A local simulator result selected by the practice UI. The server only forwards this field to
   * the simulator; real payment adapters never receive a browser-selected outcome. */
  simulationOutcome?: "captured" | "declined";
}

/**
 * `scheme` is the network as the provider names it (underscores → spaces), NOT a curated set;
 * `authCode` is null when the transaction carries none.
 */
export interface CardDetails {
  scheme: string;
  last4: string;
  entryMode: "contactless" | "chip" | "swipe" | "unknown";
  authCode: string | null;
}

/**
 * `settledAt` feeds `RecordSaleTender.settledAt`: non-null on a `captured` result and on an
 * `accepted_offline` one (the acceptance time, so the sale chains before `forward()` clears it);
 * null on `failed` and `network_unavailable`, where `recordSale` refuses. `paymentRef` is the
 * provider's opaque reference and the key that later associates the payment with the sale.
 */
export interface PaymentResult {
  provider: string;
  paymentRef: string;
  state: PaymentResultState;
  /** The amount this result concerns. For `collect`/`void`/`refund` it is the captured total; for
   * `partialRefund` it is the AMOUNT REFUNDED (not the capture). */
  amount: Decimal;
  /** True only on an `accepted_offline` result, which awaits `forward()`. */
  offline?: boolean;
  settledAt: Date | null;
  /** Present only on a `captured` result whose provider can supply the card facts. */
  card?: CardDetails;
}

/** `nextDueAt` is the only field a scheduler needs (null = nothing pending); the counts are for a
 * log line. */
export interface ForwardResult {
  nextDueAt: Date | null;
  forwarded: number;
  declined: number;
  incidentsRaised: number;
}

/**
 * What `resolveAbandonedAttempt` did to one `attempting` row. `captured`: the row is now captured,
 * with its settlement time and processor reference. `failed`: the row is now failed and nothing was
 * or can still be charged through it; `cancelledAtProvider` says the processor's own payment is
 * cancelled, so the working order's next card payment must not reuse it. `unknown`: the row is
 * untouched — the processor could not be asked (`unreachable`) or answered something that is
 * neither a charge nor a certain refusal (`ambiguous`, with its own status when it gave one).
 */
export type AbandonedAttemptOutcome =
  | { outcome: "captured" }
  | { outcome: "failed"; cancelledAtProvider: boolean }
  | {
      outcome: "unknown";
      reason: "unreachable" | "ambiguous";
      providerStatus?: string;
    };

/** Who asked for `resolveAbandonedAttempt`. */
export interface AbandonedAttemptAudit {
  personId: string;
}

/**
 * No method takes a transaction handle: every method makes a network call, and a database
 * transaction is never held across one. Each does its own short-transaction bookkeeping and returns
 * a `PaymentResult`, which the caller passes into `recordSale` as data.
 *
 * Cash needs no provider: it is recorded directly as a settled tender. `reconcile` lives on
 * `PaymentReconciler` (./reconcile.ts) because the audit is per settlement identity, and a hosted
 * adapter is not a `PaymentProvider` at all.
 */
export interface PaymentProvider {
  readonly provider: string;
  readonly capabilities: ProviderCapabilities;

  /** Single-message card-present purchase (authorize + capture). Returns `captured` on success,
   * `failed` on a network refusal. */
  collect(params: CollectParams): Promise<PaymentResult>;

  /** One pass over this provider's `accepted_offline` rows: `settled` when the network cleared it,
   * `declined` (+ one idempotent uncollected-receivable incident, no fiscal change) when it refused.
   * A provider with no device-local offline queue answers all-zeros. */
  forward(now: Date): Promise<ForwardResult>;

  /** Resolve this provider's `attempting` rows whose outcome `collect` did not learn. One pass: each
   * row is polled at the processor and resolved `captured` or `failed`; a row the processor still
   * reports pending is left for the next pass (`nextDueAt`). `forwarded` counts rows captured,
   * `declined` rows failed. An adapter whose `collect` never leaves a row `attempting` answers
   * all-zeros. */
  resolvePending(now: Date): Promise<ForwardResult>;

  /** Settle one `attempting` row that nothing in this process is still driving — the caller
   * guarantees that — by asking the processor what became of it. A `captured` or `failed` outcome
   * records `audit`'s person in `payment_resolutions` in the same transaction that changes the row:
   * the order's next card payment reads that record to know the processor's payment is cancelled.
   * Throws `payment.not_found` when the row is missing or no longer `attempting`. Absent on an
   * adapter that never leaves such a row for a person to resolve. */
  resolveAbandonedAttempt?(
    paymentRef: string,
    now: Date,
    audit: AbandonedAttemptAudit,
  ): Promise<AbandonedAttemptOutcome>;

  /** Reverse a captured payment in full — a same-day void, distinct from a refund. Throws
   * `payment.not_voidable` if the payment is not `captured`. */
  void(ref: string): Promise<PaymentResult>;

  /** Return the full captured amount. */
  refund(ref: string): Promise<PaymentResult>;

  /** Return part of the captured amount. Throws `payment.refund_exceeds_capture` if the running
   * total of refunds would exceed what was captured. */
  partialRefund(ref: string, amount: Decimal): Promise<PaymentResult>;
}

/**
 * For an OPEN working order. `paymentRef` is the caller's `(provider, payment_ref)` idempotency
 * anchor, so a retried initiate cannot double-insert.
 */
export interface InitiateParams {
  workingOrderId: WorkingOrderId;
  amount: Decimal;
  paymentRef: string;
}

/**
 * `ref` echoes the caller's `paymentRef`; `externalRef` is the hosted-payment id, the ONLY
 * identifier the inbound webhook carries and therefore the settle key; `url` is the hosted payment
 * page, however the app presents it.
 */
export interface InitiateResult {
  ref: string;
  externalRef: string;
  url: string;
}

/**
 * A VERIFIED, parsed inbound settlement event. `settled` advances the payment to `captured`,
 * `expired` to `failed`. `amount` is what actually settled.
 */
export interface InboundSettlement {
  provider: string;
  externalRef: string;
  outcome: "settled" | "expired";
  amount: Decimal;
  settledAt: Date;
}

/**
 * The hosted-payment contract, separate from `PaymentProvider` so synchronous adapters need no
 * `initiate`; an adapter may implement either or both. No method takes a caller transaction:
 * `initiate` does its own short-transaction bookkeeping around its network call, and
 * `verifyAndParse` is a pure verify+decode.
 */
export interface AsyncPaymentProvider {
  readonly provider: string;

  /** Mint a hosted payment and write an `initiated` `payments` row (external_ref = hosted id). */
  initiate(params: InitiateParams): Promise<InitiateResult>;

  /** Verify (signature) + parse a raw inbound event into a neutral settlement. `null` = an event
   * we do not act on; throws on a bad signature. */
  verifyAndParse(payload: string, signature: string): InboundSettlement | null;
}
