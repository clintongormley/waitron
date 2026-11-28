import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  adjustmentLines,
  adjustments,
  findAdjustmentReason,
  insertPendingDiscount,
  policySnapshotOf,
  type NewPendingDiscount,
} from "@waitron/adjustments";
import { activityLog, sales, workingOrderLines, type Transaction } from "@waitron/db";
import { inTx, lineIdOf, type AdjustmentVenue } from "./adjustment-venue.js";

/** Who gives a discount: the complaint reason's id and the staff member asking. */
export interface DiscountGiver {
  reasonId: Pick<AdjustmentVenue["reasonId"], "complaint">;
  staffId: string;
}

/**
 * Holds a discount on an open bill through the store, as the till will give it: 10% under the
 * complaint reason, asked for by the venue's staff member, unless `row` says otherwise. `row` names
 * the target. Answers the row's id.
 */
export async function holdDiscount(
  tx: Transaction,
  venue: DiscountGiver,
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

/** 10% off the whole of `billId`, under the complaint reason `complaint`, asked for by the venue's
 * operator. Answers the row's id. */
export function holdTenPercent(
  venue: Pick<AdjustmentVenue, "db"> & { operatorId: string },
  complaint: string,
  billId: string,
): Promise<string> {
  return inTx(venue, (tx) =>
    holdDiscount(
      tx,
      { reasonId: { complaint }, staffId: venue.operatorId },
      { workingOrderId: billId },
    ),
  );
}

/** 50.00 off line `lineNo` of `billId`, more than it costs: it no longer holds as given. */
export async function cutDownOn(
  venue: Pick<AdjustmentVenue, "db">,
  giver: DiscountGiver,
  billId: string,
  lineNo = 1,
): Promise<string> {
  const lineId = await lineIdOf(venue, billId, lineNo);
  return inTx(venue, (tx) =>
    holdDiscount(tx, giver, {
      lineId,
      action: "discount_amount",
      percentBp: null,
      amount: 5000,
    }),
  );
}

/** The total of each sale `billId` issued. */
export async function salesOf(venue: Pick<AdjustmentVenue, "db">, billId: string) {
  return inTx(venue, (tx) =>
    tx.select({ total: sales.total }).from(sales).where(eq(sales.workingOrderId, billId)),
  );
}

/** Each `discount.written_as_it_stood` activity entry on `billId`. */
export async function writtenAsItStood(venue: Pick<AdjustmentVenue, "db">, billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ data: activityLog.data })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.kind, "discount.written_as_it_stood"),
          eq(activityLog.subjectId, billId),
        ),
      ),
  );
}

/** The id of each discount still held on `billId`, on the whole bill or on one of its lines. */
export function discountsHeldOn(venue: Pick<AdjustmentVenue, "db">, billId: string) {
  return venue.db.all(sql`
    select id from bill_discounts where working_order_id = ${billId}
      or line_id in (select id from working_order_lines where working_order_id = ${billId})`);
}

/**
 * Every adjustment record on `billId` in the order written, with its adjustment lines, every
 * column but ids and times, each line named by its line number, so two bills' records compare.
 * Two records can share a millisecond, so the order is the rows', not their times'.
 */
export async function writtenAdjustments(tx: Transaction, billId: string) {
  const numbered = await tx
    .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId));
  const lineNoOf = new Map(numbered.map((line) => [line.id, line.lineNo]));
  const lineNo = (id: string) => lineNoOf.get(id) ?? id;
  const records = await tx
    .select()
    .from(adjustments)
    .where(eq(adjustments.workingOrderId, billId))
    .orderBy(sql`${adjustments}.rowid`);
  const linesOf = new Map<string, { lineId: string; reduction: number; quantity: number }[]>();
  if (records.length > 0) {
    const all = await tx
      .select({
        adjustmentId: adjustmentLines.adjustmentId,
        lineId: adjustmentLines.lineId,
        reduction: adjustmentLines.reduction,
        quantity: adjustmentLines.quantity,
      })
      .from(adjustmentLines)
      .where(
        inArray(
          adjustmentLines.adjustmentId,
          records.map(({ id }) => id),
        ),
      );
    for (const { adjustmentId, ...line } of all) {
      const lines = linesOf.get(adjustmentId);
      if (lines === undefined) linesOf.set(adjustmentId, [line]);
      else lines.push(line);
    }
  }
  const written = [];
  for (const { id, workingOrderId, createdAt, lineId, splits, ...columns } of records) {
    void workingOrderId;
    void createdAt;
    const lines = linesOf.get(id) ?? [];
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
