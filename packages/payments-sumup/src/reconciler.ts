import { withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { listAuditCandidates, reconcilePayments } from "@waitron/payments";
import type {
  HeldAlertSink,
  IncidentSink,
  PaymentReconciler,
  ReconcilePeriod,
} from "@waitron/payments";
import type { SumUpClient } from "./client.js";
import { sumupSettlementReport } from "./report-source.js";

export class SumUpReconciler implements PaymentReconciler {
  readonly provider = "sumup";
  constructor(
    private readonly deps: {
      db: Database;
      resolveClient: () => Promise<SumUpClient>;
      incidents: IncidentSink;
      heldAlerts: HeldAlertSink;
    },
  ) {}
  async reconcile(period: ReconcilePeriod, now: Date) {
    const client = await this.deps.resolveClient();
    const candidates = await withTransaction(this.deps.db, (tx) =>
      listAuditCandidates(tx, this.provider, period),
    );
    const report = sumupSettlementReport(client, candidates);
    const result = await reconcilePayments(
      {
        ...this.deps,
        provider: this.provider,
        report,
        mode: "audit-only",
        settlementLagMs: 0,
      },
      period,
      now,
    );
    return {
      ...result,
      unlinkedCharges:
        report.unreadableUnlinked +
        result.missingLocal.filter((row) => row.workingOrderId === null).length,
      ...(candidates.some((row) => row.state === "attempting")
        ? { resweepAfter: new Date(now.getTime() + 86_400_000) }
        : {}),
    };
  }
}
