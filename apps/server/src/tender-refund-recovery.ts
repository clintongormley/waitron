import { and, eq, or, sql } from "drizzle-orm";
import { requireEconomicWrite } from "./trading-admission.js";
import { refunds, withTransaction } from "@waitron/db";
import { codeOf } from "@waitron/server-kit";
import { raisePendingRefundUnresolved } from "./bill-refund-alerts.js";
import { sweepInvoiceCorrections } from "./invoice-correction-alerts.js";
import { recoverCardRefund, refundsPaused, tenderRefundIsLive } from "./tender-refund-sends.js";
import type { TenderRefundDeps } from "./tender-refunds.js";

const RECHECK_MS = 60_000;
const UNRESOLVED_MS = 3_600_000;
const FAILED = "Card refund recovery failed";

function refundLookupGapMs(sentAgeMs: number): number {
  if (sentAgeMs < 5 * 60_000) return 0;
  return Math.min(sentAgeMs / 4, 30 * 60_000);
}
const pendingConnected = and(
  eq(refunds.state, "pending"),
  eq(refunds.method, "card"),
  eq(refunds.manual, false),
);

export async function recoverTenderRefunds(
  deps: TenderRefundDeps,
): Promise<{ pending: number; nextDueAt: Date | null }> {
  deps.admission.require();
  const reading = deps.clock.now();
  const now = reading.instant;
  const instant = now.toISOString();
  // A paused pass still sweeps for alerts, but files nothing: the clock or the seat that paused the
  // refunds would refuse the filing too.
  const sweep = async (fileSettled: boolean): Promise<unknown[]> => {
    try {
      await sweepInvoiceCorrections(deps, now, { fileSettled });
      return [];
    } catch (error) {
      return [error];
    }
  };
  if (await refundsPaused(deps, reading)) {
    const failed = await sweep(false);
    if (failed.length > 0) throw new AggregateError(failed, FAILED);
    const [summary] = await deps.db
      .select({ pending: sql<number>`count(*)` })
      .from(refunds)
      .where(pendingConnected);
    return { pending: summary!.pending, nextDueAt: new Date(now.getTime() + RECHECK_MS) };
  }
  const batch = await deps.db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      and(
        pendingConnected,
        or(
          sql`${refunds.nextRetryAt} is null`,
          sql`${refunds.nextRetryAt} <= ${instant}`,
          sql`${refunds.lastLookupAt} > ${instant}`,
        ),
      ),
    )
    .orderBy(
      sql`coalesce(${refunds.nextRetryAt}, ${refunds.createdAt})`,
      refunds.createdAt,
      sql`case when ${refunds.billPaymentId} is not null then ${refunds}.rowid end`,
      refunds.id,
    )
    .limit(50);
  const results = await Promise.allSettled(
    batch.map(async ({ id }) => {
      const work = await withTransaction(deps.db, async (tx) => {
        await requireEconomicWrite(tx, deps.cfg, deps.admission);
        const [row] = await tx.select().from(refunds).where(eq(refunds.id, id));
        if (row?.state !== "pending") return false;
        const live = tenderRefundIsLive(deps.db, id);
        const gap =
          row.sentAt === null ? 0 : refundLookupGapMs(now.getTime() - Date.parse(row.sentAt));
        const last = row.lastLookupAt === null ? null : Date.parse(row.lastLookupAt);
        const lastGap =
          row.sentAt === null || last === null
            ? 0
            : refundLookupGapMs(last - Date.parse(row.sentAt));
        const lookupDue = last === null || last > now.getTime() || now.getTime() - last >= lastGap;
        let next = Math.max(
          now.getTime() + RECHECK_MS,
          live || lookupDue || last === null ? now.getTime() + gap : last + lastGap,
        );
        const alertAt = Date.parse(row.createdAt) + UNRESOLVED_MS + 1;
        if (alertAt > now.getTime()) next = Math.min(next, alertAt);
        // Moving live rows to a later pass lets the next bounded batch reach other captures.
        await tx
          .update(refunds)
          .set({ nextRetryAt: new Date(next).toISOString() })
          .where(eq(refunds.id, id));
        return !live && (row.sentAt === null || lookupDue);
      });
      const failures: unknown[] = [];
      if (work)
        await recoverCardRefund(deps, id).catch((error: unknown) => {
          failures.push(error);
        });
      await withTransaction(deps.db, async (tx) => {
        await requireEconomicWrite(tx, deps.cfg, deps.admission);
        const [row] = await tx.select().from(refunds).where(eq(refunds.id, id));
        if (row?.state === "pending" && now.getTime() - Date.parse(row.createdAt) > UNRESOLVED_MS)
          await raisePendingRefundUnresolved(tx, row, now);
      }).catch((error: unknown) => {
        failures.push(error);
      });
      return failures;
    }),
  );
  const errors: unknown[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      errors.push(result.reason as unknown);
      continue;
    }
    for (const error of result.value) {
      deps.log?.("error", "tender_refund.recovery_failed", {
        refundId: batch[index]!.id,
        errorCode: codeOf(error),
      });
    }
  }
  errors.push(...(await sweep(true)));
  if (errors.length > 0) throw new AggregateError(errors, FAILED);
  const [summary] = await deps.db
    .select({
      pending: sql<number>`count(*)`,
      next: sql<
        string | null
      >`min(case when ${refunds.lastLookupAt} > ${instant} then ${instant} else coalesce(${refunds.nextRetryAt}, ${instant}) end)`,
    })
    .from(refunds)
    .where(pendingConnected);
  return {
    pending: summary!.pending,
    nextDueAt: summary!.next === null ? null : new Date(summary!.next),
  };
}
