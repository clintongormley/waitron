import { randomUUID } from "node:crypto";
import type { Decimal } from "@waitron/shared";
import { withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type {
  CollectParams,
  ForwardResult,
  PaymentProvider,
  PaymentResult,
  ProviderCapabilities,
} from "@waitron/payments";
import {
  countProviderCancelledResolutions,
  insertCapturedPayment,
  insertFailedPayment,
} from "@waitron/payments";
import "./errors.js";
import { reverseViaStripe } from "./reverse.js";
import { billPaymentIdempotencyKey, workingOrderIdempotencyKey } from "./client.js";
import type { StripeDeviceClient } from "./device-client.js";

const PROVIDER = "stripe";
const CURRENCY = "eur";
export interface StripeOnDeviceProviderOptions {
  client: StripeDeviceClient;
  db: Database;
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
    const { stripeIdempotencyKey } = await this.inTransaction(async (tx) => {
      const cancelled = await countProviderCancelledResolutions(tx, {
        provider: PROVIDER,
        workingOrderId: params.workingOrderId,
      });
      return {
        stripeIdempotencyKey:
          params.billPaymentId === undefined
            ? workingOrderIdempotencyKey(params.workingOrderId, cancelled)
            : billPaymentIdempotencyKey(params.billPaymentId),
      };
    });

    const outcome = await this.opts.client.collectOnDevice({
      amount: params.amount,
      currency: CURRENCY,
      idempotencyKey: stripeIdempotencyKey,
      // The same Stripe-side keys the hosted create stamps.
      metadata: { working_order_id: params.workingOrderId, payment_ref: paymentRef },
    });

    const common = {
      origin: params.origin,
      workingOrderId: params.workingOrderId,
      nodeId: params.nodeId,
      provider: PROVIDER,
      paymentRef,
      amount: params.amount,
      billPaymentId: params.billPaymentId,
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
    await this.inTransaction((tx) =>
      insertCapturedPayment(tx, { ...common, settledAt, externalRef: outcome.externalRef }),
    );
    return { provider: PROVIDER, paymentRef, state: "captured", amount: params.amount, settledAt };
  }

  /** This adapter never writes an `attempting` row. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `now` is part of the interface
  resolvePending(_now: Date): Promise<ForwardResult> {
    return Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
  }

  private reverse(kind: "void" | "refund", ref: string, amount?: Decimal): Promise<PaymentResult> {
    return reverseViaStripe(this.opts.db, this.opts.client, PROVIDER, ref, kind, amount);
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
