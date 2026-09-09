import { randomUUID } from "node:crypto";
import { AppError, decimal, type Decimal } from "@waitron/shared";
import type { Database, Transaction } from "@waitron/db";
import type {
  CollectParams,
  ForwardResult,
  PaymentProvider,
  PaymentResult,
  ProviderCapabilities,
} from "./provider.js";
import type { PaymentRecord, PaymentRow } from "./store.js";
import {
  findPaymentByRef,
  insertCapturedPayment,
  insertFailedPayment,
  recordRefund,
  recordVoid,
} from "./store.js";

/** A local, database-backed card simulator for Demo and Preparation installations. */
export class SimulatorPaymentProvider implements PaymentProvider {
  readonly provider = "simulator";
  readonly capabilities: ProviderCapabilities = { partialRefund: true };

  constructor(
    private readonly db: Database,
    private readonly tenantId: string,
  ) {}

  async collect(params: CollectParams): Promise<PaymentResult> {
    if (params.tenantId.toLowerCase() !== this.tenantId.toLowerCase()) {
      throw new AppError("payment.not_found", {
        provider: this.provider,
        paymentRef: "<tenant mismatch>",
      });
    }
    const paymentRef = `sim-${randomUUID()}`;
    const declined = params.simulationOutcome === "declined";
    const settledAt = declined ? null : new Date();
    const common = {
      tenantId: params.tenantId,
      workingOrderId: params.workingOrderId,
      provider: this.provider,
      paymentRef,
      amount: params.amount,
    };
    await this.db.transaction(async (tx) => {
      if (declined) await insertFailedPayment(tx, common);
      else await insertCapturedPayment(tx, { ...common, settledAt: settledAt as Date });
    });
    return {
      provider: this.provider,
      paymentRef,
      state: declined ? "failed" : "captured",
      amount: params.amount,
      settledAt,
    };
  }

  forward(now: Date): Promise<ForwardResult> {
    void now;
    return Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
  }

  async void(ref: string): Promise<PaymentResult> {
    const row = await this.db.transaction(async (tx) => {
      const found = await this.require(tx, ref);
      return recordVoid(tx, { tenantId: found.tenantId, provider: this.provider, paymentRef: ref });
    });
    return this.toResult(ref, row);
  }

  async refund(ref: string): Promise<PaymentResult> {
    const row = await this.db.transaction(async (tx) => {
      const found = await this.require(tx, ref);
      return recordRefund(tx, {
        tenantId: found.tenantId,
        provider: this.provider,
        paymentRef: ref,
        amount: decimal(found.amount),
      });
    });
    return this.toResult(ref, row);
  }

  async partialRefund(ref: string, amount: Decimal): Promise<PaymentResult> {
    const row = await this.db.transaction(async (tx) => {
      const found = await this.require(tx, ref);
      return recordRefund(tx, {
        tenantId: found.tenantId,
        provider: this.provider,
        paymentRef: ref,
        amount,
      });
    });
    return { provider: this.provider, paymentRef: ref, state: row.state, amount, settledAt: null };
  }

  private async require(tx: Transaction, ref: string): Promise<PaymentRecord> {
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
