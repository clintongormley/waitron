import type { Transaction } from "@waitron/db";
import { readBillEditState, readPartyBillIds } from "../bill-editing.js";
import {
  moveBill as move,
  type MoveBillOptions as Options,
  type MoveTarget,
} from "../move-bill.js";
import type { BillEditExpected } from "../order-drafts.js";
import { holderOf } from "../parties.js";
import type { TillConfig } from "../till-config.js";
import type { OrderAttendance } from "../working-order.js";
export * from "../move-bill.js";
export type MoveBillOptions = Omit<Options, "expectedEdits"> & {
  expectedEdits?: BillEditExpected[];
};

// Preserve existing content scenarios while ownership/race cases pass the captured request directly.
export async function moveBill(
  tx: Transaction,
  cfg: TillConfig,
  billId: string,
  to: MoveTarget,
  options: MoveBillOptions,
  attendance?: OrderAttendance,
) {
  const expectedEdits: BillEditExpected[] = [];
  if (options.expectedEdits === undefined) {
    const other = "tableId" in to ? await holderOf(tx, to.tableId) : null;
    const ids = other === null ? [billId] : [billId, ...(await readPartyBillIds(tx, [other]))];
    for (const id of [...new Set(ids)].sort()) expectedEdits.push(await readBillEditState(tx, id));
  }
  return move(
    tx,
    cfg,
    billId,
    to,
    { ...options, expectedEdits: options.expectedEdits ?? expectedEdits },
    attendance,
  );
}
