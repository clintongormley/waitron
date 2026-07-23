import { AppError, decimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import type { Database, Transaction } from "@waitron/db";
import type {
  CollectParams,
  PaymentProvider,
  PaymentResult,
  ProviderCapabilities,
} from "../provider.js";
import type { PaymentRecord, PaymentRow } from "../store.js";
import {
  findPaymentByRef,
  insertCapturedPayment,
  insertFailedPayment,
  recordRefund,
  recordVoid,
} from "../store.js";

let counter = 0;
const nextRef = (): string => `fake-${String(++counter).padStart(8, "0")}`;

/**
 * A genuine DB-backed test double, not a stub. It persists to the real `payments`/`payment_refunds`
 * tables through short transactions of its own (it takes no caller transaction — the interface
 * forbids it), so the online path, the associate-back, and RLS behave exactly as a real adapter's
 * would. There is no network; a captured result and its persistence share one transaction, and the
 * outcome is deterministic (configurable via `failNextCollect`). NOT re-exported from the package
 * barrel — a production import cannot reach it.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly provider = "fake";
  readonly capabilities: ProviderCapabilities = { partialRefund: true };
  private failNext = false;

  constructor(private readonly db: Database) {}

  /** Test affordance: makes the next `collect` return a `failed` result. */
  failNextCollect(): void {
    this.failNext = true;
  }

  async collect(params: CollectParams): Promise<PaymentResult> {
    const paymentRef = nextRef();
    const willFail = this.failNext;
    this.failNext = false;
    const settledAt = willFail ? null : new Date();
    const common = {
      tenantId: params.tenantId,
      workingOrderId: params.workingOrderId,
      provider: this.provider,
      paymentRef,
      amount: params.amount,
    };
    await this.db.transaction(async (tx) => {
      if (willFail) {
        await insertFailedPayment(tx, common);
      } else {
        await insertCapturedPayment(tx, { ...common, settledAt: settledAt as Date });
      }
    });
    return {
      provider: this.provider,
      paymentRef,
      state: willFail ? "failed" : "captured",
      amount: params.amount,
      settledAt,
    };
  }

  async void(ref: string): Promise<PaymentResult> {
    const row = await this.db.transaction(async (tx) => {
      const found = await this.require(tx, ref);
      return recordVoid(tx, { tenantId: found.tenantId, provider: this.provider, paymentRef: ref });
    });
    return this.toResult(ref, row);
  }

  async refund(ref: string): Promise<PaymentResult> {
    // A full refund returns the whole captured amount (the ordinary case; a prior partial refund
    // would make this exceed and throw, which is correct — use partialRefund for a remainder).
    return this.reverse(ref);
  }

  async partialRefund(ref: string, amount: Decimal): Promise<PaymentResult> {
    return this.reverse(ref, amount);
  }

  private async reverse(ref: string, amount?: Decimal): Promise<PaymentResult> {
    const row = await this.db.transaction(async (tx) => {
      const found = await this.require(tx, ref);
      return recordRefund(tx, {
        tenantId: found.tenantId,
        provider: this.provider,
        paymentRef: ref,
        amount: amount ?? decimal(found.amount),
      });
    });
    return this.toResult(ref, row);
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
