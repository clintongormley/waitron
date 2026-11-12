import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { testTradingAdmission } from "./trading-admission.js";
import { withTransaction, workingOrderLines, type Database, type Transaction } from "@waitron/db";
import { decimal, decimalToThousandths } from "@waitron/shared";
import { readBillEditState } from "../bill-editing.js";
import {
  mergeBills as merge,
  mergeCheckedBills as checked,
  moveDishes as moveLines,
  type BillCommand,
} from "../bill-actions.js";
import type { BillEditExpected } from "../order-drafts.js";
import type { TradingAdmission } from "../trading-admission.js";
import type { OriginConfig, TradingContext } from "../trading-context.js";
import { splitLinesWithinOrder, type OrderAttendance } from "../working-order.js";
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
  const route = /^\/api\/bills\/([^/]+)\/(merge|move-dishes)$/.exec(path);
  if (route === null || body === null || typeof body !== "object" || Array.isArray(body))
    return body;
  const ask = body as Record<string, unknown>;
  const billId = route[1]!;
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

type Transfers = { lineNo: number; quantity?: string }[];

// A line number naming no line resolves to a fresh id, so Move dishes refuses `tab.line_not_found`.
async function wholeDishIds(
  tx: Transaction,
  billId: string,
  transfers: Transfers,
): Promise<string[]> {
  const rows =
    transfers.length === 0
      ? []
      : await tx
          .select({
            id: workingOrderLines.id,
            lineNo: workingOrderLines.lineNo,
            quantity: workingOrderLines.quantity,
          })
          .from(workingOrderLines)
          .where(
            and(
              eq(workingOrderLines.workingOrderId, billId),
              inArray(
                workingOrderLines.lineNo,
                transfers.map((entry) => entry.lineNo),
              ),
            ),
          );
  const byLineNo = new Map(rows.map((row) => [row.lineNo, row]));
  return transfers.map((entry) => {
    const row = byLineNo.get(entry.lineNo);
    if (row === undefined) return randomUUID();
    if (
      entry.quantity !== undefined &&
      decimalToThousandths(decimal(entry.quantity)) !== row.quantity
    ) {
      throw new Error("A1196: part-of-a-line moves were retired; move whole dishes");
    }
    return row.id;
  });
}

/**
 * Cuts each entry's part off its line inside the bill and names the row each part now is, so the
 * parts can move as whole dishes.
 */
export async function cutParts(
  tx: Transaction,
  cfg: TradingContext,
  billId: string,
  transfers: Transfers,
): Promise<{ lineNo: number }[]> {
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      quantity: workingOrderLines.quantity,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId));
  const byLineNo = new Map(lines.map((row) => [row.lineNo, row]));
  const isPart = (entry: Transfers[number]): entry is { lineNo: number; quantity: string } =>
    entry.quantity !== undefined &&
    decimalToThousandths(decimal(entry.quantity)) !== byLineNo.get(entry.lineNo)?.quantity;
  const parts = transfers.filter(isPart);
  const cut = parts.length ? await splitLinesWithinOrder(tx, cfg, billId, parts) : new Map();
  return transfers.map((entry) =>
    isPart(entry)
      ? { lineNo: cut.get(byLineNo.get(entry.lineNo)!.id)!.lineNo }
      : { lineNo: entry.lineNo },
  );
}

/** Moves whole dishes to a new bill, through Move dishes. */
export async function splitBill(
  tx: Transaction,
  cfg: OriginConfig,
  billId: string,
  transfers: Transfers,
  command: BillCommand & { expectedEdit?: BillEditExpected; admission?: TradingAdmission },
): Promise<{ billId: string }> {
  const { expectedEdit, ...rest } = command;
  return moveLines(tx, cfg, billId, null, await wholeDishIds(tx, billId, transfers), {
    admission: testTradingAdmission(),
    ...rest,
    expectedEdits: [expectedEdit ?? (await readBillEditState(tx, billId))],
  });
}

/** Moves whole dishes to another bill, through Move dishes. */
export async function transferItems(
  tx: Transaction,
  cfg: OriginConfig,
  from: string,
  into: string,
  transfers: Transfers,
  command: BillCommand & { expectedEdits?: BillEditExpected[]; admission?: TradingAdmission },
): Promise<void> {
  await moveLines(tx, cfg, from, into, await wholeDishIds(tx, from, transfers), {
    admission: testTradingAdmission(),
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
  command: BillCommand & { expectedEdits?: BillEditExpected[]; admission?: TradingAdmission },
) {
  return moveLines(tx, cfg, from, to, lineIds, {
    admission: testTradingAdmission(),
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
  command: BillCommand & {
    expectedEdits?: BillEditExpected[];
    admission?: TradingAdmission;
    invoiceChoice?: unknown;
  },
  attendance?: OrderAttendance,
) {
  return merge(
    tx,
    cfg,
    into,
    from,
    {
      admission: testTradingAdmission(),
      ...command,
      expectedEdits: command.expectedEdits ?? (await editsFor(tx, [into, from])),
    },
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
