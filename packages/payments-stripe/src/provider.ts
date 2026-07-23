import { randomUUID } from "node:crypto";
import { AppError, decimal } from "@waitron/shared";
import type { Decimal, TenantId, TillId } from "@waitron/shared";
import type { Database } from "@waitron/db";
import type {
  CollectParams,
  PaymentProvider,
  PaymentResult,
  ProviderCapabilities,
} from "@waitron/payments";
import {
  assertReversible,
  captureAttempting,
  failAttempting,
  findPaymentByRef,
  insertAttempting,
  recordFailedRefund,
  recordRefund,
  recordVoid,
} from "@waitron/payments";
import type { StripeClient } from "./client.js";

const PROVIDER = "stripe";
const CURRENCY = "eur";
const DEFAULT_POLL = {
  maxAttempts: 60,
  intervalMs: 1000,
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};

export interface StripeTerminalProviderOptions {
  client: StripeClient;
  /** Must be a TENANT-SCOPED `Database` handle (one that sets `app.tenant_id`) — `collect`/`reverse`
   * open their own transactions and rely on RLS scoping from this handle; the untenanted
   * `findPaymentByRef` returns nothing under real RLS with no tenant GUC set. (The untenanted-webhook
   * reversal case is deferred by design.) */
  db: Database;
  resolveReader: (tenantId: TenantId, tillId: TillId) => Promise<string>;
  poll?: { maxAttempts?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> };
}

/** The real Stripe Terminal `PaymentProvider` (server-driven). `collect` polls the reader to
 * completion under T1/T2: a committed `attempting` row (idempotency-uuid `payment_ref`) before the
 * network, the outcome after, PI id in `external_ref`. A stalled reader (poll window exhausted) is
 * cancelled and the payment resolves to `failed` — the caller always gets a `PaymentResult`, never
 * an exception; the `stripe.collect_timeout` code stays declared in `errors.ts` for a future
 * incident. Reversals (void / refund / partialRefund) look the payment up untenanted via
 * `findPaymentByRef` (the interface method carries only a ref) — this works under the hermetic
 * (superuser) suite and a tenanted caller; the untenanted webhook case is deferred by design. */
export class StripeTerminalProvider implements PaymentProvider {
  readonly provider = PROVIDER;
  readonly capabilities: ProviderCapabilities = { partialRefund: true };
  private readonly poll: Required<NonNullable<StripeTerminalProviderOptions["poll"]>>;

  constructor(private readonly opts: StripeTerminalProviderOptions) {
    this.poll = { ...DEFAULT_POLL, ...opts.poll };
  }

  async collect(params: CollectParams): Promise<PaymentResult> {
    const readerId = await this.opts.resolveReader(params.tenantId, params.tillId);
    const paymentRef = randomUUID();
    const key = { tenantId: params.tenantId, provider: PROVIDER, paymentRef };

    // T1 — commit the attempt before any network call.
    await this.opts.db.transaction((tx) =>
      insertAttempting(tx, {
        tenantId: params.tenantId,
        workingOrderId: params.workingOrderId,
        provider: PROVIDER,
        paymentRef,
        amount: params.amount,
      }),
    );

    // Network — outside any transaction (T1/T2).
    const outcome = await this.drive(readerId, params.amount, paymentRef);

    // T2 — persist the terminal outcome.
    const row = await this.opts.db.transaction((tx) =>
      outcome.captured
        ? captureAttempting(tx, { ...key, settledAt: outcome.settledAt, externalRef: outcome.piId })
        : failAttempting(tx, key),
    );
    return {
      provider: PROVIDER,
      paymentRef,
      state: row.state,
      amount: params.amount,
      settledAt: row.settledAt === null ? null : new Date(row.settledAt),
    };
  }

  /** Drive the reader from PaymentIntent creation through to a terminal outcome, entirely outside a
   * DB transaction. Returns `{ captured: true, ... }` on success and `{ captured: false }` on every
   * failure mode — a network error at ANY step (create, process, or the poll loop itself, including a
   * stalled `sleep`), a declined reader, or a timeout. A timeout or a caught error both cancel the
   * in-flight reader action first (best-effort) so the terminal is not left mid-action; either way the
   * outcome is DATA that `collect`'s T2 turns into a `failed` row — `drive`/`collect` never throw for
   * a terminal-interaction failure. */
  private async drive(
    readerId: string,
    amount: Decimal,
    paymentRef: string,
  ): Promise<{ captured: true; settledAt: Date; piId: string } | { captured: false }> {
    try {
      const intent = await this.opts.client.createPaymentIntent({
        amount,
        currency: CURRENCY,
        idempotencyKey: paymentRef,
      });
      const piId = intent.id;
      await this.opts.client.processPaymentIntent(readerId, piId);

      for (let attempt = 0; attempt < this.poll.maxAttempts; attempt++) {
        const o = await this.opts.client.readerOutcome(readerId);
        if (o.status === "succeeded") return { captured: true, settledAt: new Date(), piId };
        if (o.status === "failed") return { captured: false };
        await this.poll.sleep(this.poll.intervalMs);
      }
      // Timed out — cancel the reader action (best-effort), then fail the payment. The row is resolved
      // to `failed` by `collect`'s T2; `stripe.collect_timeout` is NOT thrown out of `collect`.
      await this.opts.client.cancelReaderAction(readerId).catch(() => {});
      return { captured: false };
    } catch {
      // A network error at create/process time OR mid-poll (readerOutcome/sleep) → failed. Best-effort
      // cancel so the terminal isn't left mid-action; the attempt row is recoverable via collect's T2.
      await this.opts.client.cancelReaderAction(readerId).catch(() => {});
      return { captured: false };
    }
  }

