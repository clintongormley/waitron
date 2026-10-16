import { and, eq, or, sql } from "drizzle-orm";
import { tenderRefunds, withTransaction } from "@waitron/db";
import { refundLookupGapMs } from "./bill-payments-loop.js";
import { raiseTenderRefundUnresolved } from "./bill-refund-alerts.js";
import {
  resumeTenderRefund,
  tenderRefundIsLive,
  waitForTenderRefundResolvers,
} from "./tender-refund-sends.js";
import { realSleep, sleepMsFor } from "./loop.js";
import type { TenderRefundDeps } from "./tender-refunds.js";

const RECHECK_MS = 60_000;
const UNRESOLVED_MS = 3_600_000;
const pendingConnected = and(
  eq(tenderRefunds.state, "pending"),
  eq(tenderRefunds.method, "card"),
  eq(tenderRefunds.manual, false),
);

export async function recoverTenderRefunds(
  deps: TenderRefundDeps,
): Promise<{ pending: number; nextDueAt: Date | null }> {
  const now = deps.clock.now().instant;
  const instant = now.toISOString();
  const batch = await deps.db
    .select({ id: tenderRefunds.id })
    .from(tenderRefunds)
    .where(
      and(
        pendingConnected,
        or(
          sql`${tenderRefunds.nextRetryAt} is null`,
          sql`${tenderRefunds.nextRetryAt} <= ${instant}`,
          sql`${tenderRefunds.lastLookupAt} > ${instant}`,
        ),
      ),
    )
    .orderBy(
      sql`coalesce(${tenderRefunds.nextRetryAt}, ${tenderRefunds.createdAt})`,
      tenderRefunds.createdAt,
      tenderRefunds.id,
    )
    .limit(50);
  const results = await Promise.allSettled(
    batch.map(async ({ id }) => {
      const work = await withTransaction(deps.db, async (tx) => {
        const [row] = await tx.select().from(tenderRefunds).where(eq(tenderRefunds.id, id));
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
          .update(tenderRefunds)
          .set({ nextRetryAt: new Date(next).toISOString() })
          .where(eq(tenderRefunds.id, id));
        return !live && (row.sentAt === null || lookupDue);
      });
      if (work) await resumeTenderRefund(deps, id, "loop");
      await withTransaction(deps.db, async (tx) => {
        const [row] = await tx.select().from(tenderRefunds).where(eq(tenderRefunds.id, id));
        if (
          row?.state === "pending" &&
          !tenderRefundIsLive(deps.db, id) &&
          now.getTime() - Date.parse(row.createdAt) > UNRESOLVED_MS
        )
          await raiseTenderRefundUnresolved(tx, row, now);
      });
    }),
  );
  const errors = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason as unknown);
  if (errors.length > 0) throw new AggregateError(errors, "Settled-tender refund recovery failed");
  const [summary] = await deps.db
    .select({
      pending: sql<number>`count(*)`,
      next: sql<
        string | null
      >`min(case when ${tenderRefunds.lastLookupAt} > ${instant} then ${instant} else coalesce(${tenderRefunds.nextRetryAt}, ${instant}) end)`,
    })
    .from(tenderRefunds)
    .where(pendingConnected);
  return {
    pending: summary!.pending,
    nextDueAt: summary!.next === null ? null : new Date(summary!.next),
  };
}

export async function runTenderRefundRecoveryLoop(
  deps: TenderRefundDeps & {
    signal: AbortSignal;
    isPrimary: () => boolean;
    onError: (error: unknown) => void;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  },
): Promise<void> {
  const sleep = deps.sleep ?? realSleep;
  try {
    while (!deps.signal.aborted) {
      let wait = RECHECK_MS;
      try {
        if (deps.isPrimary()) {
          const report = await recoverTenderRefunds(deps);
          wait = sleepMsFor(report.nextDueAt, deps.clock.now().instant, 500, RECHECK_MS);
        }
      } catch (error) {
        deps.onError(error);
      }
      if (deps.signal.aborted) break;
      try {
        await sleep(wait, deps.signal);
      } catch (error) {
        deps.onError(error);
      }
    }
  } finally {
    await waitForTenderRefundResolvers(deps.db);
  }
}
