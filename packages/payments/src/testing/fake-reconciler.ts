import type { Database } from "@waitron/db";
import { recordIncidentOnce } from "@waitron/core";
import type { TenantId } from "@waitron/shared";
import { DEFAULT_SETTLEMENT_LAG_MS, reconcilePayments } from "../reconcile.js";
import type {
  PaymentReconcileResult,
  PaymentReconciler,
  ReconcilePeriod,
  SettlementReportSource,
} from "../reconcile.js";

/**
 * A genuine DB-backed `PaymentReconciler` double, not a stub: it runs the REAL sweep against the
 * real tables, with a simulated settlement report and a reversal that only records what it was
 * asked to reverse. That is the point of the ported design — the fake proves the shipping
 * algorithm, never a second copy of it. NOT re-exported from the package barrel.
 */
export class FakeReconciler implements PaymentReconciler {
  readonly provider = "fake";
  /** Every payment reference this reconciler was asked to reverse, in order. */
  readonly reversed: string[] = [];

  constructor(
    private readonly db: Database,
    private readonly report: SettlementReportSource,
    private readonly settlementLagMs: number = DEFAULT_SETTLEMENT_LAG_MS,
  ) {}

  async reconcile(
    tenantId: TenantId,
    period: ReconcilePeriod,
    now: Date,
  ): Promise<PaymentReconcileResult> {
    return reconcilePayments(
      {
        db: this.db,
        provider: this.provider,
        report: this.report,
        reverse: async (paymentRef: string) => {
          this.reversed.push(paymentRef);
        },
        incidents: recordIncidentOnce,
        settlementLagMs: this.settlementLagMs,
        // The all-zero origin sentinel: this DB-backed double is not a provisioned node, and no suite
        // using it asserts on captured origin (sync origin attribution is proven in the server suite).
        nodeId: "00000000-0000-0000-0000-000000000000",
      },
      tenantId,
      period,
      now,
    );
  }
}
