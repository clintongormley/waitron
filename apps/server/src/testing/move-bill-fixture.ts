import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { readBillEditState, readPartyBillIds } from "../bill-editing.js";
import {
  moveBill as move,
  type MoveBillOptions as Options,
  type MoveTarget,
} from "../move-bill.js";
import type { BillEditExpected } from "../order-drafts.js";
import { holderOf } from "../parties.js";
import type { OriginConfig } from "../till-config.js";
import type { OrderAttendance } from "../working-order.js";
export * from "../move-bill.js";
export type MoveBillOptions = Omit<Options, "expectedEdits"> & {
  expectedEdits?: BillEditExpected[];
};

// Preserve existing content scenarios while ownership/race cases pass the captured request directly.
export async function moveBill(
  tx: Transaction,
  cfg: OriginConfig,
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

export async function observedMoveBillBody(
  db: Database,
  path: string,
  body: unknown,
): Promise<unknown> {
  const match = /^\/api\/bills\/([^/]+)\/move$/.exec(path);
  if (
    match === null ||
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.hasOwn(body, "expectedEdits")
  )
    return body;
  const ask = body as Record<string, unknown>;
  const to = ask.to;
  const tableId =
    to !== null && typeof to === "object" && "tableId" in to && typeof to.tableId === "string"
      ? to.tableId
      : null;
  return withTransaction(db, async (tx) => {
    const other = tableId === null ? null : await holderOf(tx, tableId);
    const ids = [
      ...new Set([match[1]!, ...(other === null ? [] : await readPartyBillIds(tx, [other]))]),
    ].sort();
    const expectedEdits: BillEditExpected[] = [];
    for (const id of ids) expectedEdits.push(await readBillEditState(tx, id));
    return { expectedEdits, ...ask };
  });
}
