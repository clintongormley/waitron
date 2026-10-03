import { eq } from "drizzle-orm";
import { AppError, decimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { recordIncidentOnce } from "@waitron/core";
import { saleId as brandSaleId, tillId as brandTillId } from "@waitron/shared";
import type { Database, Transaction } from "@waitron/db";
import { workingOrders } from "@waitron/db";
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
  RefundOutcome,
  RefundSend,
} from "../provider.js";
import type { PaymentRow } from "../store.js";
import { recordAttemptResolution } from "../resolutions.js";
import {
  captureAttempting,
  claimAcceptedOffline,
  declineForwarded,
  failAttempting,
  findPaymentByRef,
  getPaymentByRef,
  insertAcceptedOffline,
  insertAttempting,
  insertCapturedPayment,
  insertFailedPayment,
  recordRefund,
  recordVoid,
  settleForwarded,
} from "../store.js";
import { getPaymentPolicy, resolveOfflineDecision } from "../policy.js";

let counter = 0;
const nextRef = (): string => `fake-${String(++counter).padStart(8, "0")}`;
let refundCounter = 0;
const nextRefundRef = (): string => `fake-re-${String(++refundCounter).padStart(8, "0")}`;

/** A refund the fake processor holds. */
interface MadeRefund {
  ref: string;
  idempotencyKey: string;
  refundId: string;
  outcome: RefundOutcome;
  status: string;
}

const STATUS_OF: Record<RefundOutcome, string> = {
  completed: "succeeded",
  failed: "failed",
  pending: "pending",
};

/** What the next `sendRefund` does: whether the processor makes a refund, in which state, and what
 * it answers — the made refund's own record (`"made"`), a throw after making it (`"throw"`), or a
 * given answer. */
