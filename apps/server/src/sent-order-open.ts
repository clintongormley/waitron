import { and, eq } from "drizzle-orm";
import { workingOrders, type Transaction } from "@waitron/db";
import { hasInvoice } from "./bill-payments.js";

/** A Counter order (no party) sent to the kitchen whose receipt is not issued. */
export async function isSentCounterOrder(
  tx: Transaction,
  orderId: string,
  order: { status: string; partyId: string | null },
): Promise<boolean> {
  return order.status === "placed" && order.partyId === null && !(await hasInvoice(tx, orderId));
}

/**
 * Runs `move` with a sent Counter order with no receipt back at `open`, and sets it `placed` again
 * if `move` left it open; any other bill, `move` alone. The database lets a placed order with no
 * sale go back to open by a status-only update (`working_orders_enforce_transition`), and then
 * allows anything an open order allows: this file is the one product file that writes that
 * status (`scripts/sent-order-open.test.ts`).
 */
export async function withSentOrderOpen<T>(
  tx: Transaction,
  orderId: string,
  move: () => Promise<T>,
): Promise<T> {
  const [order] = await tx
    .select({ status: workingOrders.status, partyId: workingOrders.partyId })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  if (order === undefined || !(await isSentCounterOrder(tx, orderId, order))) return move();
  await tx.update(workingOrders).set({ status: "open" }).where(eq(workingOrders.id, orderId));
  const result = await move();
  await tx
    .update(workingOrders)
    .set({ status: "placed" })
    .where(and(eq(workingOrders.id, orderId), eq(workingOrders.status, "open")));
  return result;
}

/** The kitchen screen lists every order not yet collected, so dishes leaving a handed-over order
 * take its hand-over with them. */
export async function carryHandover(tx: Transaction, fromId: string, toId: string): Promise<void> {
  const [from] = await tx
    .select({ collectedAt: workingOrders.collectedAt })
    .from(workingOrders)
    .where(eq(workingOrders.id, fromId));
  if (from?.collectedAt == null) return;
  await tx
    .update(workingOrders)
    .set({ collectedAt: from.collectedAt })
    .where(eq(workingOrders.id, toId));
}
