import type { Database } from "@waitron/db";
import { currentIncidentsOf, markIncidentHandled, recordIncidentOnce } from "@waitron/core";
import { DEFAULT_SETTLEMENT_LAG_MS, reconcilePayments } from "../reconcile.js";
import type {
  PaymentReconcileResult,
  PaymentReconciler,
  ReconcilePeriod,
  SettlementReportSource,
} from "../reconcile.js";

/** Runs the real sweep, with a given settlement report and a reversal that only records its calls. */
export class FakeReconciler implements PaymentReconciler {
  readonly provider = "fake";
  /** Every payment reference this reconciler was asked to reverse, in order. */
  readonly reversed: string[] = [];

  constructor(
    private readonly db: Database,
    private readonly report: SettlementReportSource,
    private readonly settlementLagMs: number = DEFAULT_SETTLEMENT_LAG_MS,
  ) {}

  async reconcile(period: ReconcilePeriod, now: Date): Promise<PaymentReconcileResult> {
    return reconcilePayments(
      {
        db: this.db,
        provider: this.provider,
        report: this.report,
        reverse: async (paymentRef: string) => {
          this.reversed.push(paymentRef);
        },
        incidents: recordIncidentOnce,
        heldAlerts: {
          raise: recordIncidentOnce,
          current: currentIncidentsOf,
          handle: markIncidentHandled,
        },
        settlementLagMs: this.settlementLagMs,
      },
      period,
      now,
    );
  }
}
