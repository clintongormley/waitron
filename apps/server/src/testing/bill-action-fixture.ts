import { testTradingAdmission } from "./trading-admission.js";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { readBillEditState } from "../bill-editing.js";
import {
  mergeBills as merge,
  mergeCheckedBills as checked,
  moveDishes as moveLines,
  splitBill as split,
  transferItems as transfer,
  type BillCommand,
} from "../bill-actions.js";
import type { BillEditExpected } from "../order-drafts.js";
import type { OriginConfig, TradingContext } from "../trading-context.js";
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
  const route = /^\/api\/bills\/([^/]+)\/(split|merge|transfer|move-dishes)$/.exec(path);
  if (route === null || body === null || typeof body !== "object" || Array.isArray(body))
    return body;
  const ask = body as Record<string, unknown>;
  const billId = route[1]!;
  if (route[2] === "split") return { expectedEdit: await readBillEditState(tx, billId), ...ask };
  const other = route[2] === "merge" ? ask.fromBillId : ask.toBillId;
  return {
    expectedEdits: await editsFor(tx, [billId, ...(typeof other === "string" ? [other] : [])]),
    ...ask,
  };
}

async function editsFor(tx: Transaction, billIds: string[]): Promise<BillEditExpected[]> {
  const edits: BillEditExpected[] = [];
  for (const id of [...new Set(billIds)].sort()) edits.push(await readBillEditState(tx, id));
  return edits;
}

export async function splitBill(
  tx: Transaction,
  cfg: OriginConfig,
  billId: string,
  transfers: Parameters<typeof split>[3],
  command: BillCommand & { expectedEdit?: BillEditExpected },
) {
  return split(tx, cfg, billId, transfers, {
    admission: testTradingAdmission(),
    ...command,
    expectedEdit: command.expectedEdit ?? (await readBillEditState(tx, billId)),
  });
}

export async function transferItems(
  tx: Transaction,
  cfg: TradingContext,
  from: string,
  into: string,
  transfers: Parameters<typeof transfer>[4],
  command: BillCommand & { expectedEdits?: BillEditExpected[] },
) {
  return transfer(tx, cfg, from, into, transfers, {
    ...command,
    expectedEdits: command.expectedEdits ?? (await editsFor(tx, [from, into])),
  });
}

export async function moveDishes(
  tx: Transaction,
  cfg: OriginConfig,
  from: string,
  to: string | null,
  lineIds: readonly string[],
  command: BillCommand & { expectedEdits?: BillEditExpected[] },
) {
  return moveLines(tx, cfg, from, to, lineIds, {
    ...command,
    expectedEdits: command.expectedEdits ?? (await editsFor(tx, to === null ? [from] : [from, to])),
  });
}

// Content fixtures provide current expectations; ownership/race tests call the writer directly.
export async function mergeBills(
  tx: Transaction,
  cfg: TradingContext,
  into: string,
  from: string,
  command: BillCommand & { expectedEdits?: BillEditExpected[] },
  attendance?: OrderAttendance,
) {
  return merge(
    tx,
    cfg,
    into,
    from,
    { ...command, expectedEdits: command.expectedEdits ?? (await editsFor(tx, [into, from])) },
    attendance,
  );
}

export async function mergeCheckedBills(
  tx: Transaction,
  cfg: TradingContext,
  into: string,
  from: string,
  known: Omit<Parameters<typeof checked>[4], "expectedEdits"> & {
    expectedEdits?: BillEditExpected[];
  },
) {
  return checked(tx, cfg, into, from, {
    ...known,
    expectedEdits: known.expectedEdits ?? (await editsFor(tx, [into, from])),
  });
}
