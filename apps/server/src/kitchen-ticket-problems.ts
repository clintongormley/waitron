import "./errors.js";
import {
  type Transaction,
  kitchenPrintJobLines,
  workingOrderLines,
  ticketItems,
  printJobs,
  kitchenPrintJobs,
  kitchenStations,
  workingOrders,
  parties,
} from "@waitron/db";
import { compareStationNames, AppError } from "@waitron/shared";
import { sql, eq, and, type SQL, ne, or, inArray } from "drizzle-orm";
import { inIds } from "./in-ids.js";
import { readReprintTargets } from "./kitchen-ticket-reprint.js";
import { partyFamily } from "./parties.js";
import { printedOrResent, printJobInTrouble } from "./print-job-trouble.js";

/** A kitchen ticket for a bill and station not printed after `JOBS_WAITING_MS`, or given up on. */
export interface PrintProblem {
  workingOrderId: string;
  stationId: string;
  stationName: string;
  /** When the oldest such ticket was queued. */
  since: string;
}
interface KitchenProblemLink {
  printJobId: string;
  workingOrderId: string;
  stationId: string;
  printerId: string;
}
/** Moved dishes need their own later paper; a copied bill link is never itself a Reprint. */
async function printedMovedDishes(tx: Transaction, links: readonly { printJobId: string }[]) {
  if (links.length === 0) return () => false;
  const lines = await tx
    .select({
      printJobId: kitchenPrintJobLines.printJobId,
      lineId: workingOrderLines.id,
      workingOrderId: workingOrderLines.workingOrderId,
      stationId: ticketItems.stationId,
      queued: sql<number>`${printJobs}.rowid`,
    })
    .from(kitchenPrintJobLines)
    .innerJoin(printJobs, eq(printJobs.id, kitchenPrintJobLines.printJobId))
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, kitchenPrintJobLines.workingOrderLineId))
    .innerJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      inIds(kitchenPrintJobLines.printJobId, [...new Set(links.map((row) => row.printJobId))]),
    );
  const reprints =
    lines.length === 0
      ? []
      : await tx
          .select({
            lineId: kitchenPrintJobLines.workingOrderLineId,
            stationId: kitchenPrintJobs.stationId,
            printerId: printJobs.printerId,
            queued: sql<number>`${printJobs}.rowid`,
          })
          .from(kitchenPrintJobLines)
          .innerJoin(
            kitchenPrintJobs,
            eq(kitchenPrintJobs.printJobId, kitchenPrintJobLines.printJobId),
          )
          .innerJoin(printJobs, eq(printJobs.id, kitchenPrintJobLines.printJobId))
          .where(
            and(
              inIds(kitchenPrintJobLines.workingOrderLineId, [
                ...new Set(lines.map((row) => row.lineId)),
              ]),
              eq(kitchenPrintJobs.reprint, true),
              printedOrResent(printJobs),
            ),
          );
  const latest = new Map<string, number>();
  for (const row of reprints) {
    const key = `${row.lineId}|${row.stationId}|${row.printerId}`;
    latest.set(key, Math.max(latest.get(key) ?? 0, row.queued));
  }
  const relevant = new Map<string, typeof lines>();
  for (const row of lines) {
    for (const key of [
      `${row.printJobId}|${row.workingOrderId}|${row.stationId}`,
      `${row.printJobId}|${row.stationId}`,
    ]) {
      const own = relevant.get(key);
      if (own === undefined) relevant.set(key, [row]);
      else own.push(row);
    }
  }
  return (link: KitchenProblemLink): boolean => {
    const own =
      relevant.get(`${link.printJobId}|${link.workingOrderId}|${link.stationId}`) ??
      relevant.get(`${link.printJobId}|${link.stationId}`);
    return (
      own !== undefined &&
      own.every(
        (row) => (latest.get(`${row.lineId}|${row.stationId}|${link.printerId}`) ?? 0) > row.queued,
      )
    );
  };
}
/**
 * Same-bill coverage uses link order; moved-dish coverage uses original job order.
 */
