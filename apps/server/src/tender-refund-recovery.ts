import { and, eq, or, sql } from "drizzle-orm";
import { requireEconomicWrite } from "./trading-admission.js";
import { refunds, withTransaction } from "@waitron/db";
import { raisePendingRefundUnresolved } from "./bill-refund-alerts.js";
import { sweepInvoiceCorrections } from "./invoice-correction-alerts.js";
import {
  recoverCardRefund,
  tenderRefundIsLive,
  startTenderRefundResolvers,
  stopTenderRefundResolvers,
} from "./tender-refund-sends.js";
import { realSleep, sleepMsFor } from "./loop.js";
import type { TenderRefundDeps } from "./tender-refunds.js";
import { refundsPaused } from "./bill-refunds.js";

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
  const errors = [
    ...results.flatMap((result) =>
      result.status === "rejected" ? [result.reason as unknown] : result.value,
    ),
    ...(await sweep(true)),
  ];
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

export async function runTenderRefundRecoveryLoop(
  deps: TenderRefundDeps & {
    signal: AbortSignal;
    isPrimary: () => boolean;
    onError: (error: unknown) => void;
    onShutdownTimeout?: (refundIds: string[]) => void;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  },
): Promise<void> {
  const sleep = deps.sleep ?? realSleep;
  if (!deps.signal.aborted) startTenderRefundResolvers(deps.db);
  let stopping: Promise<string[]> | undefined;
  const stop = () => {
    stopping ??= stopTenderRefundResolvers(deps.db);
  };
  deps.signal.addEventListener("abort", stop, { once: true });
  try {
    while (!deps.signal.aborted) {
      let wait = RECHECK_MS;
      try {
        if (deps.isPrimary()) {
          const report = await recoverTenderRefunds({ ...deps, stopSignal: deps.signal });
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
    deps.signal.removeEventListener("abort", stop);
    stop();
    const timedOut = await stopping!;
    if (timedOut.length > 0) deps.onShutdownTimeout?.(timedOut);
  }
}
