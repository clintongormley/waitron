import type { Transaction } from "@waitron/db";
import { readBillEditState } from "../bill-editing.js";
import {
  mergeBills as merge,
  mergeCheckedBills as checked,
  type BillCommand,
} from "../bill-actions.js";
import type { BillEditExpected } from "../order-drafts.js";
import type { TillConfig } from "../till-config.js";
import type { OrderAttendance } from "../working-order.js";
export * from "../bill-actions.js";

// Content fixtures provide current expectations; ownership/race tests call the writer directly.
export async function mergeBills(
  tx: Transaction,
  cfg: TillConfig,
  into: string,
  from: string,
  command: BillCommand & { expectedEdits?: BillEditExpected[] },
  attendance?: OrderAttendance,
) {
  const expectedEdits: BillEditExpected[] = [];
  if (command.expectedEdits === undefined)
    for (const id of [...new Set([into, from])].sort())
      expectedEdits.push(await readBillEditState(tx, id));
  return merge(
    tx,
    cfg,
    into,
    from,
    { ...command, expectedEdits: command.expectedEdits ?? expectedEdits },
    attendance,
  );
}

export async function mergeCheckedBills(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  into: string,
  from: string,
  known: Omit<Parameters<typeof checked>[5], "expectedEdits"> & {
    expectedEdits?: BillEditExpected[];
  },
) {
  const expectedEdits: BillEditExpected[] = [];
  if (known.expectedEdits === undefined)
    for (const id of [...new Set([into, from])].sort())
      expectedEdits.push(await readBillEditState(tx, id));
  return checked(tx, cfg, partyId, into, from, {
    ...known,
    expectedEdits: known.expectedEdits ?? expectedEdits,
  });
}
