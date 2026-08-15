import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  AppError,
  saleId as brandSaleId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Decimal, TenantId } from "@waitron/shared";
import { withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { workingOrders } from "@waitron/db";
import { recordIncidentOnce } from "@waitron/core";
import type {
  CollectParams,
  ForwardResult,
  PaymentProvider,
  PaymentResult,
  ProviderCapabilities,
} from "@waitron/payments";
import {
  declineForwarded,
  getPaymentPolicy,
  insertAcceptedOffline,
  insertCapturedPayment,
  insertFailedPayment,
  listAcceptedOffline,
  resolveOfflineDecision,
  settleForwarded,
} from "@waitron/payments";
import "./errors.js";
import { reverseViaStripe } from "./reverse.js";
import { workingOrderIdempotencyKey } from "./client.js";
import type { StripeDeviceClient } from "./device-client.js";

// Same provider id as the server-driven adapter: one Stripe account = one settlement identity for a
// future reconcile. Only THIS provider ever writes `accepted_offline` rows, so forward's
// `provider = 'stripe'` scoping is unambiguous; the server-driven forward is all-zeros.
const PROVIDER = "stripe";
const CURRENCY = "eur";
/** How long `forward` asks to wait before re-checking refs the device has not yet resolved. A local
 * constant, not a knob: unlike fiscal's drain — which is paced by AEAT's own `TiempoEsperaEnvio` —
 * nothing on the Stripe side supplies a wait, and an unresolved ref clears when the device regains
 * connectivity rather than on any schedule we control. Five minutes is short enough that recovery
 * is prompt and long enough that a device offline for hours is not polled thousands of times. */
const FORWARD_RETRY_MS = 5 * 60 * 1000;

export interface StripeOnDeviceProviderOptions {
  client: StripeDeviceClient;
  /** A plain `Database` handle. `collect`/`forward`/`reverse` open their own transactions and scope
   * each one with `withTenant(db, tenantId, …)`, so nothing is required of the handle itself.
   *
   * An earlier version of this comment demanded a "TENANT-SCOPED `Database` handle (sets
   * `app.tenant_id`)". No such handle can be built — `withTenant` sets the GUC transaction-locally
   * from inside a transaction it opens itself, and `createPostgresDb` returns an unscoped handle —
   * so under a real non-superuser role this adapter did not work at all:
   *
   *   - `collect` threw `42501` on `insertCapturedPayment`, AFTER `collectOnDevice` had already
   *     taken the customer's money. It failed OPEN: a charge with no local row on every sale, which
   *     is reconcile's `missingLocal`, and an on-device one is unattributed (see the class doc).
   *   - `forward` read `listAcceptedOffline` through the tenant-isolation policy with no GUC set,
   *     matched zero rows and returned all-zeros — silently, no error, for ever.
   *   - the reversals failed closed with `payment.not_found`.
   *
   * PGlite connects as superuser and bypasses FORCE ROW LEVEL SECURITY, so no hermetic suite could
   * show any of it; `device.rls.test.ts` makes the adapter itself the subject. */
  db: Database;
  /** The tenant this provider serves. An on-device provider is a per-till object and a till belongs
   * to exactly one tenant, so the scope is known at construction — which is what lets `forward` and
   * the reversals be scoped at all, since neither carries a tenant in its arguments. The host
   * builds one provider per tenant. */
  tenantId: TenantId;
  /** This node's origin id, threaded into every `withTenant` this adapter opens (`collect`,
   * `forward`, reversals) so the enrolled `payments` INSERT/UPDATE they perform captures a real
   * `sync_log.origin_id` rather than the all-zero sentinel — which the pull loop (keyed on
   * `?originId=<peer>`) never replicates, so a device card payment would be lost on failover (design
   * §4d(B); sync origin attribution). Known at construction like `tenantId` (one node per till). */
  nodeId: string;
}

/** The real on-device Stripe `PaymentProvider` (Tap-to-Pay / handheld). `collect` applies the neutral
 * offline gate UP FRONT (configuring the device's offline behaviour) and persists the resolved outcome
 * in ONE short transaction — no `attempting`-first, because the device owns its PaymentIntent/offline
 * queue locally (a crash on our side never loses the device's record; the residual gap is reconcile's
 * `missingLocal`), and `network_unavailable` persists nothing. `forward` drives the device-local
 * offline queue T1/T2. Reversals delegate to the shared `reverseViaStripe` (Task 4).
 *
 * `collect` STAMPS the same `working_order_id`/`payment_ref` metadata onto the device's PaymentIntent
 * that the hosted create stamps onto its Checkout Session, and for exactly the same reason: writing
 * the row AFTER the money moves means a crash in between leaves a captured charge with no local row —
 * reconcile's `missingLocal`. This mode CAN reach that state; terminal (2a) cannot, because it commits
 * an `attempting` row before its network call. An earlier version of this comment asserted the stamp
 * was Mode-3-only "because terminal and on-device both write `attempting` first" — the sentence two
 * paragraphs above already said otherwise for this class, and the gap it papered over is real.
 *
 * What remains deferred is the READ side only: PaymentIntent metadata does not propagate to the
 * charge, so the audit's main balance-transaction list would need an
 * `expand: ["data.source.payment_intent"]` level to see it, where a hosted session's metadata comes
 * free with the session list the report already fetches. Until that lands, an on-device `missingLocal`
 * is reported but UNATTRIBUTED — no till, so no incident (Slice B §7's deferred list). */
export class StripeOnDeviceProvider implements PaymentProvider {
  readonly provider = PROVIDER;
  readonly capabilities: ProviderCapabilities = { partialRefund: true };

  constructor(private readonly opts: StripeOnDeviceProviderOptions) {}

  /** Mint a connection token for the device to initialise its on-device SDK. */
  connectionToken(): Promise<{ secret: string }> {
    return this.opts.client.createConnectionToken();
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
   * unscoped — the failure that made `collect` charge cards without recording them and `forward` a
   * permanent silent no-op under a real role. */
  private inTenant<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    // `{ nodeId }` so the enrolled `payments` writes below capture this node as the origin — see
    // `StripeOnDeviceProviderOptions.nodeId`.
    return withTenant(this.opts.db, this.opts.tenantId, fn, { nodeId: this.opts.nodeId });
  }

  async collect(params: CollectParams): Promise<PaymentResult> {
    // FIRST — before the policy read and, critically, before `collectOnDevice` takes the money.
    // This class writes its row only after the card is charged, so a mis-wiring caught by the RLS
    // policy instead would be caught one statement too late.
    this.requireOwnTenant(params.tenantId);
    const paymentRef = randomUUID();
    // See `workingOrderIdempotencyKey`'s own doc for the rationale (shared with the terminal
    // provider); `paymentRef` stays the separate, per-attempt random ref that also feeds the
    // `metadata.payment_ref` attribution hint below.
    const stripeIdempotencyKey = workingOrderIdempotencyKey(params.workingOrderId);
    // Gate up front: the neutral policy decides whether offline is permitted for THIS transaction,
    // which configures the device's offline behaviour BEFORE anything is stored.
    const offlineAllowed = await this.inTenant(async (tx) => {
      const policy = await getPaymentPolicy(tx, params.tenantId);
      return (
        resolveOfflineDecision(policy, params.allowOffline ?? false, params.amount) === "accept"
      );
    });

    const outcome = await this.opts.client.collectOnDevice({
      amount: params.amount,
      currency: CURRENCY,
      idempotencyKey: stripeIdempotencyKey,
      offlineAllowed,
      // snake_case: these are Stripe-side field names travelling in Stripe metadata, not our
      // TypeScript — kept distinct from our camelCase `params.workingOrderId`/`paymentRef` on
      // purpose, and identical to the keys the hosted create uses. This is the attribution hint for
      // a settlement whose local row never got written (see the class doc): the row below is the
      // FIRST durable trace of this payment on our side, and it is written after the money moves.
      metadata: { working_order_id: params.workingOrderId, payment_ref: paymentRef },
    });

    const common = {
      tenantId: params.tenantId,
      workingOrderId: params.workingOrderId,
      provider: PROVIDER,
      paymentRef,
      amount: params.amount,
    };

    if (outcome.outcome === "network_unavailable") {
      // No money moved and nothing durable is written (Cycle A's offline-refused semantics).
      return {
        provider: PROVIDER,
        paymentRef,
        state: "network_unavailable",
        amount: params.amount,
        settledAt: null,
      };
    }
    if (outcome.outcome === "declined") {
      await this.inTenant((tx) => insertFailedPayment(tx, common));
      return {
        provider: PROVIDER,
        paymentRef,
        state: "failed",
        amount: params.amount,
        settledAt: null,
      };
    }
    // A captured / stored-offline device payment MUST carry the device's PaymentIntent id: it is the
    // `external_ref` `reverseViaStripe` later reverses against, so persisting one without it writes an
    // irreversible money row. Unreachable today — the fake always supplies a ref and the real
    // binding's `collectOnDevice` throws before returning (coverage-excluded) — so this contract
    // guard is v8-ignored to keep it off the coverage gate, mirroring record-sale.ts's
    // "insert returned no row" unreachable throw.
    /* v8 ignore start */
    if (outcome.externalRef === undefined) {
      throw new Error(
        `stripe device collect returned '${outcome.outcome}' without a PaymentIntent id`,
      );
    }
    /* v8 ignore stop */
    const settledAt = new Date();
    if (outcome.outcome === "accepted_offline") {
      await this.inTenant((tx) =>
        insertAcceptedOffline(tx, { ...common, settledAt, externalRef: outcome.externalRef }),
      );
      return {
        provider: PROVIDER,
        paymentRef,
        state: "accepted_offline",
        amount: params.amount,
        settledAt,
        offline: true,
      };
    }
    // captured (online single-message)
    await this.inTenant((tx) =>
      insertCapturedPayment(tx, { ...common, settledAt, externalRef: outcome.externalRef }),
    );
    return { provider: PROVIDER, paymentRef, state: "captured", amount: params.amount, settledAt };
  }

  async forward(now: Date): Promise<ForwardResult> {
    // T1 (read, no lock): list our pending offline payments. Never hold a lock across the device sync.
    const pending = await this.inTenant((tx) =>
      listAcceptedOffline(tx, this.opts.tenantId, PROVIDER),
    );
    if (pending.length === 0) {
      return { nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 };
    }

    // Network: ask the device-local offline queue which refs cleared vs. were refused.
    const { settled, declined } = await this.opts.client.syncOfflineQueue(
      pending.map((p) => p.paymentRef),
    );
    const settledSet = new Set(settled);
    const declinedSet = new Set(declined);

    // Refs the device resolved neither way — it still holds them. Computed here, off the sets,
    // rather than counted in the write loop below: it is a property of what the device just said,
    // not of anything being written, and `nextDueAt` is the only thing that reads it.
    //
    // `ForwardResult.nextDueAt` means "when to run again; null = nothing pending". This method
    // returned null unconditionally, including for refs its own comment describes as "left for a
    // later pass" — so a host sleeping until the earliest nextDueAt was told there was nothing to
    // come back for, and those rows would stay `accepted_offline` for ever: card revenue accepted
    // while the network was down and never cleared. Nothing calls `forward` yet, which is the only
    // reason it never bit.
    const unresolved = pending.some(
      (p) => !settledSet.has(p.paymentRef) && !declinedSet.has(p.paymentRef),
    );
    const nextDueAt = unresolved ? new Date(now.getTime() + FORWARD_RETRY_MS) : null;

    // Nothing to write: the device resolved none of them. Skipping T2 avoids a BEGIN/COMMIT (and
    // its `set_config`) per pass for exactly the case that now RECURS every FORWARD_RETRY_MS — a
    // device offline through a service would otherwise pay for an empty transaction each time.
    if (settled.length === 0 && declined.length === 0) {
      return { nextDueAt, forwarded: 0, declined: 0, incidentsRaised: 0 };
    }

    // T2 (write): advance each resolved row (idempotent — matches only rows still accepted_offline)
    // and raise one race-safe incident per decline. Under two concurrent forwards the counts may
    // double (both advance the same row, the second a no-op) — a benign log-line inaccuracy the
    // design accepts; the incident count stays exact because recordIncidentOnce reports real
    // inserts.
    return this.inTenant(async (tx) => {
      let forwarded = 0;
      let declinedCount = 0;
      let incidentsRaised = 0;
      for (const p of pending) {
        const key = { tenantId: p.tenantId, provider: PROVIDER, paymentRef: p.paymentRef };
        if (settledSet.has(p.paymentRef)) {
          await settleForwarded(tx, key);
          forwarded += 1;
        } else if (declinedSet.has(p.paymentRef)) {
          await declineForwarded(tx, key);
          declinedCount += 1;
          const [wo] = await tx
            .select({ tillId: workingOrders.tillId })
            .from(workingOrders)
            .where(
              and(eq(workingOrders.tenantId, p.tenantId), eq(workingOrders.id, p.workingOrderId)),
            );
          const raised = await recordIncidentOnce(tx, {
            tenantId: brandTenantId(p.tenantId),
            tillId: brandTillId(wo.tillId),
            ...(p.saleId === null ? {} : { saleId: brandSaleId(p.saleId) }),
            error: new AppError("payment.offline_forward_declined", {
              paymentRef: p.paymentRef,
              amount: p.amount,
            }),
            severity: "error",
            detectedAt: now,
          });
          if (raised) incidentsRaised += 1;
        }
      }
      return { nextDueAt, forwarded, declined: declinedCount, incidentsRaised };
    });
  }

  /** The one place a reversal's tenant scope is derived, for the same reason `inTenant` is the one
   * place a transaction's is. Delegates to the shared `reverseViaStripe` (the design's "shared with StripeTerminalProvider, not re-implemented"); the on-device client's `refund` satisfies `StripeRefunder` structurally.
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
      nodeId: this.opts.nodeId,
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
