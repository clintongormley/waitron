import { recordIncidentOnce } from "@waitron/core";
import type { Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { DEFAULT_SETTLEMENT_LAG_MS, reconcilePayments } from "@waitron/payments";
import type { PaymentReconcileResult, PaymentReconciler, ReconcilePeriod } from "@waitron/payments";
import type { StripeReportClient } from "./report-client.js";
import { stripeSettlementReport } from "./report-source.js";
import { reverseViaStripe } from "./reverse.js";
import type { StripeRefunder } from "./reverse.js";

const PROVIDER = "stripe";

/** A Checkout Session id's prefix. All three adapters write `provider = "stripe"` and `payments`
 * records no capture mode, so this prefix is what marks a HOSTED row's `external_ref`. */
const SESSION_PREFIX = "cs_";

/** Both surfaces must be built from the SAME account's key, which is why one call resolves them
 * together. */
export interface StripeReconcileAccount {
  report: StripeReportClient;
  refund: StripeRefunder;
}

export interface StripeReconcilerOptions {
  db: Database;
  /** Called per sweep, so a credential rotated while the host runs is picked up without a restart. */
  resolveAccount: () => Promise<StripeReconcileAccount>;
  settlementLagMs?: number;
  /** Forwarded to `reconcilePayments` and `reverseViaStripe`, neither of which reads it. */
  nodeId: string;
}

/** ONE reconciler audits every row written with `provider = "stripe"`, whichever adapter wrote it. */
export class StripeReconciler implements PaymentReconciler {
  readonly provider = PROVIDER;

  constructor(private readonly opts: StripeReconcilerOptions) {}

  async reconcile(period: ReconcilePeriod, now: Date): Promise<PaymentReconcileResult> {
    const account = await this.opts.resolveAccount();
    const settlementLagMs = this.opts.settlementLagMs ?? DEFAULT_SETTLEMENT_LAG_MS;
    return reconcilePayments(
      {
        db: this.opts.db,
        provider: PROVIDER,
        report: stripeSettlementReport(account.report, settlementLagMs),
        reverse: (paymentRef) => this.reverse(account, paymentRef),
        incidents: recordIncidentOnce,
        settlementLagMs,
        nodeId: this.opts.nodeId,
      },
      period,
      now,
    );
  }

  /** A throw from here is caught by `reconcilePayments` and reported as a remediation failure: an
   * unrefunded orphan with an open incident is the safe failure, a double refund is not. */
  private async reverse(account: StripeReconcileAccount, paymentRef: string): Promise<void> {
    await reverseViaStripe(
      this.opts.db,
      account.refund,
      PROVIDER,
      paymentRef,
      "refund",
      undefined,
      {
        nodeId: this.opts.nodeId,
        resolveProcessorRef: (externalRef) =>
          this.processorRef(account.report, externalRef, paymentRef),
      },
    );
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
