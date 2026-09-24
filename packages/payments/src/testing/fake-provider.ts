import { eq } from "drizzle-orm";
import { AppError, decimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { recordIncidentOnce } from "@waitron/core";
import { saleId as brandSaleId, tillId as brandTillId } from "@waitron/shared";
import type { Database, Transaction } from "@waitron/db";
import { workingOrders } from "@waitron/db";
import type {
  CollectParams,
  ForwardResult,
  PaymentProvider,
  PaymentResult,
  ProviderCapabilities,
} from "../provider.js";
import type { PaymentRow } from "../store.js";
import {
  claimAcceptedOffline,
  declineForwarded,
  findPaymentByRef,
  insertAcceptedOffline,
  insertCapturedPayment,
  insertFailedPayment,
  recordRefund,
  recordVoid,
  settleForwarded,
} from "../store.js";
import { getPaymentPolicy, resolveOfflineDecision } from "../policy.js";

let counter = 0;
const nextRef = (): string => `fake-${String(++counter).padStart(8, "0")}`;

/**
 * A DB-backed test double, not a stub: it persists to the real `payments`/`payment_refunds` tables,
 * so the associate-back and foreign keys behave as a real adapter's would. There is no network, and
 * the outcome is deterministic.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly provider = "fake";
  readonly capabilities: ProviderCapabilities = { partialRefund: true };
  private failNext = false;
  private offlineNext = false;
  private readonly declineForwardRefs = new Set<string>();

  constructor(private readonly db: Database) {}

  /** Test affordance: makes the next `collect` return a `failed` result. */
  failNextCollect(): void {
    this.failNext = true;
  }

  /** Test affordance: makes the next `collect` simulate a network outage, so it exercises the
   * offline gate instead of an online capture. One-shot. */
  offlineNextCollect(): void {
    this.offlineNext = true;
  }

  /** Test affordance: the next `forward` DECLINES this payment ref instead of settling it. */
  declineForwardFor(ref: string): void {
    this.declineForwardRefs.add(ref);
  }

  async collect(params: CollectParams): Promise<PaymentResult> {
    const paymentRef = nextRef();
    if (this.offlineNext) {
      this.offlineNext = false;
      return this.collectOffline(params, paymentRef);
    }
    const willFail = this.failNext;
    this.failNext = false;
    const settledAt = willFail ? null : new Date();
    const common = {
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

  /**
   * No network here, so claim + advance + incident share one transaction; a real adapter must not
   * hold one across its processor call. The claim is this transaction, not a clause — see
   * `claimAcceptedOffline` in `../store.ts`.
   */
  async forward(now: Date): Promise<ForwardResult> {
    return this.db.transaction(async (tx) => {
      const claimed = await claimAcceptedOffline(tx, this.provider);
      let forwarded = 0;
      let declined = 0;
      let incidentsRaised = 0;
      for (const p of claimed) {
        const key = { provider: this.provider, paymentRef: p.paymentRef };
        if (this.declineForwardRefs.has(p.paymentRef)) {
          await declineForwarded(tx, key);
          declined += 1;
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
        } else {
          await settleForwarded(tx, key);
          forwarded += 1;
        }
      }
      return { nextDueAt: null, forwarded, declined, incidentsRaised };
    });
  }

  resolvePending(now: Date): Promise<ForwardResult> {
    void now;
    return Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
  }

  async void(ref: string): Promise<PaymentResult> {
    const row = await this.db.transaction(async (tx) => {
      await this.require(tx, ref);
      return recordVoid(tx, { provider: this.provider, paymentRef: ref });
    });
    return this.toResult(ref, row);
  }

  async refund(ref: string): Promise<PaymentResult> {
    // After a prior partial refund this exceeds the capture and throws, which is correct.
    return this.reverse(ref);
  }

  async partialRefund(ref: string, amount: Decimal): Promise<PaymentResult> {
    const row = await this.db.transaction(async (tx) => {
      await this.require(tx, ref);
      return recordRefund(tx, {
        provider: this.provider,
        paymentRef: ref,
        amount,
      });
    });
    return { provider: this.provider, paymentRef: ref, state: row.state, amount, settledAt: null };
  }

  private async reverse(ref: string): Promise<PaymentResult> {
    const row = await this.db.transaction(async (tx) => {
      const found = await this.require(tx, ref);
      return recordRefund(tx, {
        provider: this.provider,
        paymentRef: ref,
        amount: decimal(found.amount),
      });
    });
    return this.toResult(ref, row);
  }

  /** On "refuse" writes NOTHING and reports `network_unavailable`. */
  private async collectOffline(params: CollectParams, paymentRef: string): Promise<PaymentResult> {
    return this.db.transaction(async (tx) => {
      const policy = await getPaymentPolicy(tx);
      const decision = resolveOfflineDecision(policy, params.allowOffline ?? false, params.amount);
      if (decision === "refuse") {
        return {
          provider: this.provider,
          paymentRef,
          state: "network_unavailable",
          amount: params.amount,
          settledAt: null,
        };
      }
      const settledAt = new Date();
      await insertAcceptedOffline(tx, {
        workingOrderId: params.workingOrderId,
        provider: this.provider,
        paymentRef,
        amount: params.amount,
        settledAt,
      });
      return {
        provider: this.provider,
        paymentRef,
        state: "accepted_offline",
        amount: params.amount,
        settledAt,
        offline: true,
      };
    });
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
