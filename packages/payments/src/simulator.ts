import { randomUUID } from "node:crypto";
import { AppError, decimal, type Decimal } from "@waitron/shared";
import { withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type {
  AbandonedAttemptAudit,
  AbandonedAttemptOutcome,
  CollectParams,
  ForwardResult,
  PaymentProvider,
  PaymentResult,
  ProviderCapabilities,
  RefundAnswer,
  RefundLookup,
  RefundLookupQuery,
  RefundSend,
} from "./provider.js";
import { refundLookupOf } from "./provider.js";
import { recordAttemptResolution } from "./resolutions.js";
import type { PaymentRow } from "./store.js";
import {
  failAttempting,
  findPaymentByRef,
  insertAttempting,
  insertCapturedPayment,
  insertFailedPayment,
  recordRefund,
  recordVoid,
} from "./store.js";

/** A local, database-backed card simulator for Demo and Preparation installations. */
export class SimulatorPaymentProvider implements PaymentProvider {
  readonly provider = "simulator";
  readonly capabilities: ProviderCapabilities = { partialRefund: true };
  /** Its refunds live in this process only, so after a restart a lookup finds none of them and a
   * resend could not be matched to the first. */
  readonly refundResendWindowMs = null;
  private readonly refundsByKey = new Map<string, { ref: string; refundId: string }>();
  constructor(private readonly db: Database) {}

  sendRefund(req: RefundSend): Promise<RefundAnswer> {
    let refund = this.refundsByKey.get(req.idempotencyKey);
    if (refund === undefined) {
      refund = { ref: `sim-re-${randomUUID()}`, refundId: req.refundId };
      this.refundsByKey.set(req.idempotencyKey, refund);
    }
    return Promise.resolve({
      kind: "outcome",
      outcome: "completed",
      providerRefundRef: refund.ref,
      providerStatus: "succeeded",
    });
  }

  lookupRefund(query: RefundLookupQuery): Promise<RefundLookup> {
    const found = [...this.refundsByKey.values()].find((r) => r.refundId === query.refundId);
    return Promise.resolve(
      refundLookupOf(found === undefined ? [] : [found], (refund) => ({
        providerRefundRef: refund.ref,
        outcome: "completed",
        providerStatus: "succeeded",
      })),
    );
  }

  async collect(params: CollectParams): Promise<PaymentResult> {
    const simulationOutcome = params.simulationOutcome;
    const paymentRef = `sim-${randomUUID()}`;
    const declined = simulationOutcome === "declined";
    const unanswered = simulationOutcome === "attempting";
    const settledAt = declined || unanswered ? null : new Date();
    const common = {
      origin: params.origin,
      workingOrderId: params.workingOrderId,
      nodeId: params.nodeId,
      provider: this.provider,
      paymentRef,
      amount: params.amount,
      billPaymentId: params.billPaymentId,
    };
    await withTransaction(this.db, async (tx) => {
      if (unanswered) await insertAttempting(tx, common);
      else if (declined) await insertFailedPayment(tx, common);
      else await insertCapturedPayment(tx, { ...common, settledAt: settledAt as Date });
    });
    return {
      provider: this.provider,
      paymentRef,
      state: unanswered ? "attempting" : declined ? "failed" : "captured",
      amount: params.amount,
      settledAt,
    };
  }

  resolvePending(now: Date): Promise<ForwardResult> {
    void now;
    return Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
  }

  async resolveAbandonedAttempt(
    paymentRef: string,
    now: Date,
    audit: AbandonedAttemptAudit,
  ): Promise<AbandonedAttemptOutcome> {
    return withTransaction(this.db, async (tx) => {
      const key = { provider: this.provider, paymentRef };
      await failAttempting(tx, key);
      await recordAttemptResolution(tx, key, {
        personId: audit.personId,
        outcome: "failed",
        cancelledAtProvider: false,
        providerStatus: null,
        resolvedAt: now,
      });
      return { outcome: "failed", cancelledAtProvider: false };
    });
  }

  async void(ref: string): Promise<PaymentResult> {
    const row = await withTransaction(this.db, async (tx) => {
      await this.require(tx, ref);
      return recordVoid(tx, { provider: this.provider, paymentRef: ref });
    });
    return this.toResult(ref, row);
  }

  async refund(ref: string): Promise<PaymentResult> {
    const row = await withTransaction(this.db, async (tx) => {
      const found = await this.require(tx, ref);
      return recordRefund(tx, {
        provider: this.provider,
        paymentRef: ref,
        amount: decimal(found.amount),
      });
    });
    return this.toResult(ref, row);
  }

  async partialRefund(ref: string, amount: Decimal): Promise<PaymentResult> {
    const row = await withTransaction(this.db, async (tx) => {
      await this.require(tx, ref);
      return recordRefund(tx, {
        provider: this.provider,
        paymentRef: ref,
        amount,
      });
    });
    return { provider: this.provider, paymentRef: ref, state: row.state, amount, settledAt: null };
  }

  private async require(tx: Transaction, ref: string): Promise<PaymentRow> {
    const found = await findPaymentByRef(tx, this.provider, ref);
    if (found === undefined) {
      throw new AppError("payment.not_found", { provider: this.provider, paymentRef: ref });
    }
    return found;
  }

  private toResult(ref: string, row: PaymentRow): PaymentResult {
    return {
      provider: this.provider,
      paymentRef: ref,
      state: row.state,
      amount: decimal(row.amount),
      settledAt: row.settledAt === null ? null : new Date(row.settledAt),
    };
  }
}
