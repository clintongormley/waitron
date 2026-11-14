import { withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { compareDecimal } from "@waitron/shared";
import {
  existingReferences,
  listAuditCandidates,
  listBackupPayments,
  reconcilePayments,
} from "@waitron/payments";
import type {
  BackupPaymentMatch,
  BackupPaymentUnmatched,
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
    const pad = (ms: number) => ({
      from: new Date(period.from.getTime() - ms),
      to: new Date(period.to.getTime() + ms),
    });
    const { candidates, nearbyCandidates, manual } = await withTransaction(
      this.deps.db,
      async (tx) => ({
        candidates: await listAuditCandidates(tx, this.provider, period),
        nearbyCandidates: await listAuditCandidates(tx, this.provider, pad(600_000)),
        manual: await listBackupPayments(tx, pad(300_000)),
      }),
    );
    const source = sumupSettlementReport(client, nearbyCandidates);
    const originalCandidates = new Set(candidates.map((row) => row.paymentRef));
    const thisDb = this.deps.db;
    const backupMatches: BackupPaymentMatch[] = [];
    const backupUnmatched: BackupPaymentUnmatched[] = [];
    const report = {
      async fetch(window: ReconcilePeriod, localReferences: readonly string[] = []) {
        const records = await source.fetch(
          {
            from: new Date(window.from.getTime() - 600_000),
            to: new Date(window.to.getTime() + 600_000),
          },
          localReferences,
        );
        const existing = await withTransaction(thisDb, (tx) =>
          existingReferences(
            tx,
            "sumup",
            records.flatMap((row) => row.references),
          ),
        );
        const outside = records.filter(
          (row) => row.hint === undefined && !row.references.some((ref) => existing.has(ref)),
        );
        const choices = outside.map((charge) =>
          manual.filter(
            (row) =>
              compareDecimal(row.amount, charge.amount) === 0 &&
              Math.abs(Date.parse(row.settledAt!) - charge.settledAt.getTime()) <= 300_000,
          ),
        );
        const matched = new Set<(typeof records)[number]>();
        for (const [index, charge] of outside.entries()) {
          if (charge.settledAt < window.from || charge.settledAt >= window.to) continue;
          const options = choices[index]!;
          const row = options[0];
          const common = {
            references: charge.references,
            amount: charge.amount,
            settledAt: charge.settledAt.toISOString(),
          };
          if (options.length === 1 && choices.filter((rows) => rows.includes(row!)).length === 1) {
            backupMatches.push({
              ...common,
              paymentRef: row!.paymentRef,
              workingOrderId: row!.workingOrderId,
              externalMachine: row!.externalMachine,
              externalRef: row!.externalRef,
            });
            matched.add(charge);
          } else
            backupUnmatched.push({ ...common, reason: options.length ? "ambiguous" : "unmatched" });
        }
        return records.filter(
          (row) =>
            !matched.has(row) &&
            ((row.settledAt >= window.from && row.settledAt < window.to) ||
              row.references.some((ref) => localReferences.includes(ref)) ||
              (row.hint !== undefined && originalCandidates.has(row.hint.paymentRef))),
        );
      },
    };
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
    let unreadableUnlinked = source.unreadableUnlinked;
    if (unreadableUnlinked > 0) {
      const originalDay = sumupSettlementReport(client);
      await originalDay.fetch(period);
      unreadableUnlinked = originalDay.unreadableUnlinked;
    }
    return {
      ...result,
      backupMatches,
      backupUnmatched,
      unlinkedCharges:
        unreadableUnlinked +
        result.missingLocal.filter((row) => row.workingOrderId === null).length,
      ...(candidates.some((row) => row.state === "attempting")
        ? { resweepAfter: new Date(now.getTime() + 86_400_000) }
        : {}),
    };
  }
}
