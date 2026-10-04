// Side-effect only: registers this package's `payment.*` codes on the shared `ErrorParams`
// registry and keeps ./errors.ts reachable from the public barrel (scripts/errors-reachable.test.ts).
import "./errors.js";
import type { Decimal, DeviceOrigin, WorkingOrderId } from "@waitron/shared";

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
  /** The device the payment is started on, written on the provider's `payments` row. */
  origin: DeviceOrigin;
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
  /** The bill payment this charge is for, absent for a charge of the whole order. Every provider
   * writes it on the first `payments` row it writes for the charge, which is how a pending bill
   * payment is found again from the provider's row after a crash. */
  billPaymentId?: string;
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

/** One refund request for part or all of a captured payment, as the caller has already recorded it. */
export interface RefundSend {
  /** The payment's `external_ref`: what the processor's refund addresses. */
  processorRef: string;
  /** The exact amount to give back, never the whole capture unless that is what was asked. */
  amount: Decimal;
  /** Derived from the caller's own refund record, so a resend of the same record carries it again.
   * Ignored by a processor whose refund takes no key. */
  idempotencyKey: string;
  /** The caller's refund record id. A processor whose refund takes metadata carries it there, so
   * `lookupRefund` can find that refund again by it. */
  refundId: string;
}

/** What a refund's evidence says of it: made, not made, or not yet known. */
export type RefundOutcome = "completed" | "failed" | "pending";

/**
 * The processor's own answer to one refund request, as data; never thrown.
 * - `outcome`: the processor returned its refund record, whose status it maps to an outcome.
 * - `accepted`: the processor took the request and returned no record to read (SumUp's
 *   `201 {}`), so only a lookup can say what became of it.
 * - `refused`: an HTTP refusal. `documented` is true only for a status the processor's own
 *   documentation says means the refund was not made; it settles nothing about an earlier request.
 * - `uncertain`: no answer that says anything — a timeout, a network failure, a server error.
 */
export type RefundAnswer =
  | {
      kind: "outcome";
      outcome: RefundOutcome;
      providerRefundRef: string;
      providerStatus: string;
    }
  | { kind: "accepted" }
  | { kind: "refused"; httpStatus: number; documented: boolean }
  | {
      kind: "uncertain";
      reason: "timeout" | "network" | "server_error";
      httpStatus?: number;
    };

export interface RefundLookupQuery {
  processorRef: string;
  /** The `RefundSend.refundId` the refund was asked for with. */
  refundId: string;
  amount: Decimal;
  /** When the caller first sent the request, by its own clock. */
  sentAt: Date;
  /** Processor refund ids the caller has already recorded against other refunds of this payment. */
  excludeRefs: readonly string[];
  /** `existingRefundRefs` as read just before the first send; absent when no reading was taken. */
  refsBeforeSend?: readonly string[];
}

/** `ambiguous`: more than one processor refund could be this one, or one could be this one or a
 * refund made before it. `unreachable`: the processor could not be asked. */
export type RefundLookup =
  | { kind: "match"; providerRefundRef: string; outcome: RefundOutcome; providerStatus: string }
  | { kind: "none" }
  | { kind: "ambiguous"; candidates: number }
  | { kind: "unreachable" };

/**
 * A lookup's verdict over the processor refunds that could be this one: `none` for none,
 * `ambiguous` for more than one or for one that is `unattributable` (it may be a refund made before
 * this one), else a `match`.
 */
export function refundLookupOf<T>(
  candidates: readonly T[],
  matchOf: (candidate: T) => {
    providerRefundRef: string;
    outcome: RefundOutcome;
    providerStatus: string;
  },
  unattributable = false,
): RefundLookup {
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length > 1 || unattributable) {
    return { kind: "ambiguous", candidates: candidates.length };
  }
  return { kind: "match", ...matchOf(candidates[0]!) };
}

/**
 * No method takes a transaction handle, because a database transaction is never held across a
 * network call. A method returning a `PaymentResult` does its own short-transaction bookkeeping, and
 * the caller passes that result into `recordSale` as data; `sendRefund` records nothing and
 * `lookupRefund` only reads.
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

  /** Ask the processor to refund, recording NOTHING: the caller has written its own record of the
   * attempt before the call and records the outcome after it. Absent on an adapter that offers no
   * such refund. */
  sendRefund?(req: RefundSend): Promise<RefundAnswer>;

  /** Find a refund `sendRefund` asked for, reading the processor only. */
  lookupRefund?(query: RefundLookupQuery): Promise<RefundLookup>;

  /** The ids of every refund the processor holds against the payment, for the caller to read just
   * before a refund's first send; rejects when the processor cannot say. Present where a refund
   * cannot carry `RefundSend.refundId`, so `lookupRefund` needs it to tell an earlier refund from
   * the one sent. */
  existingRefundRefs?(processorRef: string): Promise<string[]>;

  /** How long after the first send a resend with the same key is still answered with the first
   * request's result rather than refunding again; null when a resend is never safe. Read only where
   * `sendRefund` exists. */
  readonly refundResendWindowMs?: number | null;
}

/**
 * For an OPEN working order. `paymentRef` is the caller's `(provider, payment_ref)` idempotency
 * anchor, so a retried initiate cannot double-insert.
 */
export interface InitiateParams {
  /** The device the payment is started on, written on the provider's `payments` row. */
  origin: DeviceOrigin;
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