export interface RefundScript {
  made: RefundOutcome | false;
  status?: string;
  answer: RefundAnswer | "made" | "throw";
}

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
  private stallNext = false;
  private crashNext: "captured" | "attempting" | null = null;
  private holdNext: Promise<void> | null = null;
  /** Every `collect` call, in order, recorded as it starts. */
  readonly collectCalls: CollectParams[] = [];
  private readonly declineForwardRefs = new Set<string>();
  private abandonedAnswer: AbandonedAttemptOutcome = { outcome: "unknown", reason: "unreachable" };
  /** Every `resolveAbandonedAttempt` call, in order. */
  readonly abandonedAttemptCalls: { paymentRef: string; now: Date }[] = [];
  /** Every `sendRefund` call, in order, recorded as it starts. */
  readonly refundCalls: RefundSend[] = [];
  /** Every `lookupRefund` call, in order. */
  readonly lookupCalls: RefundLookupQuery[] = [];
  refundResendWindowMs: number | null = 24 * 60 * 60 * 1000;
  /** Absent, as on a processor whose refunds carry the caller's id; a test sets it. */
  existingRefundRefs?: (processorRef: string) => Promise<string[]>;
  private readonly madeRefunds: MadeRefund[] = [];
  private refundScripts: RefundScript[] = [];
  private lookupScript: RefundLookup | null = null;
  private holdRefund: Promise<void> | null = null;

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

  /** Test affordance: the next `collect` leaves its row `attempting` and answers `attempting`, as a
   * reader that stopped answering does. One-shot. */
  stallNextCollect(): void {
    this.stallNext = true;
  }

  /** Test affordance: the next `collect` writes its row in `state` and then throws, as a process
   * that died after the provider wrote and before the caller heard back. One-shot. */
  crashNextCollect(state: "captured" | "attempting"): void {
    this.crashNext = state;
  }

  /** Test affordance: the next `collect` records its call and then waits, writing nothing, until the
   * returned function is called. One-shot. */
  holdNextCollect(): () => void {
    let release!: () => void;
    this.holdNext = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  /** Test affordance: the next `forward` DECLINES this payment ref instead of settling it. */
  declineForwardFor(ref: string): void {
    this.declineForwardRefs.add(ref);
  }

  /** Test affordance: what every later `resolveAbandonedAttempt` answers and does to the row, until
   * scripted again. Unscripted, it answers `unknown`/`unreachable` and touches nothing. */
  scriptAbandonedAttempt(answer: AbandonedAttemptOutcome): void {
    this.abandonedAnswer = answer;
  }

  /** Test affordance: what the next `sendRefund` does. Queued, one per call; unscripted, a send makes
   * a completed refund and answers its record, and a resend with a key already used answers the
   * refund that key made. */
  scriptNextRefund(script: RefundScript): void {
    this.refundScripts.push(script);
  }

  /** Test affordance: every `lookupRefund` answers this until called again with null. */
  scriptLookups(answer: RefundLookup | null): void {
    this.lookupScript = answer;
  }

  /** Test affordance: the next `sendRefund` records its call and then waits, doing nothing, until the
   * returned function is called. One-shot. */
  holdNextRefund(): () => void {
    let release!: () => void;
    this.holdRefund = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  async sendRefund(req: RefundSend): Promise<RefundAnswer> {
    this.refundCalls.push(req);
    const hold = this.holdRefund;
    this.holdRefund = null;
    if (hold !== null) await hold;
    const script = this.refundScripts.shift();
    if (script === undefined) {
      const earlier = this.madeRefunds.find((r) => r.idempotencyKey === req.idempotencyKey);
      return this.answerOf(earlier ?? this.make(req, "completed"));
    }
    const made = script.made === false ? undefined : this.make(req, script.made, script.status);
    if (script.answer === "throw") {
      throw new Error("fake provider: the process stopped after the processor refunded");
    }
    if (script.answer === "made") {
      if (made === undefined) throw new Error("fake provider: answer 'made' needs a made refund");
      return this.answerOf(made);
    }
    return script.answer;
  }

  lookupRefund(query: RefundLookupQuery): Promise<RefundLookup> {
    this.lookupCalls.push(query);
    if (this.lookupScript !== null) return Promise.resolve(this.lookupScript);
    const found = this.madeRefunds.filter((r) => r.refundId === query.refundId);
    if (found.length === 0) return Promise.resolve({ kind: "none" });
    if (found.length > 1) return Promise.resolve({ kind: "ambiguous", candidates: found.length });
    const [refund] = found;
    return Promise.resolve({
      kind: "match",
      providerRefundRef: refund!.ref,
      outcome: refund!.outcome,
      providerStatus: refund!.status,
    });
  }

  private make(req: RefundSend, outcome: RefundOutcome, status?: string): MadeRefund {
    const made: MadeRefund = {
      ref: nextRefundRef(),
      idempotencyKey: req.idempotencyKey,
      refundId: req.refundId,
      outcome,
      status: status ?? STATUS_OF[outcome],
    };
    this.madeRefunds.push(made);
    return made;
  }

  private answerOf(made: MadeRefund): RefundAnswer {
    return {
      kind: "outcome",
      outcome: made.outcome,
      providerRefundRef: made.ref,
      providerStatus: made.status,
    };
  }

  async collect(params: CollectParams): Promise<PaymentResult> {
    this.collectCalls.push(params);
    const hold = this.holdNext;
    this.holdNext = null;
    if (hold !== null) await hold;
    const paymentRef = nextRef();
    if (this.offlineNext) {
      this.offlineNext = false;
      return this.collectOffline(params, paymentRef);
    }
    const common = {
      origin: params.origin,
      workingOrderId: params.workingOrderId,
      provider: this.provider,
      paymentRef,
      amount: params.amount,
      billPaymentId: params.billPaymentId,
    };
    const crash = this.crashNext;
    this.crashNext = null;
    if (crash !== null) {
      await this.db.transaction((tx) =>
        crash === "captured"
          ? insertCapturedPayment(tx, { ...common, settledAt: new Date() })
          : insertAttempting(tx, common),
      );
      throw new Error(`fake provider: the process stopped after writing a ${crash} row`);
    }
    if (this.stallNext) {
      this.stallNext = false;
      await this.db.transaction((tx) => insertAttempting(tx, common));
      return {
        provider: this.provider,
        paymentRef,
        state: "attempting",
        amount: params.amount,
        settledAt: null,
      };
    }
    const willFail = this.failNext;
    this.failNext = false;
    const settledAt = willFail ? null : new Date();
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

  async resolveAbandonedAttempt(
    paymentRef: string,
    now: Date,
    audit: AbandonedAttemptAudit,
  ): Promise<AbandonedAttemptOutcome> {
    this.abandonedAttemptCalls.push({ paymentRef, now });
    const answer = this.abandonedAnswer;
    const key = { provider: this.provider, paymentRef };
    await this.db.transaction(async (tx) => {
      const row = await getPaymentByRef(tx, key);
      if (row?.state !== "attempting") throw new AppError("payment.not_found", key);
      if (answer.outcome === "unknown") return;
      if (answer.outcome === "captured") {
        await captureAttempting(tx, {
          ...key,
          settledAt: now,
          externalRef: `fake-ext-${paymentRef}`,
        });
      } else {
        await failAttempting(tx, key);
      }
      await recordAttemptResolution(tx, key, {
        personId: audit.personId,
        outcome: answer.outcome,
        cancelledAtProvider: answer.outcome === "failed" && answer.cancelledAtProvider,
        providerStatus: null,
        resolvedAt: now,
      });
    });
    return answer;
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
        origin: params.origin,
        workingOrderId: params.workingOrderId,
        provider: this.provider,
        paymentRef,
        amount: params.amount,
        settledAt,
        billPaymentId: params.billPaymentId,
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
