import { randomUUID } from "node:crypto";
import type { Decimal, TenantId, TillId } from "@waitron/shared";
import type { Database } from "@waitron/db";
import type {
  CollectParams,
  ForwardResult,
  PaymentProvider,
  PaymentResult,
  ProviderCapabilities,
} from "@waitron/payments";
import { captureAttempting, failAttempting, insertAttempting } from "@waitron/payments";
import type { StripeClient } from "./client.js";
import { reverseViaStripe } from "./reverse.js";

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
 * (superuser) suite and a tenanted caller; the untenanted webhook case is deferred by design.
 *
 * Deliberately carries NO session/PaymentIntent metadata analogous to the hosted create's
 * `metadata` stamp — see `hosted-client.ts`'s `createCheckoutSession` doc for why that stamp exists
 * and why it is Mode-3-only. A maintainer adding one here "for symmetry" would be undoing that
 * decision, not completing it. */
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

  /** Server-driven fixed-counter readers have no device-local offline queue, so a
   * `StripeTerminalProvider` never holds `accepted_offline` payments to forward: the pass is always a
   * no-op. Offline store-and-forward is a property of the on-device SDK mechanism
   * (`StripeOnDeviceProvider`), not of the integrated mode in the abstract. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `now` is part of the interface; a no-op forward ignores it
  forward(_now: Date): Promise<ForwardResult> {
    return Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
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

  void(ref: string): Promise<PaymentResult> {
    return reverseViaStripe(this.opts.db, this.opts.client, PROVIDER, ref, "void");
  }
  refund(ref: string): Promise<PaymentResult> {
    return reverseViaStripe(this.opts.db, this.opts.client, PROVIDER, ref, "refund");
  }
  partialRefund(ref: string, amount: Decimal): Promise<PaymentResult> {
    return reverseViaStripe(this.opts.db, this.opts.client, PROVIDER, ref, "refund", amount);
  }
}
