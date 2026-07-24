import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  AppError,
  saleId as brandSaleId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import type { Database } from "@waitron/db";
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
import { reverseViaStripe } from "./reverse.js";
import type { StripeDeviceClient } from "./device-client.js";

// Same provider id as the server-driven adapter: one Stripe account = one settlement identity for a
// future reconcile. Only THIS provider ever writes `accepted_offline` rows, so forward's
// `provider = 'stripe'` scoping is unambiguous; the server-driven forward is all-zeros.
const PROVIDER = "stripe";
const CURRENCY = "eur";

export interface StripeOnDeviceProviderOptions {
  client: StripeDeviceClient;
  /** Must be a TENANT-SCOPED `Database` handle (sets `app.tenant_id`) — `collect`/`forward`/`reverse`
   * open their own transactions and rely on RLS scoping from this handle. */
  db: Database;
}

/** The real on-device Stripe `PaymentProvider` (Tap-to-Pay / handheld). `collect` applies the neutral
 * offline gate UP FRONT (configuring the device's offline behaviour) and persists the resolved outcome
 * in ONE short transaction — no `attempting`-first, because the device owns its PaymentIntent/offline
 * queue locally (a crash on our side never loses the device's record; the residual gap is reconcile's
 * `missingLocal`), and `network_unavailable` persists nothing. `forward` drives the device-local
 * offline queue T1/T2. Reversals delegate to the shared `reverseViaStripe` (Task 4). */
export class StripeOnDeviceProvider implements PaymentProvider {
  readonly provider = PROVIDER;
  readonly capabilities: ProviderCapabilities = { partialRefund: true };

  constructor(private readonly opts: StripeOnDeviceProviderOptions) {}

  /** Mint a connection token for the device to initialise its on-device SDK. */
  connectionToken(): Promise<{ secret: string }> {
    return this.opts.client.createConnectionToken();
  }

  async collect(params: CollectParams): Promise<PaymentResult> {
    const paymentRef = randomUUID();
    // Gate up front: the neutral policy decides whether offline is permitted for THIS transaction,
    // which configures the device's offline behaviour BEFORE anything is stored.
    const offlineAllowed = await this.opts.db.transaction(async (tx) => {
      const policy = await getPaymentPolicy(tx, params.tenantId);
      return (
        resolveOfflineDecision(policy, params.allowOffline ?? false, params.amount) === "accept"
      );
    });

    const outcome = await this.opts.client.collectOnDevice({
      amount: params.amount,
      currency: CURRENCY,
      idempotencyKey: paymentRef,
      offlineAllowed,
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
      await this.opts.db.transaction((tx) => insertFailedPayment(tx, common));
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
      await this.opts.db.transaction((tx) =>
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
    await this.opts.db.transaction((tx) =>
      insertCapturedPayment(tx, { ...common, settledAt, externalRef: outcome.externalRef }),
    );
    return { provider: PROVIDER, paymentRef, state: "captured", amount: params.amount, settledAt };
  }

  async forward(now: Date): Promise<ForwardResult> {
    // T1 (read, no lock): list our pending offline payments. Never hold a lock across the device sync.
    const pending = await this.opts.db.transaction((tx) => listAcceptedOffline(tx, PROVIDER));
    if (pending.length === 0) {
      return { nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 };
    }

    // Network: ask the device-local offline queue which refs cleared vs. were refused.
    const { settled, declined } = await this.opts.client.syncOfflineQueue(
      pending.map((p) => p.paymentRef),
    );
    const settledSet = new Set(settled);
    const declinedSet = new Set(declined);

    // T2 (write): advance each resolved row (idempotent — matches only rows still accepted_offline)
    // and raise one race-safe incident per decline. Refs still pending on the device are left for a
    // later pass. Under two concurrent forwards the counts may double (both advance the same row, the
    // second a no-op) — a benign log-line inaccuracy the design accepts; the incident count stays
    // exact because recordIncidentOnce reports real inserts.
    return this.opts.db.transaction(async (tx) => {
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
      return { nextDueAt: null, forwarded, declined: declinedCount, incidentsRaised };
    });
  }

  // Reversals delegate to the shared helper (the design's "shared with StripeTerminalProvider, not
  // re-implemented"); the on-device client's `refund` satisfies `StripeRefunder` structurally.
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
