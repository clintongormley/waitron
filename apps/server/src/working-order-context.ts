import { type Database, type Transaction, workingOrders, workingOrderStatus } from "@waitron/db";
import type { TrustedClock, FiscalBackend } from "@waitron/fiscal";
import type { Logger } from "@waitron/server-kit";
import { eq } from "drizzle-orm";
import type { AttendanceRecorder } from "./attendance-capture.js";
import type { TradingAdmission } from "./trading-admission.js";

export interface WorkingOrderDeps {
  db: Database;
}

export interface OrderAttendance {
  recorder: AttendanceRecorder;
  clock: TrustedClock;
}

export async function captureOrderEdit(
  tx: Transaction,
  attendance: OrderAttendance | undefined,
  orderId: string,
  personId: string | undefined,
  revision: number,
  action:
    | "park"
    | "save"
    | "line"
    | "label"
    | "dining"
    | "discard"
    | "invoice-choice"
    | "receipt-language"
    | "adjustment"
    | "course"
    | "send"
    | "make-at",
  at?: string,
): Promise<void> {
  if (attendance === undefined || personId === undefined) return;
  await attendance.recorder(tx, {
    source: "order",
    key: `${orderId}:${revision}:${action}`,
    personId,
    kind: "order",
    at: at ?? attendance.clock.now().instant.toISOString(),
    offsetMinutes: 0,
    outcome: "qualified",
  });
}

export async function captureOrderService(
  tx: Transaction,
  attendance: (OrderAttendance & { personId: string }) | undefined,
  orderId: string,
  action: "course" | "send" | "make-at",
): Promise<void> {
  if (attendance === undefined) return;
  const [order] = await tx
    .select({ revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  await captureOrderEdit(tx, attendance, orderId, attendance.personId, order!.revision, action);
}

export interface TillSaleDeps {
  admission: TradingAdmission;
  db: Database;
  backend: FiscalBackend;
  clock: TrustedClock;
  attendance?: AttendanceRecorder;
  /** Where a failure that must not undo the sale or attempt around it is logged. */
  log?: Logger;
}

export async function isOpenOrder(tx: Transaction, orderId: string): Promise<boolean> {
  const [order] = await tx
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  return order?.status === "open";
}
/** An order's revision: what a copy of it read now carries back to an edit. */
export async function readOrderRevision(tx: Transaction, orderId: string): Promise<number> {
  const [order] = await tx
    .select({ revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  return order!.revision;
}
/** The service modes in which a counter order is sent to the kitchen before it is paid. */
const PAY_AFTER_SENDING: ReadonlySet<string> = new Set(["ticket_then_pay"]);
/** An order without a recorded zone mode uses the unscoped prepay default. */
export function paysAfterSending(mode: string | undefined): boolean {
  return PAY_AFTER_SENDING.has(mode ?? "prepay");
}

export type WorkingOrderStatus = (typeof workingOrderStatus.enumValues)[number];
