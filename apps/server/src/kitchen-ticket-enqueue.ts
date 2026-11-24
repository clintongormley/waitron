import { type Transaction, insertInChunks, kitchenPrintJobLines, ticketItems } from "@waitron/db";
import { enqueuePrintJob } from "@waitron/printing";
import { inIds } from "./in-ids.js";
import { linkKitchenJob } from "./kitchen-ticket-links.js";
import type { FiredItem } from "./kitchen-ticket-items.js";
import { type KitchenJob, type FirePaper, planKitchenTickets } from "./kitchen-ticket-plan.js";
import type { TradingContext } from "./trading-context.js";

/** Enqueue each job with its bill, station and line links. */
export async function enqueueKitchenJobs(
  tx: Transaction,
  orderId: string,
  jobs: readonly KitchenJob[],
  reprint: boolean,
): Promise<void> {
  for (const job of jobs) {
    const { jobId } = await enqueuePrintJob(tx, job.printerId, job.bytes, "document");
    await linkKitchenJob(tx, jobId, orderId, job.stationIds, reprint ? "reprint" : "ticket");
    await insertInChunks(
      tx,
      kitchenPrintJobLines,
      job.lineIds.map((workingOrderLineId) => ({ printJobId: jobId, workingOrderLineId })),
    );
  }
}
/**
 * Enqueue the kitchen tickets for a set of just-fired lines ({@link planKitchenTickets}). Answers
 * the stations the enqueued jobs carried.
 */
export async function enqueueKitchenTickets(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  firedItems: FiredItem[],
  { mark, fire, from }: { mark?: "HOLD"; fire?: FirePaper; from?: string } = {},
): Promise<ReadonlySet<string>> {
  const jobs = await planKitchenTickets(tx, cfg, orderId, firedItems, {
    reprint: false,
    mark,
    fire,
    from,
  });
  await enqueueKitchenJobs(tx, orderId, jobs, false);
  const carried = new Set(jobs.flatMap((job) => job.stationIds));
  if (mark === "HOLD") await markHoldPaper(tx, firedItems, carried);
  return carried;
}
export async function markHoldPaper(
  tx: Transaction,
  items: readonly FiredItem[],
  receiving: ReadonlySet<string>,
): Promise<void> {
  const lines = items
    .filter((item) => receiving.has(item.stationId))
    .map((item) => item.workingOrderLineId);
  if (lines.length === 0) return;
  await tx
    .update(ticketItems)
    .set({ holdPaperQueued: true })
    .where(inIds(ticketItems.workingOrderLineId, lines));
}
