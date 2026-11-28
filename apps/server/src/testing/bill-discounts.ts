import { randomUUID } from "node:crypto";
import {
  findAdjustmentReason,
  insertPendingDiscount,
  policySnapshotOf,
  type NewPendingDiscount,
} from "@waitron/adjustments";
import type { Transaction } from "@waitron/db";
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
