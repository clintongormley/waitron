import { randomUUID } from "node:crypto";
import { AppError } from "@waitron/shared";
import type { Decimal, TenantId, TillId } from "@waitron/shared";
import { withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type {
  CollectParams,
  ForwardResult,
  PaymentProvider,
  PaymentResult,
  ProviderCapabilities,
} from "@waitron/payments";
import { captureAttempting, failAttempting, insertAttempting } from "@waitron/payments";
import type { StripeClient } from "./client.js";
import "./errors.js";
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
  /** A plain `Database` handle. This adapter opens its own transactions and scopes each one with
   * `withTenant(db, tenantId, …)`, so nothing is required of the handle itself.
   *
   * This option once demanded a "TENANT-SCOPED `Database` handle", which cannot be constructed —
   * see `StripeOnDeviceProviderOptions.db` for the mechanism and
   * `2026-07-26-provider-tenant-scoping-design.md` for the full account. Here it meant `collect`
   * failed on `insertAttempting` with `42501` under any real role, on every sale. It failed CLOSED
   * (T1 precedes the reader network call, so no money moved), which is the only reason this
   * adapter's version was less serious than the on-device one. `stripe.rls.test.ts` is the proof. */
  db: Database;
  /** The tenant this provider serves. A terminal provider is a per-till object and a till belongs
   * to exactly one tenant, so the scope is known at construction — which is what makes every
   * database phase below scopable without threading a tenant through methods (`void`/`refund`
   * carry only a payment reference). The host builds one provider per tenant. */
  tenantId: TenantId;
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

  /** The tenant this provider serves — the single source of truth for scope. A method-supplied
   * tenant is VALIDATED against it; the two are equal thereafter, so which one the writes below
   * use does not matter (they use `params`, unchanged).
   *
   * That is the rule, not an exception: an object with a per-tenant identity scopes from that
   * identity, and an object without one (`StripeHostedProvider`, whose only database method is
   * `initiate`) scopes from its parameters. Both are "the tenant is established exactly once, as
   * early as it is known".
   *
   * Compared case-INSENSITIVELY. `tenantId()` validates the UUID shape with a case-insensitive
   * pattern and returns the value unchanged, so a host reading `A1B2…` from config and a caller
   * carrying `a1b2…` from a database read hold the same tenant in Postgres's eyes and different
   * strings in JavaScript's. A `!==` here would reject every sale on that till.
   *
   * Throws `stripe.tenant_mismatch` BEFORE any network call. Leaving the disagreement to the
   * isolation policy's WITH CHECK would be too late on the on-device path — see the code's doc. */
  private requireOwnTenant(supplied: TenantId): void {
    if (supplied.toLowerCase() !== this.opts.tenantId.toLowerCase()) {
      throw new AppError("stripe.tenant_mismatch", {
        expected: this.opts.tenantId,
        supplied,
      });
    }
  }

  /** Every database phase runs through here, so no transaction this adapter opens can be left
   * unscoped — the failure that made `collect` throw `42501` on every sale under a real role. */
  private inTenant<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(this.opts.db, this.opts.tenantId, fn);
  }

  async collect(params: CollectParams): Promise<PaymentResult> {
    this.requireOwnTenant(params.tenantId);
    const readerId = await this.opts.resolveReader(params.tenantId, params.tillId);
    const paymentRef = randomUUID();
    const key = { tenantId: params.tenantId, provider: PROVIDER, paymentRef };

    // T1 — commit the attempt before any network call.
    await this.inTenant((tx) =>
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
    const row = await this.inTenant((tx) =>
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

  /** The one place a reversal's tenant scope is derived, for the same reason `inTenant` is the one
   * place a transaction's is. The three public methods below differ only in kind and amount.
   *
   * Supplying `tenantId` is what makes a reversal work at all: `reverseViaStripe` opens with the
   * untenanted `findPaymentByRef`, which under a real role matches zero rows with no GUC set, so
   * every reversal failed closed with `payment.not_found` for a payment sitting right there.
   * `reverse.ts` diagnosed exactly that, then defaulted these callers to omitting the option
   * because their options "already REQUIRE a tenant-scoped handle" — the requirement that could
   * not be met. */
  private reverse(kind: "void" | "refund", ref: string, amount?: Decimal): Promise<PaymentResult> {
    return reverseViaStripe(this.opts.db, this.opts.client, PROVIDER, ref, kind, amount, {
      tenantId: this.opts.tenantId,
    });
  }

  void(ref: string): Promise<PaymentResult> {
    return this.reverse("void", ref);
  }
  refund(ref: string): Promise<PaymentResult> {
    return this.reverse("refund", ref);
  }
  partialRefund(ref: string, amount: Decimal): Promise<PaymentResult> {
    return this.reverse("refund", ref, amount);
  }
}
