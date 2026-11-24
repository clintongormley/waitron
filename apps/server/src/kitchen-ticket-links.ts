import {
  type Transaction,
  kitchenPrintJobs,
  printJobs,
  kitchenPrintJobLines,
  ticketItems,
} from "@waitron/db";
import { sql, eq, and, or, inArray } from "drizzle-orm";
import { inIds } from "./in-ids.js";
import { printedOrResent } from "./print-job-trouble.js";

export async function linkKitchenJob(
  tx: Transaction,
  printJobId: string,
  workingOrderId: string,
  stationIds: string[],
  kind: "ticket" | "reprint" | "correction",
): Promise<void> {
  await tx.insert(kitchenPrintJobs).values(
    stationIds.map((stationId) => ({
      printJobId,
      workingOrderId,
      stationId,
      reprint: kind === "reprint",
      correctionSlip: kind === "correction",
    })),
  );
}
/**
 * `orderId`'s link rows that no reprint for the same station, on the same printer, queued after
 * them and printed itself or through a resend ({@link printedOrResent}), has covered.
 * These links can still raise printing problems. Oldest first.
 */
async function readUncoveredLinks(tx: Transaction, orderId: string) {
  const rows = await tx
    .select({
      id: kitchenPrintJobs.id,
      printJobId: kitchenPrintJobs.printJobId,
      stationId: kitchenPrintJobs.stationId,
      reprint: kitchenPrintJobs.reprint,
      correctionSlip: kitchenPrintJobs.correctionSlip,
      createdAt: kitchenPrintJobs.createdAt,
      printerId: printJobs.printerId,
      status: printJobs.status,
      printed: sql<number>`${printedOrResent(printJobs)}`,
      queued: sql<number>`${kitchenPrintJobs}.rowid`,
    })
    .from(kitchenPrintJobs)
    .innerJoin(printJobs, eq(printJobs.id, kitchenPrintJobs.printJobId))
    .where(eq(kitchenPrintJobs.workingOrderId, orderId))
    .orderBy(sql`${kitchenPrintJobs}.rowid`);

  const printerKey = (row: { stationId: string; printerId: string }) =>
    `${row.stationId}|${row.printerId}`;
  const lastReprinted = new Map<string, number>();
  for (const row of rows) {
    if (row.reprint && row.printed) lastReprinted.set(printerKey(row), row.queued);
  }
  return rows.filter((row) => row.queued > (lastReprinted.get(printerKey(row)) ?? 0));
}
/**
 * Write `rows` onto `orderId` in order, after every link row it already has, replacing its own row
 * for the same job and station, so none of its earlier reprints, which never carried the dishes
 * that brought them, covers them. None counts as a reprint, as none carried `orderId`'s own dishes.
 */
async function writeLinksAfter(
  tx: Transaction,
  orderId: string,
  rows: readonly {
    id?: string;
    printJobId: string;
    stationId: string;
    correctionSlip?: boolean;
    createdAt: string;
  }[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx
    .delete(kitchenPrintJobs)
    .where(
      and(
        eq(kitchenPrintJobs.workingOrderId, orderId),
        or(
          ...rows.map((row) =>
            and(
              eq(kitchenPrintJobs.printJobId, row.printJobId),
              eq(kitchenPrintJobs.stationId, row.stationId),
            ),
          ),
        ),
      ),
    );
  await tx.insert(kitchenPrintJobs).values(
    rows.map((row) => ({
      ...(row.id === undefined ? {} : { id: row.id }),
      printJobId: row.printJobId,
      workingOrderId: orderId,
      stationId: row.stationId,
      reprint: false,
      correctionSlip: row.correctionSlip,
      createdAt: row.createdAt,
    })),
  );
}
/** Preserve source Reprint identity without letting its copy cover unrelated destination dishes. */
export async function moveKitchenPrintLinks(
  tx: Transaction,
  fromOrderId: string,
  intoOrderId: string,
): Promise<void> {
  const moving = await readUncoveredLinks(tx, fromOrderId);
  if (moving.length === 0) return;
  const originals = moving.filter((row) => !row.reprint);
  if (originals.length > 0) {
    await tx.delete(kitchenPrintJobs).where(
      inIds(
        kitchenPrintJobs.id,
        originals.map((row) => row.id),
      ),
    );
  }
  await writeLinksAfter(
    tx,
    intoOrderId,
    moving.map((row) => ({
      ...row,
      id: row.reprint ? undefined : row.id,
    })),
  );
}
/**
 * Give `toOrderId` a link to each of `fromOrderId`'s unprinted kitchen tickets that no printed
 * reprint has covered and that carried one of `lineIds`, which have just moved there off
 * `fromOrderId`, some or all of them, at that line's station. Both bills then show the problem until
 * {@link readPrintProblems} clears it for each. The new links are written as {@link writeLinksAfter}
 * writes them.
 */
export async function copyKitchenPrintLinks(
  tx: Transaction,
  fromOrderId: string,
  toOrderId: string,
  lineIds: readonly string[],
): Promise<void> {
  if (lineIds.length === 0) return;
  const carried = await tx
    .selectDistinct({
      printJobId: kitchenPrintJobLines.printJobId,
      stationId: ticketItems.stationId,
    })
    .from(kitchenPrintJobLines)
    .innerJoin(
      ticketItems,
      eq(ticketItems.workingOrderLineId, kitchenPrintJobLines.workingOrderLineId),
    )
    .where(inArray(kitchenPrintJobLines.workingOrderLineId, [...lineIds]));
  const jobStations = new Set(carried.map((row) => `${row.printJobId}|${row.stationId}`));
  const copies = (await readUncoveredLinks(tx, fromOrderId))
    .filter((row) => row.status !== "done" && jobStations.has(`${row.printJobId}|${row.stationId}`))
    .map(({ printJobId, stationId, createdAt }) => ({ printJobId, stationId, createdAt }));
  await writeLinksAfter(tx, toOrderId, copies);
}
/** Record that every kitchen ticket which carried `fromLineId` carried `toLineId`, split off it. */
export async function copyKitchenJobLines(
  tx: Transaction,
  fromLineId: string,
  toLineId: string,
): Promise<void> {
  const jobs = await tx
    .select({ printJobId: kitchenPrintJobLines.printJobId })
    .from(kitchenPrintJobLines)
    .where(eq(kitchenPrintJobLines.workingOrderLineId, fromLineId));
  if (jobs.length === 0) return;
  await tx
    .insert(kitchenPrintJobLines)
    .values(jobs.map(({ printJobId }) => ({ printJobId, workingOrderLineId: toLineId })));
}