async function readPrintProblems(tx: Transaction, scope: SQL, now: Date): Promise<PrintProblem[]> {
  const troubled = printJobInTrouble(now);
  const rows = await tx
    .select({
      workingOrderId: kitchenPrintJobs.workingOrderId,
      stationId: kitchenPrintJobs.stationId,
      stationName: kitchenStations.name,
      printJobId: printJobs.id,
      printerId: printJobs.printerId,
      createdAt: printJobs.createdAt,
      queued: sql<number>`${kitchenPrintJobs}.rowid`,
      troubled: sql<number>`${troubled}`,
    })
    .from(kitchenPrintJobs)
    .innerJoin(printJobs, eq(printJobs.id, kitchenPrintJobs.printJobId))
    .innerJoin(workingOrders, eq(workingOrders.id, kitchenPrintJobs.workingOrderId))
    .innerJoin(kitchenStations, eq(kitchenStations.id, kitchenPrintJobs.stationId))
    .where(
      and(
        scope,
        ne(workingOrders.status, "abandoned"),
        or(troubled, and(eq(kitchenPrintJobs.reprint, true), printedOrResent(printJobs))),
      ),
    );

  const key = (row: { workingOrderId: string; stationId: string }) =>
    `${row.workingOrderId}|${row.stationId}`;
  const printerKey = (row: { workingOrderId: string; stationId: string; printerId: string }) =>
    `${key(row)}|${row.printerId}`;
  const lastReprinted = new Map<string, number>();
  for (const row of rows) {
    if (row.troubled) continue;
    const seen = lastReprinted.get(printerKey(row));
    if (seen === undefined || row.queued > seen) lastReprinted.set(printerKey(row), row.queued);
  }
  const uncleared = rows.filter((row) => {
    if (!row.troubled) return false;
    const reprinted = lastReprinted.get(printerKey(row));
    return reprinted === undefined || reprinted <= row.queued;
  });
  if (uncleared.length === 0) return [];
  const movedPaperPrinted = await printedMovedDishes(tx, uncleared);
  const targets = await readReprintTargets(tx, [
    ...new Set(uncleared.map((row) => row.workingOrderId)),
  ]);
  const problems = new Map<string, PrintProblem>();
  for (const row of uncleared) {
    if (movedPaperPrinted(row)) continue;
    if (!targets.get(row.workingOrderId)!.has(`${row.printerId}|${row.stationId}`)) continue;
    const known = problems.get(key(row));
    if (known === undefined || row.createdAt < known.since) {
      problems.set(key(row), {
        workingOrderId: row.workingOrderId,
        stationId: row.stationId,
        stationName: row.stationName,
        since: row.createdAt,
      });
    }
  }
  return [...problems.values()].sort(
    (a, b) =>
      a.since.localeCompare(b.since) ||
      compareStationNames(a.stationName, b.stationName) ||
      a.workingOrderId.localeCompare(b.workingOrderId),
  );
}
/** Return the IDs of jobs the printer alert can omit. A correction can still be resent
 * after its station card disappears. Jobs without a kitchen link keep their own alert.
 */
