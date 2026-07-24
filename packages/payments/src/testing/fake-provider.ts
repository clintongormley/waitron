import { and, eq } from "drizzle-orm";
import { AppError, decimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { recordIncidentOnce } from "@waitron/core";
import {
  saleId as brandSaleId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Database, Transaction } from "@waitron/db";
import { workingOrders } from "@waitron/db";
import type {
  CollectParams,
  ForwardResult,
  PaymentProvider,
  PaymentResult,
  ProviderCapabilities,
} from "../provider.js";
import type { PaymentRecord, PaymentRow } from "../store.js";
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
  private offlineNext = false;
  private readonly declineForwardRefs = new Set<string>();

  constructor(private readonly db: Database) {}

  /** Test affordance: makes the next `collect` return a `failed` result. */
  failNextCollect(): void {
    this.failNext = true;
  }

  /** Test affordance: makes the next `collect` simulate a network outage, so it exercises the
   * offline gate (accept → accepted_offline, or refuse → network_unavailable) instead of an online
   * capture. One-shot, like `failNextCollect`. */
  offlineNextCollect(): void {
    this.offlineNext = true;
  }

  /** Test affordance: the next `forward` will DECLINE (network-refuse) this payment ref instead of
   * settling it, exercising the decline → incident path. */
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

  /**
   * The offline store-and-forward drain: claim this provider's `accepted_offline` rows (FOR UPDATE
   * SKIP LOCKED) and advance each. Refs flagged via `declineForwardFor` are declined (→ `declined`,
   * plus one idempotent uncollected-receivable incident for the till); all others settle (→
   * `settled`). No network here, so claim + advance + incident share one transaction; a real adapter
   * (Cycle B) splits them T1/T2. `nextDueAt` is null — the fake has nothing time-scheduled.
   */
  async forward(now: Date): Promise<ForwardResult> {
    return this.db.transaction(async (tx) => {
      const claimed = await claimAcceptedOffline(tx, this.provider);
      let forwarded = 0;
      let declined = 0;
      let incidentsRaised = 0;
      for (const p of claimed) {
        const key = { tenantId: p.tenantId, provider: this.provider, paymentRef: p.paymentRef };
        if (this.declineForwardRefs.has(p.paymentRef)) {
          await declineForwarded(tx, key);
          declined += 1;
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
        } else {
          await settleForwarded(tx, key);
          forwarded += 1;
        }
      }
      return { nextDueAt: null, forwarded, declined, incidentsRaised };
    });
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

  /** Unlike `refund`, reports the amount REFUNDED (not the capture) — see `PaymentResult.amount`'s
   * doc. */
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

  private async reverse(ref: string): Promise<PaymentResult> {
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

  /** The offline branch of `collect`: read the tenant policy, apply the neutral gate. On "accept"
   * write an `accepted_offline` row (settledAt = acceptance time) and report `offline: true`; on
   * "refuse" write NOTHING and report `network_unavailable` (no money moved). */
  private async collectOffline(params: CollectParams, paymentRef: string): Promise<PaymentResult> {
    return this.db.transaction(async (tx) => {
      const policy = await getPaymentPolicy(tx, params.tenantId);
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
        tenantId: params.tenantId,
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
