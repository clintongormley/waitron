import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { AppError, saleId as brandSaleId, tillId as brandTillId } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { withTransaction } from "@waitron/db";
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
  countProviderCancelledResolutions,
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

// Shared with the other Stripe adapters: one account is one settlement identity. `forward` can scope
// by it because only this adapter writes `accepted_offline` rows.
const PROVIDER = "stripe";
const CURRENCY = "eur";
/** Stripe supplies no retry interval: an unresolved ref clears when the device regains
 * connectivity, on no schedule we control. */
const FORWARD_RETRY_MS = 5 * 60 * 1000;

export interface StripeOnDeviceProviderOptions {
  client: StripeDeviceClient;
  db: Database;
  /** Passed to `reverseViaStripe`, which does not read it. */
  nodeId: string;
}

/** The on-device (Tap-to-Pay) Stripe `PaymentProvider`. `collect` writes its row AFTER the money
 * moves, with no `attempting` row first, so a crash in between leaves a captured charge with no local
 * row — reconcile's `missingLocal`. That is why it stamps attribution metadata on the PaymentIntent.
 * The settlement report does not read that metadata back yet, so such a settlement is reported but
 * not attributed to a till. */
export class StripeOnDeviceProvider implements PaymentProvider {
  readonly provider = PROVIDER;
  readonly capabilities: ProviderCapabilities = { partialRefund: true };

  constructor(private readonly opts: StripeOnDeviceProviderOptions) {}

  connectionToken(): Promise<{ secret: string }> {
    return this.opts.client.createConnectionToken();
  }

  /** Guard: `tenant-scoping.test.ts` refuses a bare `.transaction(` in this package's sources. */
  private inTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(this.opts.db, fn);
  }

  async collect(params: CollectParams): Promise<PaymentResult> {
    const paymentRef = randomUUID();
    // Decided before the collect, because it configures the device's offline behaviour.
    const { offlineAllowed, stripeIdempotencyKey } = await this.inTransaction(async (tx) => {
      const policy = await getPaymentPolicy(tx);
      const cancelled = await countProviderCancelledResolutions(tx, {
        provider: PROVIDER,
        workingOrderId: params.workingOrderId,
      });
      return {
        offlineAllowed:
          resolveOfflineDecision(policy, params.allowOffline ?? false, params.amount) === "accept",
        stripeIdempotencyKey: workingOrderIdempotencyKey(params.workingOrderId, cancelled),
      };
    });

    const outcome = await this.opts.client.collectOnDevice({
      amount: params.amount,
      currency: CURRENCY,
      idempotencyKey: stripeIdempotencyKey,
      offlineAllowed,
      // The same Stripe-side keys the hosted create stamps.
      metadata: { working_order_id: params.workingOrderId, payment_ref: paymentRef },
    });

    const common = {
      workingOrderId: params.workingOrderId,
      provider: PROVIDER,
      paymentRef,
      amount: params.amount,
    };

    if (outcome.outcome === "network_unavailable") {
      // No money moved, so nothing is written.
      return {
        provider: PROVIDER,
        paymentRef,
        state: "network_unavailable",
        amount: params.amount,
        settledAt: null,
      };
    }
    if (outcome.outcome === "declined") {
      await this.inTransaction((tx) => insertFailedPayment(tx, common));
      return {
        provider: PROVIDER,
        paymentRef,
        state: "failed",
        amount: params.amount,
        settledAt: null,
      };
    }
    // Without the PaymentIntent id the row could never be reversed. Unreachable today: the fake
    // always supplies one and the real binding's `collectOnDevice` throws.
    /* v8 ignore start */
    if (outcome.externalRef === undefined) {
      throw new Error(
        `stripe device collect returned '${outcome.outcome}' without a PaymentIntent id`,
      );
    }
    /* v8 ignore stop */
    const settledAt = new Date();
    if (outcome.outcome === "accepted_offline") {
      await this.inTransaction((tx) =>
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
    await this.inTransaction((tx) =>
      insertCapturedPayment(tx, { ...common, settledAt, externalRef: outcome.externalRef }),
    );
    return { provider: PROVIDER, paymentRef, state: "captured", amount: params.amount, settledAt };
  }

  async forward(now: Date): Promise<ForwardResult> {
    // Never hold a lock across the device sync.
    const pending = await this.inTransaction((tx) => listAcceptedOffline(tx, PROVIDER));
    if (pending.length === 0) {
      return { nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 };
    }

    const { settled, declined } = await this.opts.client.syncOfflineQueue(
      pending.map((p) => p.paymentRef),
    );
    const settledSet = new Set(settled);
    const declinedSet = new Set(declined);

    // Refs the device resolved neither way. A null `nextDueAt` would tell the host there is nothing
    // to come back for, stranding those rows in `accepted_offline`.
    const unresolved = pending.some(
      (p) => !settledSet.has(p.paymentRef) && !declinedSet.has(p.paymentRef),
    );
    const nextDueAt = unresolved ? new Date(now.getTime() + FORWARD_RETRY_MS) : null;

    if (settled.length === 0 && declined.length === 0) {
      return { nextDueAt, forwarded: 0, declined: 0, incidentsRaised: 0 };
    }

    // Under two concurrent forwards `forwarded` and `declined` may double-count; `incidentsRaised`
    // stays exact because `recordIncidentOnce` reports real inserts.
    return this.inTransaction(async (tx) => {
      let forwarded = 0;
      let declinedCount = 0;
      let incidentsRaised = 0;
      for (const p of pending) {
        const key = { provider: PROVIDER, paymentRef: p.paymentRef };
        if (settledSet.has(p.paymentRef)) {
          await settleForwarded(tx, key);
          forwarded += 1;
        } else if (declinedSet.has(p.paymentRef)) {
          await declineForwarded(tx, key);
          declinedCount += 1;
          const [wo] = await tx
            .select({ tillId: workingOrders.tillId })
            .from(workingOrders)
            .where(eq(workingOrders.id, p.workingOrderId));
          const raised = await recordIncidentOnce(tx, {
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

  /** This adapter never writes an `attempting` row. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `now` is part of the interface
  resolvePending(_now: Date): Promise<ForwardResult> {
    return Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
  }

  private reverse(kind: "void" | "refund", ref: string, amount?: Decimal): Promise<PaymentResult> {
    return reverseViaStripe(this.opts.db, this.opts.client, PROVIDER, ref, kind, amount, {
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