export async function kitchenJobsNotWaiting(
  tx: Transaction,
  jobs: readonly { id: string; printerId: string; sourceId: string }[],
): Promise<Set<string>> {
  const settled = new Set<string>();
  if (jobs.length === 0) return settled;
  const links = await tx
    .select({
      printJobId: kitchenPrintJobs.printJobId,
      workingOrderId: kitchenPrintJobs.workingOrderId,
      stationId: kitchenPrintJobs.stationId,
      correctionSlip: kitchenPrintJobs.correctionSlip,
      queued: sql<number>`${kitchenPrintJobs}.rowid`,
    })
    .from(kitchenPrintJobs)
    .where(
      inIds(
        kitchenPrintJobs.printJobId,
        jobs.map((job) => job.sourceId),
      ),
    );
  if (links.length === 0) return settled;
  const orderIds = links.map((row) => row.workingOrderId);
  const reprints = await tx
    .select({
      workingOrderId: kitchenPrintJobs.workingOrderId,
      stationId: kitchenPrintJobs.stationId,
      printerId: printJobs.printerId,
      queued: sql<number>`${kitchenPrintJobs}.rowid`,
    })
    .from(kitchenPrintJobs)
    .innerJoin(printJobs, eq(printJobs.id, kitchenPrintJobs.printJobId))
    .where(
      and(
        inIds(kitchenPrintJobs.workingOrderId, orderIds),
        eq(kitchenPrintJobs.reprint, true),
        printedOrResent(printJobs),
      ),
    );
  const lastReprinted = new Map<string, number>();
  for (const row of reprints) {
    const key = `${row.workingOrderId}|${row.stationId}|${row.printerId}`;
    lastReprinted.set(key, Math.max(lastReprinted.get(key) ?? 0, row.queued));
  }
  const linksBySource = new Map<string, typeof links>();
  for (const row of links) {
    const own = linksBySource.get(row.printJobId);
    if (own === undefined) linksBySource.set(row.printJobId, [row]);
    else own.push(row);
  }
  const uncleared = new Map<string, typeof links>();
  for (const job of jobs) {
    const own = linksBySource.get(job.sourceId);
    if (own === undefined) continue;
    uncleared.set(
      job.id,
      own.filter(
        (row) =>
          (lastReprinted.get(`${row.workingOrderId}|${row.stationId}|${job.printerId}`) ?? 0) <=
          row.queued,
      ),
    );
  }
  const waitingLinks = [...uncleared.values()].flat().filter((row) => !row.correctionSlip);
  const movedPaperPrinted = await printedMovedDishes(tx, waitingLinks);
  const waitingOrders = [...new Set(waitingLinks.map((row) => row.workingOrderId))];
  const targets =
    waitingOrders.length === 0
      ? new Map<string, Set<string>>()
      : await readReprintTargets(tx, waitingOrders);
  for (const job of jobs) {
    const rows = uncleared.get(job.id);
    if (rows === undefined) continue;
    const waiting = rows.some(
      (row) =>
        row.correctionSlip ||
        (!movedPaperPrinted({ ...row, printerId: job.printerId }) &&
          targets.get(row.workingOrderId)!.has(`${job.printerId}|${row.stationId}`)),
    );
    if (!waiting) settled.add(job.id);
  }
  return settled;
}
/**
 * The printing problems on a seated party's bills, the bills of every party merged into it
 * included. A party that does not exist is `party.not_open`, as on the other party reads.
 */
export async function listPrintProblems(
  tx: Transaction,
  partyId: string,
  now: Date = new Date(),
): Promise<PrintProblem[]> {
  const [party] = await tx.select({ id: parties.id }).from(parties).where(eq(parties.id, partyId));
  if (party === undefined) throw new AppError("party.not_open", { partyId });
  const family = await partyFamily(tx, partyId);
  return readPrintProblems(tx, inArray(workingOrders.partyId, family), now);
}
/** Which of `orderIds` have a printing problem at `stationId`. */
export async function ordersWithPrintProblem(
  tx: Transaction,
  stationId: string,
  orderIds: readonly string[],
  now: Date,
): Promise<Set<string>> {
  return (await stationOrdersWithPrintProblem(tx, [stationId], orderIds, now)).get(stationId)!;
}
/** For each of `stationIds`, which of `orderIds` have a printing problem there. */
export async function stationOrdersWithPrintProblem(
  tx: Transaction,
  stationIds: readonly string[],
  orderIds: readonly string[],
  now: Date,
): Promise<Map<string, Set<string>>> {
  const found = new Map(stationIds.map((id) => [id, new Set<string>()]));
  if (stationIds.length === 0 || orderIds.length === 0) return found;
  const problems = await readPrintProblems(
    tx,
    and(
      inArray(kitchenPrintJobs.stationId, [...stationIds]),
      inArray(kitchenPrintJobs.workingOrderId, [...orderIds]),
    )!,
    now,
  );
  for (const problem of problems) found.get(problem.stationId)!.add(problem.workingOrderId);
  return found;
}
