import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import {
  adjustmentLines,
  adjustments,
  findAdjustmentReason,
  insertPendingDiscount,
  policySnapshotOf,
  type NewPendingDiscount,
} from "@waitron/adjustments";
import { workingOrderLines, type Transaction } from "@waitron/db";
import type { AdjustmentVenue } from "./adjustment-venue.js";

/**
 * Holds a discount on an open bill through the store, as the till will give it: 10% under the
 * complaint reason, asked for by the venue's staff member, unless `row` says otherwise. `row` names
 * the target. Answers the row's id.
 */
export async function holdDiscount(
  tx: Transaction,
  venue: Pick<AdjustmentVenue, "reasonId" | "staffId">,
  row: Partial<NewPendingDiscount>,
): Promise<string> {
  const reason = await findAdjustmentReason(tx, venue.reasonId.complaint);
  return insertPendingDiscount(tx, {
    action: "discount_percent",
    percentBp: 1000,
    origin: "given",
    givenTogether: randomUUID(),
    position: 1,
    reasonId: reason.id,
    reasonName: reason.name,
    policySnapshot: policySnapshotOf(reason, { maxBillComp: null }),
    requestedBy: venue.staffId,
    givenAt: new Date().toISOString(),
    ...row,
  });
}

/**
 * Every adjustment record on `billId` with its adjustment lines, every column but ids and times,
 * each line named by its line number, so two bills' records compare.
 */
export async function writtenAdjustments(tx: Transaction, billId: string) {
  const numbered = await tx
    .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId));
  const lineNo = (id: string) => numbered.find((line) => line.id === id)?.lineNo ?? id;
  const records = await tx
    .select()
    .from(adjustments)
    .where(eq(adjustments.workingOrderId, billId))
    .orderBy(asc(adjustments.createdAt), asc(adjustments.id));
  const written = [];
  for (const { id, workingOrderId, createdAt, lineId, splits, ...columns } of records) {
    void workingOrderId;
    void createdAt;
    const lines = await tx
      .select({
        lineId: adjustmentLines.lineId,
        reduction: adjustmentLines.reduction,
        quantity: adjustmentLines.quantity,
      })
      .from(adjustmentLines)
      .where(eq(adjustmentLines.adjustmentId, id));
    written.push({
      ...columns,
      line: lineId === null ? null : lineNo(lineId),
      splits: splits.map(({ from, to }) => [lineNo(from), lineNo(to)]),
      lines: lines
        .map((line) => ({ ...line, lineId: lineNo(line.lineId) }))
        .sort((a, b) => String(a.lineId).localeCompare(String(b.lineId))),
    });
  }
  return written;
}