  async void(ref: string): Promise<PaymentResult> {
    return this.reverse(ref, "void");
  }
  async refund(ref: string): Promise<PaymentResult> {
    return this.reverse(ref, "refund");
  }
  async partialRefund(ref: string, amount: Decimal): Promise<PaymentResult> {
    return this.reverse(ref, "refund", amount);
  }

  /** Common reversal path for `void`/`refund`/`partialRefund`: look the payment up untenanted (see
   * the class doc), read-only pre-check that it is locally reversible, call `stripe.refunds`
   * (Stripe's own API for both a void and a refund — a void is just a full refund with no `amount`),
   * and persist the outcome. A refund Stripe REFUSES records a `payment_refunds` failure row and
   * leaves the payment's own state untouched; a refund/void Stripe accepts transitions the payment
   * via `recordVoid`/`recordRefund`. On success, `partialRefund` reports the amount REFUNDED and
   * `refund`/`void` report the captured amount (mirrors `PaymentResult.amount`'s doc). On a FAILED
   * reversal the payment state is unchanged (still `captured`/`partially_refunded` — no money moved)
   * and `amount` instead echoes the ATTEMPTED amount: the requested partial amount, or the capture
   * total for a full refund/void. Reversal `settledAt` is always null — only `collect` settles a
   * tender.
   *
   * The find + `assertReversible` pre-check run in ONE read transaction (T1) BEFORE the network call,
   * so an invalid local state (e.g. a second `void` against an already-voided payment) fails fast
   * without ever calling Stripe — the earlier bug this guards against is a full `refund()` racing
   * ahead of `recordRefund`'s validation: Stripe would refund the remainder (succeeding, since Stripe
   * has no notion of the local ledger), then the local write threw `refund_exceeds_capture`, leaving
   * Stripe over-refunded vs. the local ledger. `assertReversible` mirrors `recordVoid`/`recordRefund`'s
   * checks read-only (no lock); those remain the authoritative FOR UPDATE checks (T2, after the
   * network call) — a concurrent reversal slipping between this read and the write is bounded by
   * their lock and audited by reconcile. */
  private async reverse(
    ref: string,
    kind: "void" | "refund",
    amount?: Decimal,
  ): Promise<PaymentResult> {
    const found = await this.opts.db.transaction(async (tx) => {
      const f = await findPaymentByRef(tx, PROVIDER, ref);
      if (f === undefined || f.externalRef === null) {
        throw new AppError("payment.not_found", { provider: PROVIDER, paymentRef: ref });
      }
      // Narrowed to a local before the `await` below — TS drops property narrowing across a
      // function call (it could, in principle, mutate `f`), so re-assert it via the object spread.
      const externalRef = f.externalRef;
      await assertReversible(tx, {
        tenantId: f.tenantId,
        provider: PROVIDER,
        paymentRef: ref,
        kind,
        amount,
      });
      return { ...f, externalRef };
    });
    const key = { tenantId: found.tenantId, provider: PROVIDER, paymentRef: ref };

    const outcome = await this.opts.client.refund({
      paymentIntentId: found.externalRef,
      ...(amount ? { amount } : {}),
      // A fresh idempotency id per reversal: each reverse() is a distinct idempotent Stripe
      // operation, so two INDEPENDENT equal partial refunds each issue a real refund rather than
      // one replaying the other and silently diverging the local ledger. Retry-safety for the SAME
      // logical reversal (a caller re-issuing after a network blip) needs a persisted per-reversal id
      // threaded from the caller — deferred with the identity/async-events work; today a caller must
      // not blind-retry a reversal, and reconcile (4d) backstops any Stripe-vs-local drift.
      idempotencyKey: randomUUID(),
    });

    if (outcome.status === "failed") {
      await this.opts.db.transaction((tx) =>
        recordFailedRefund(tx, { ...key, amount: amount ?? decimal(found.amount) }),
      );
      return {
        provider: PROVIDER,
        paymentRef: ref,
        state: found.state,
        amount: amount ?? decimal(found.amount), // failed partial reports the ATTEMPTED amount
        settledAt: null,
      };
    }

    // Any non-"failed" status (including "pending") is treated OPTIMISTICALLY as accepted — the
    // payment transitions to refunded/voided NOW. Confirmation of async refund settlement is the
    // deferred webhook path (async-events/reconcile); no behavior change here.
    const row = await this.opts.db.transaction((tx) =>
      kind === "void"
        ? recordVoid(tx, key)
        : recordRefund(tx, { ...key, amount: amount ?? decimal(found.amount) }),
    );
    return {
      provider: PROVIDER,
      paymentRef: ref,
      state: row.state,
      amount: amount ?? decimal(row.amount), // partialRefund reports the refunded amount
      settledAt: null,
    };
  }
}
