import { withTransaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import {
  reconciliationRuns,
  listRefundAuditRows,
  BACKUP_MATCH_WINDOW_MS,
  listPaymentAuditRuns,
  type BackupPaymentMatch,
  type BackupPaymentUnmatched,
} from "@waitron/payments";
import { resolveVenueClock } from "@waitron/reporting";
import { type Logger, requireManagementSession, requirePeriod } from "@waitron/server-kit";
import { businessDayAt, businessDayBounds } from "@waitron/shared";
import { and, eq, lt, gte } from "drizzle-orm";
import type { Hono } from "hono";
import { backupAuditDay, type BackupAuditRun } from "./backup-audit-day.js";
import { readPairedReaderAudit, type PairedAuditRun } from "./paired-reader-audit.js";
import { type PaymentsApiDeps, PAYMENTS_MANAGE } from "./payments-api-deps.js";
import { run } from "./payments-api-errors.js";
import { type RefundAuditRun, refundAudit } from "./refund-audit.js";

export function mountPaymentsBackupAuditRoutes(
  app: Hono,
  deps: PaymentsApiDeps,
  log: Logger,
): void {
  app.get("/management-api/payments/backup-audit", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const result = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, { managementSessionId: sessionId, permission: PAYMENTS_MANAGE });
        const clock = {
          ...(await resolveVenueClock(tx, deps.cfg.nodeId)),
          dayCutover: "00:00",
          cutoverChanges: [],
        };
        const today = businessDayAt(clock, deps.clock.now().instant);
        const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
          .toISOString()
          .slice(0, 10);
        const day = requirePeriod(c.req.query("day") ?? yesterday, "day");
        const bounds = businessDayBounds(clock, day);
        const runs = await tx
          .select({
            periodFrom: reconciliationRuns.periodFrom,
            periodTo: reconciliationRuns.periodTo,
            generation: reconciliationRuns.generation,
            startedAt: reconciliationRuns.startedAt,
            finishedAt: reconciliationRuns.finishedAt,
            summary: reconciliationRuns.summary,
          })
          .from(reconciliationRuns)
          .where(
            and(
              eq(reconciliationRuns.duty, "payments.reconcile.sumup"),
              eq(reconciliationRuns.state, "succeeded"),
              lt(reconciliationRuns.periodFrom, bounds.endAt),
              gte(reconciliationRuns.periodTo, bounds.startAt),
            ),
          );
        const period = { from: new Date(bounds.startAt), to: new Date(bounds.endAt) };
        const summaries = [...runs] as RefundAuditRun[];
        const readRows = () =>
          listRefundAuditRows(
            tx,
            "sumup",
            period,
            summaries.flatMap(
              (run) =>
                run.summary?.refundEvidence?.parents.map((parent) => parent.processorRef) ?? [],
            ),
            summaries.flatMap(
              (run) => run.summary?.backupMatches?.map((match) => match.paymentRef) ?? [],
            ),
          );
        const current = await readRows();
        const days = [
          ...new Set(
            [
              ...current.flatMap((row) =>
                row.provider === "manual" && row.settledAt !== null ? [row.settledAt] : [],
              ),
              ...summaries.flatMap(
                (run) =>
                  run.summary?.refundEvidence?.parents.flatMap((parent) =>
                    parent.capturedAt ? [parent.capturedAt] : [],
                  ) ?? [],
              ),
            ].flatMap((at) =>
              [-BACKUP_MATCH_WINDOW_MS, 0, BACKUP_MATCH_WINDOW_MS].map(
                (offset) =>
                  `${new Date(Date.parse(at) + offset).toISOString().slice(0, 10)}T00:00:00.000Z`,
              ),
            ),
          ),
        ];
        const manualRefs = new Set(
          current.filter((row) => row.provider === "manual").map((row) => row.paymentRef),
        );
        const observedRefs = new Set(
          summaries.flatMap(
            (run) =>
              run.summary?.refundEvidence?.parents.map((parent) => parent.processorRef) ?? [],
          ),
        );
        const older = await listPaymentAuditRuns(tx, "sumup", days);
        for (const run of older) {
          if (
            summaries.some(
              (existing) =>
                existing.periodFrom === run.periodFrom && existing.generation === run.generation,
            )
          )
            continue;
          const summary = run.summary as RefundAuditRun["summary"];
          const matches =
            summary?.backupMatches?.filter(
              (match) =>
                manualRefs.has(match.paymentRef) ||
                match.references.some((id) => observedRefs.has(id)),
            ) ?? [];
          const ids = new Set([...observedRefs, ...matches.flatMap((match) => match.references)]);
          summaries.push({
            ...run,
            summary: {
              backupMatches: matches,
              backupUnmatched:
                summary?.backupUnmatched?.filter((charge) =>
                  charge.references.some((id) => ids.has(id)),
                ) ?? [],
              ...(summary?.refundEvidence
                ? {
                    refundEvidence: {
                      ...summary.refundEvidence,
                      parents: summary.refundEvidence.parents.filter((parent) =>
                        ids.has(parent.processorRef),
                      ),
                    },
                  }
                : {}),
            },
          });
        }
        const standalone = backupAuditDay(
          day,
          clock.timeZone,
          runs as BackupAuditRun<BackupPaymentMatch | BackupPaymentUnmatched>[],
        );
        const paired = await readPairedReaderAudit(
          tx,
          bounds,
          runs as PairedAuditRun[],
          standalone,
        );
        return {
          ...standalone,
          ...paired,
          refundAudit: refundAudit(period, summaries, await readRows()),
        };
      });
      return c.json(result);
    }),
  );
}
