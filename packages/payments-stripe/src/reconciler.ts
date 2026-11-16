import { currentIncidentsOf, markIncidentHandled, recordIncidentOnce } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { AppError, decimal, jobOrigin } from "@waitron/shared";
import {
  DEFAULT_SETTLEMENT_LAG_MS,
  reconcilePayments,
  listAbandonedRefundOutcomes,
  getPaymentByRef,
  recordRefund,
  recordFailedRefund,
} from "@waitron/payments";
import type { PaymentReconcileResult, PaymentReconciler, ReconcilePeriod } from "@waitron/payments";
import type { StripeReportClient } from "./report-client.js";
import { stripeSettlementReport } from "./report-source.js";
import { lookupStripeRefund, sendStripeRefund } from "./refund.js";
import type { StripeRefundClient } from "./refund.js";

const PROVIDER = "stripe";

/** A Checkout Session id's prefix. All three adapters write `provider = "stripe"` and `payments`
 * records no capture mode, so this prefix is what marks a HOSTED row's `external_ref`. */
const SESSION_PREFIX = "cs_";

/** Both surfaces must be built from the SAME account's key, which is why one call resolves them
 * together. */
export interface StripeReconcileAccount {
  report: StripeReportClient;
  refund: StripeRefundClient;
}

export interface StripeReconcilerOptions {
  db: Database;
  /** Called per sweep, so a credential rotated while the host runs is picked up without a restart. */
  resolveAccount: () => Promise<StripeReconcileAccount>;
  settlementLagMs?: number;
}

/** ONE reconciler audits every row written with `provider = "stripe"`, whichever adapter wrote it. */
export class StripeReconciler implements PaymentReconciler {
  readonly provider = PROVIDER;

  constructor(private readonly opts: StripeReconcilerOptions) {}

  async reconcile(period: ReconcilePeriod, now: Date): Promise<PaymentReconcileResult> {
    const account = await this.opts.resolveAccount();
    const settlementLagMs = this.opts.settlementLagMs ?? DEFAULT_SETTLEMENT_LAG_MS;
    const marked = await withTransaction(this.opts.db, (tx) =>
      listAbandonedRefundOutcomes(tx, PROVIDER, undefined, true),
    );
    let recovered = 0;
    const unconfirmed: string[] = [];
    const failures: { paymentRef: string; amount: string; reason: string }[] = [];
    for (const row of marked) {
      if (row.outcome === "confirmed" || row.hasFailedRefund) continue;
      try {
        if ((await this.reverse(account, row, now)) === "unconfirmed")
          unconfirmed.push(row.paymentRef);
        else recovered++;
      } catch (error) {
        failures.push({
          paymentRef: row.paymentRef,
          amount: row.amount,
          reason: error instanceof AppError ? error.code : "unknown",
        });
      }
    }
    let retry = false;
    const result = await reconcilePayments(
      {
        db: this.opts.db,
        provider: PROVIDER,
        report: stripeSettlementReport(account.report, settlementLagMs),
        reverse: async (paymentRef) => {
          const [row] = await withTransaction(this.opts.db, (tx) =>
            listAbandonedRefundOutcomes(tx, PROVIDER, paymentRef),
          );
          const answer = await this.reverse(account, row!, now);
          if (answer === "unconfirmed") retry = true;
          return answer;
        },
        incidents: recordIncidentOnce,
        heldAlerts: {
          raise: recordIncidentOnce,
          current: currentIncidentsOf,
          handle: markIncidentHandled,
        },
        settlementLagMs,
      },
      period,
      now,
    );
    result.remediated += recovered;
    result.remediationFailures.push(
      ...failures.map(({ paymentRef, reason }) => ({ paymentRef, reason })),
    );
    if (unconfirmed.length) (result.remediationUnconfirmed ??= []).push(...unconfirmed);
    if (
      failures.length &&
      (await withTransaction(this.opts.db, (tx) =>
        recordIncidentOnce(tx, {
          origin: jobOrigin("payment_check"),
          error: new AppError("payment.reconcile_remediation_failed", {
            count: failures.length,
            payments: failures,
          }),
          severity: "error",
          detectedAt: now,
        }),
      ))
    )
      result.incidentsRaised++;
    if (retry) result.resweepAfter = new Date(now.getTime() + 3_600_000);
    return result;
  }

  private async reverse(
    account: StripeReconcileAccount,
    row: Awaited<ReturnType<typeof listAbandonedRefundOutcomes>>[number],
    now: Date,
  ): Promise<void | "unconfirmed"> {
    const { paymentRef } = row;
    const key = { provider: PROVIDER, paymentRef };
    const finish = async (failed: boolean, providerRefundRef?: string) => {
      // Provider calls run outside the write lock; a concurrent sweep may have recorded the result.
      await withTransaction(this.opts.db, async (tx) => {
        const [current] = await listAbandonedRefundOutcomes(tx, PROVIDER, paymentRef);
        const payment = await getPaymentByRef(tx, key);
        if (payment?.state !== "captured" || current!.hasFailedRefund) return;
        if (failed) await recordFailedRefund(tx, { ...key, amount: decimal(row.amount) });
        else
          await recordRefund(tx, {
            ...key,
            amount: decimal(row.amount),
            providerRefundRef,
            at: now,
          });
      });
    };
    let processorRef;
    try {
      processorRef = await this.processorRef(account.report, row.externalRef!, paymentRef);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "payment.not_found") return "unconfirmed";
      await finish(true);
      throw error;
    }
    const query = {
      processorRef,
      refundId: row.paymentId,
      amount: decimal(row.amount),
      sentAt: new Date(row.claimedAt!),
      excludeRefs: [],
    };
    const held = await lookupStripeRefund(account.refund, query, "reconcile_payment_id", true);
    let answer;
    if (held.kind === "match") answer = { ...held, kind: "outcome" as const };
    else {
      const age = now.getTime() - Date.parse(row.claimedAt!);
      if (held.kind !== "none" || age < 0 || age >= 86_400_000) return "unconfirmed";
      answer = await sendStripeRefund(
        account.refund,
        {
          processorRef,
          refundId: row.paymentId,
          amount: decimal(row.amount),
          idempotencyKey: `sr_${row.paymentId}`,
        },
        "reconcile_payment_id",
        true,
      );
    }
    if (answer.kind === "outcome" && answer.outcome === "completed") {
      await finish(false, answer.providerRefundRef);
      return;
    }
    if (
      (answer.kind === "outcome" && answer.outcome === "failed") ||
      (answer.kind === "refused" && answer.documented)
    ) {
      await finish(true);
      throw new Error("Stripe refund failed");
    }
    return "unconfirmed";
  }

  /** A session with no PaymentIntent was never paid, so there is nothing to refund: `not_found`
   * rather than a success that would report a refund that never happened. */
  private async processorRef(
    report: StripeReportClient,
    externalRef: string,
    paymentRef: string,
  ): Promise<string> {
    if (!externalRef.startsWith(SESSION_PREFIX)) return externalRef;
    const paymentIntentId = await report.paymentIntentForSession(externalRef);
    if (paymentIntentId === null) {
      throw new AppError("payment.not_found", { provider: PROVIDER, paymentRef });
    }
    return paymentIntentId;
  }
}
