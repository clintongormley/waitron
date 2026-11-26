import { and, eq } from "drizzle-orm";
import { sales, workingOrders, type Transaction } from "@waitron/db";
import { VENUE_SERVICE } from "./modules.js";
import { paysAfterSending } from "./working-order-context.js";

/** A Counter order (no party) sent to the kitchen, in a zone that takes payment after sending. */
export async function sentUnpaidCounterOrder(
  tx: Transaction,
  id: string,
  order: { status: string; partyId: string | null },
): Promise<boolean> {
  if (order.status !== "placed" || order.partyId !== null) return false;
  const context = await VENUE_SERVICE.findOrderContext(tx, id);
  return paysAfterSending(context?.serviceMode);
}

/** {@link sentUnpaidCounterOrder} whose receipt is not issued. */
export async function sentCounterOrderWithoutReceipt(
  tx: Transaction,
  orderId: string,
  order: { status: string; partyId: string | null },
): Promise<boolean> {
  return (await sentUnpaidCounterOrder(tx, orderId, order)) && !(await hasInvoice(tx, orderId));
}

export async function hasInvoice(tx: Transaction, workingOrderId: string): Promise<boolean> {
  const [invoice] = await tx
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.workingOrderId, workingOrderId))
    .limit(1);
  return invoice !== undefined;
}

/**
 * Runs `move` with a sent Counter order with no receipt ({@link sentCounterOrderWithoutReceipt})
 * back at `open`, and sets it `placed` again if `move` left it open; any other bill, `move` alone.
 * `sent` is that answer when the caller read it earlier in this transaction. The database lets a
 * placed order with no party, no sale and a pay-after-sending mode go back to open by a
 * status-only update (`working_orders_enforce_transition`), and then allows anything an open
 * order allows; outside
 * this file, `scripts/sent-order-open.test.ts` finds no product write of a literal open status.
 * A caller that catches a refusal from `move` must do so outside a savepoint wrapping this call,
 * or the order is left open.
 */
export async function withSentOrderOpen<T>(
  tx: Transaction,
  orderId: string,
  move: () => Promise<T>,
  sent?: boolean,
): Promise<T> {
  if (!(sent ?? (await readSent(tx, orderId)))) return move();
  await tx.update(workingOrders).set({ status: "open" }).where(eq(workingOrders.id, orderId));
  const result = await move();
  await tx
    .update(workingOrders)
    .set({ status: "placed" })
    .where(and(eq(workingOrders.id, orderId), eq(workingOrders.status, "open")));
  return result;
}

async function readSent(tx: Transaction, orderId: string): Promise<boolean> {
  const [order] = await tx
    .select({ status: workingOrders.status, partyId: workingOrders.partyId })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  return order !== undefined && (await sentCounterOrderWithoutReceipt(tx, orderId, order));
}
