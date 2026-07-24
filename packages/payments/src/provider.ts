// Side-effect only: registers this package's `payment.*` codes on the shared `ErrorParams`
// registry (see ./errors.ts) and keeps errors.ts reachable from the public barrel
// (./errors.reachability.test.ts). Nothing in this file throws — it is types only; ./store.ts and
// ./testing/fake-provider.ts do the throwing — but this is the file the barrel re-exports, so it
// carries the side-effect import.
import "./errors.js";
import type { Decimal, TenantId, TillId, WorkingOrderId } from "@waitron/shared";

/**
 * The lifecycle of one electronic tender as this POS understands it, provider-neutral. 4a covers
 * the online single-message path only: `captured` is the terminal success state, `failed` a
 * network refusal, and `voided`/`refunded`/`partially_refunded` the reversals. `attempting` is the
 * transient in-flight state a network-driving integrated adapter writes before its network call and
 * resolves after (T1/T2) — every integrated adapter has this window, so it is neutral, not
 * adapter-specific. `accepted_offline`/`settled`/`declined` are Cycle A's offline states — present
 * here because this cycle's later tasks give them real behavior (the fake's offline
 * `collect`/`forward`); the `forward` method that drives the transitions between them is now part
 * of the `PaymentProvider` interface below. The two-phase `authorized` state remains a later plan —
 * never reserved here as dead surface.
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
  | "declined";

/**
 * What a `collect` result may REPORT, which is wider than what is PERSISTED: `network_unavailable`
 * is returned when the network is down and offline acceptance is refused, but nothing durable is
 * written (no money moved), so it is deliberately NOT a `payment_state` enum value — it lives only
 * here, on the return path.
 */
export type PaymentResultState = PaymentState | "network_unavailable";

/** What a given provider can do, so the app/UI can gate on it. Grows a flag per capability as the
 * methods that back them land — in 4a the only optional capability is partial refunds. */
export interface ProviderCapabilities {
  partialRefund: boolean;
}

export interface CollectParams {
  tenantId: TenantId;
  tillId: TillId;
  workingOrderId: WorkingOrderId;
  /** Exact decimal, tax-inclusive amount to take on this tender. Split tender is several
   * `collect` calls against one working order, each with its own amount. */
  amount: Decimal;
  /** Per-transaction staff consent to accept this card offline if the network is down (default
   * false). Even when true, acceptance still requires the tenant policy to allow it and the amount
   * to be within the cap — offline is never automatic. */
  allowOffline?: boolean;
}

/**
 * The outcome of one provider operation, returned as DATA (never inside the caller's transaction —
 * see `PaymentProvider`). `settledAt` is what feeds `RecordSaleTender.settledAt`: non-null on a
 * `captured` result (the sale may then chain) and on an `accepted_offline` result (the acceptance
 * time — the sale chains immediately, before `forward()` clears it), null on `failed` and on the
 * return-only `network_unavailable` (the tender stays unsettled and `recordSale` refuses).
 * `paymentRef` is this provider's opaque reference and the join key used to associate the payment
 * with the committed sale afterwards.
 */
export interface PaymentResult {
  provider: string;
  paymentRef: string;
  state: PaymentResultState;
  /** The amount this result concerns. For `collect`/`void`/`refund` it is the captured total; for
   * `partialRefund` it is the AMOUNT REFUNDED (not the capture). */
  amount: Decimal;
  /** True only on an `accepted_offline` result: the card was accepted while the network was down and
   * awaits `forward()`. `settledAt` carries the acceptance time, so the sale chains immediately. */
  offline?: boolean;
  settledAt: Date | null;
}

/**
 * The outcome of one `forward(now)` pass — the offline store-and-forward drain, shaped exactly like
 * fiscal's `DrainResult`. `nextDueAt` is the only field a scheduler needs (null = nothing pending);
 * the counts are for a log line. A provider with nothing pending returns
 * `{ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 }`.
 */
export interface ForwardResult {
  nextDueAt: Date | null;
  forwarded: number;
  declined: number;
  incidentsRaised: number;
}

/**
 * The only thing that crosses between the POS and a payment provider.
 *
 * No method takes a transaction handle — the deliberate opposite of `FiscalBackend.recordSale(tx)`.
 * Every method here makes a network call to the terminal, and holding a DB transaction across a
 * network call is forbidden (T1/T2). Each method does its own short-transaction bookkeeping
 * internally and returns a `PaymentResult`; the caller passes that into `recordSale` as data.
 *
 * Card is the subject. Cash needs no provider (it is recorded directly as a settled tender), so it
 * is deliberately absent. Split tender is N `collect` calls, not a method.
 * `authorize`/`capture`/`preAuth`/`incrementalAuth`/`tipAdjust`/`reconcile` are later plans.
 */
export interface PaymentProvider {
  readonly provider: string;
  readonly capabilities: ProviderCapabilities;

  /** Single-message card-present purchase (authorize + capture). Returns `captured` on success,
   * `failed` on a network refusal. */
  collect(params: CollectParams): Promise<PaymentResult>;

  /** Push previously offline-accepted payments to their terminal state. One pass over this provider's
   * `accepted_offline` rows: `settled` when the network cleared it, `declined` (+ one idempotent
   * uncollected-receivable incident, no fiscal change) when it refused. `nextDueAt` drives the caller's
   * cadence (null = nothing pending). A provider with no device-local offline queue answers all-zeros. */
  forward(now: Date): Promise<ForwardResult>;

  /** Reverse a captured payment in full — a same-day void, distinct from a refund. Throws
   * `payment.not_voidable` if the payment is not `captured`. */
  void(ref: string): Promise<PaymentResult>;

  /** Return the full captured amount. */
  refund(ref: string): Promise<PaymentResult>;

  /** Return part of the captured amount. Throws `payment.refund_exceeds_capture` if the running
   * total of refunds would exceed what was captured. */
  partialRefund(ref: string, amount: Decimal): Promise<PaymentResult>;
}
