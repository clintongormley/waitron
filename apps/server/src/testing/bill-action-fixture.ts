import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { readBillEditState } from "../bill-editing.js";
import {
  mergeBills as merge,
  mergeCheckedBills as checked,
  splitBill as split,
  transferItems as transfer,
  type BillCommand,
} from "../bill-actions.js";
import type { BillEditExpected } from "../order-drafts.js";
import type { OriginConfig, TillConfig } from "../till-config.js";
import type { OrderAttendance } from "../working-order.js";
export * from "../bill-actions.js";

export async function observedBillActionBody(
  db: Database,
  path: string,
  body: unknown,
): Promise<unknown> {
  return withTransaction(db, (tx) => billActionBody(tx, path, body));
}

// Old content-route fixtures supply observations; raw contract tests send their literal bodies.
export async function billActionBody(
  tx: Transaction,
  path: string,
  body: unknown,
): Promise<unknown> {
  const route = /^\/api\/bills\/([^/]+)\/(split|merge|transfer)$/.exec(path);
  if (route === null || body === null || typeof body !== "object" || Array.isArray(body))
    return body;
  const ask = body as Record<string, unknown>;
  const billId = route[1]!;
  if (route[2] === "split") return { expectedEdit: await readBillEditState(tx, billId), ...ask };
  const other = route[2] === "merge" ? ask.fromBillId : ask.toBillId;
  const expectedEdits: BillEditExpected[] = [];
  for (const id of [...new Set([billId, ...(typeof other === "string" ? [other] : [])])].sort())
    expectedEdits.push(await readBillEditState(tx, id));
  return { expectedEdits, ...ask };
}

export async function splitBill(
  tx: Transaction,
  cfg: OriginConfig,
  billId: string,
  transfers: Parameters<typeof split>[3],
  command: BillCommand & { expectedEdit?: BillEditExpected },
) {
  return split(tx, cfg, billId, transfers, {
    ...command,
    expectedEdit: command.expectedEdit ?? (await readBillEditState(tx, billId)),
  });
}

export async function transferItems(
  tx: Transaction,
  cfg: TillConfig,
  from: string,
  into: string,
  transfers: Parameters<typeof transfer>[4],
  command: BillCommand & { expectedEdits?: BillEditExpected[] },
) {
  const expectedEdits: BillEditExpected[] = [];
  if (command.expectedEdits === undefined)
    for (const id of [...new Set([from, into])].sort())
      expectedEdits.push(await readBillEditState(tx, id));
  return transfer(tx, cfg, from, into, transfers, {
    ...command,
    expectedEdits: command.expectedEdits ?? expectedEdits,
  });
}

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
