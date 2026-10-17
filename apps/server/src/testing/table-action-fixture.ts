import type { Transaction } from "@waitron/db";
import { readBillEditState, readPartyBillIds } from "../bill-editing.js";
import type { BillEditExpected } from "../order-drafts.js";
import { holderOf } from "../parties.js";
import {
  combineParties as combine,
  joinTables as join,
  moveGuests as move,
  splitTable as split,
  type TableActionOptions as Options,
} from "../table-actions.js";
import type { OriginConfig, TillConfig } from "../till-config.js";
import type { OrderAttendance } from "../working-order.js";
export * from "../table-actions.js";

export type TableActionOptions = Omit<Options, "expectedEdits"> & {
  expectedEdits?: BillEditExpected[];
};

export async function partyBillEditsForTest(
  tx: Transaction,
  partyIds: string[],
): Promise<BillEditExpected[]> {
  const edits: BillEditExpected[] = [];
  for (const billId of await readPartyBillIds(tx, partyIds))
    edits.push(await readBillEditState(tx, billId));
  return edits;
}

// Content fixtures supply the new contract; raw ownership tests keep their original expectations.
async function fixtureOptions(
  tx: Transaction,
  partyId: string,
  tableId: string,
  options: TableActionOptions,
): Promise<Options> {
  const other = await holderOf(tx, tableId);
  return {
    ...options,
    expectedEdits:
      options.expectedEdits ??
      (await partyBillEditsForTest(tx, other === null ? [partyId] : [partyId, other])),
  };
}

export async function joinTables(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  tableId: string,
  options: TableActionOptions,
  attendance?: OrderAttendance,
) {
  return join(
    tx,
    cfg,
    partyId,
    tableId,
    await fixtureOptions(tx, partyId, tableId, options),
    attendance,
  );
}
export async function moveGuests(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  tableId: string,
  options: TableActionOptions,
  attendance?: OrderAttendance,
) {
  return move(
    tx,
    cfg,
    partyId,
    tableId,
    await fixtureOptions(tx, partyId, tableId, options),
    attendance,
  );
}
export async function combineParties(
  tx: Transaction,
  cfg: TillConfig,
  args: Omit<Parameters<typeof combine>[2], "expectedEdits"> & {
    expectedEdits?: BillEditExpected[];
  },
  attendance?: OrderAttendance,
) {
  return combine(
    tx,
    cfg,
    {
      ...args,
      expectedEdits:
        args.expectedEdits ?? (await partyBillEditsForTest(tx, [args.from, args.into])),
    },
    attendance,
  );
}

export async function splitTable(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  tableId: string,
  billId: string | null,
  options: Omit<Parameters<typeof split>[5], "expectedEdits"> & {
    expectedEdits?: BillEditExpected[];
  },
  attendance?: OrderAttendance,
) {
  return split(
    tx,
    cfg,
    partyId,
    tableId,
    billId,
    {
      ...options,
      expectedEdits:
        options.expectedEdits ?? (billId === null ? [] : [await readBillEditState(tx, billId)]),
    },
    attendance,
  );
}
