import { eq } from "drizzle-orm";
import { withTransaction, workingOrders, type Transaction } from "@waitron/db";
import { readBillEditState } from "../bill-editing.js";
import {
  sendLines as send,
  recallLines as recall,
  setLineCourse as course,
  updateOrderLine as line,
  updateHeldOrder as whole,
  setWorkingOrderLabel as label,
  setOrderReceiptLanguage as language,
  setOrderInvoiceChoice as invoice,
  placeOrder as place,
} from "../working-order.js";
import type { OrderAttendance, UpdateHeldOrderRequest } from "../working-order.js";

const OPERATOR = "cccccccc-0000-4000-8000-0000000000f1";
async function authority(tx: Transaction, id: string, operatorId: string | undefined) {
  const [order] = await tx
    .select({ partyId: workingOrders.partyId })
    .from(workingOrders)
    .where(eq(workingOrders.id, id));
  return {
    operatorId: order?.partyId == null ? operatorId : (operatorId ?? OPERATOR),
    expectedEdit: order?.partyId == null ? null : await readBillEditState(tx, id),
  };
}

// Content fixtures provide current observations; contract tests call the raw writers directly.
export async function sendLines(
  tx: Transaction,
  cfg: Parameters<typeof send>[1],
  id: string,
  lineNos: number[],
  attendance?: OrderAttendance & { personId: string },
) {
  return send(tx, cfg, id, lineNos, await authority(tx, id, attendance?.personId), attendance);
}
export async function recallLines(
  tx: Transaction,
  cfg: Parameters<typeof recall>[1],
  id: string,
  lineNos: number[],
  attendance?: OrderAttendance & { personId: string },
) {
  return recall(tx, cfg, id, lineNos, await authority(tx, id, attendance?.personId), attendance);
}
export async function setLineCourse(
  tx: Transaction,
  cfg: Parameters<typeof course>[1],
  id: string,
  lineNo: number,
  courseId: string | null,
  attendance?: OrderAttendance & { personId: string },
) {
  return course(
    tx,
    cfg,
    id,
    lineNo,
    courseId,
    await authority(tx, id, attendance?.personId),
    attendance,
  );
}
export async function updateOrderLine(
  tx: Transaction,
  cfg: Parameters<typeof line>[1],
  id: string,
  lineNo: number,
  patch: Parameters<typeof line>[4],
  revision: number,
  operatorId?: string,
  attendance?: OrderAttendance,
) {
  return line(
    tx,
    cfg,
    id,
    lineNo,
    patch,
    revision,
    await authority(tx, id, operatorId),
    attendance,
  );
}
export function updateHeldOrder(
  deps: Parameters<typeof whole>[0],
  cfg: Parameters<typeof whole>[1],
  id: string,
  input: Omit<UpdateHeldOrderRequest, "expectedEdit">,
  issue?: undefined,
  attendance?: OrderAttendance,
): Promise<number>;
export function updateHeldOrder(
  deps: Parameters<typeof whole>[0],
  cfg: Parameters<typeof whole>[1],
  id: string,
  input: Omit<UpdateHeldOrderRequest, "expectedEdit"> & { operatorId: string },
  issue: NonNullable<Parameters<typeof whole>[4]>,
  attendance?: OrderAttendance,
): Promise<number>;
export async function updateHeldOrder(
  deps: Parameters<typeof whole>[0],
  cfg: Parameters<typeof whole>[1],
  id: string,
  input: Omit<UpdateHeldOrderRequest, "expectedEdit">,
  issue?: Parameters<typeof whole>[4],
  attendance?: OrderAttendance,
) {
  const observed = await withTransaction(deps.db, (tx) => authority(tx, id, input.operatorId));
  const request = {
    ...input,
    operatorId: observed.operatorId,
    expectedEdit: observed.expectedEdit,
  };
  return issue === undefined
    ? whole(deps, cfg, id, request, undefined, attendance)
    : whole(deps, cfg, id, { ...request, operatorId: input.operatorId! }, issue, attendance);
}

export async function setWorkingOrderLabel(
  db: Parameters<typeof label>[0],
  id: string,
  request: { label: string; revision: number },
  attendance?: Parameters<typeof label>[3],
) {
  const observed = await withTransaction(db, (tx) => authority(tx, id, attendance?.personId));
  return label(db, id, { ...request, ...observed }, attendance);
}

export async function setOrderReceiptLanguage(
  db: Parameters<typeof language>[0],
  cfg: Parameters<typeof language>[1],
  id: string,
  request: { revision: number; language: unknown },
  attendance?: Parameters<typeof language>[4],
) {
  const observed = await withTransaction(db, (tx) => authority(tx, id, attendance?.personId));
  return language(db, cfg, id, { ...request, ...observed }, attendance);
}

export async function setOrderInvoiceChoice(
  db: Parameters<typeof invoice>[0],
  backend: Parameters<typeof invoice>[1],
  cfg: Parameters<typeof invoice>[2],
  id: string,
  request: Omit<Parameters<typeof invoice>[4], "operatorId" | "expectedEdit">,
  delivery?: Parameters<typeof invoice>[5],
  attendance?: Parameters<typeof invoice>[6],
) {
  const observed = await withTransaction(db, (tx) =>
    authority(tx, id, delivery?.personId ?? attendance?.personId),
  );
  return invoice(db, backend, cfg, id, { ...request, ...observed }, delivery, attendance);
}

export async function placeOrder(
  deps: Parameters<typeof place>[0],
  cfg: Parameters<typeof place>[1],
  id: string,
  operatorId: string,
) {
  const observed = await withTransaction(deps.db, (tx) => authority(tx, id, operatorId));
  return place(deps, cfg, id, operatorId, observed.expectedEdit);
}
