import { and, eq } from "drizzle-orm";
import { billPayments, refunds, tenders, type Transaction } from "@waitron/db";
import { carryProviderRows } from "@waitron/payments";
import { AppError } from "@waitron/shared";
import { paidNoAdvance } from "./bill-advances.js";
import { ordersWithUnfiledPayment } from "./till-sale.js";
import { refusePendingPartPayment, refuseRefundInProgress } from "./working-order-edit-state.js";
import "./errors.js";

/**
 * Reopen bill's refusals for the printed bill's money: money still moving, a pending refund of a
 * payment on it included, which for an advance's payment names the advance's tender, not the
 * payment.
 */
export async function refuseSplitMoney(tx: Transaction, id: string): Promise<void> {
  await refusePendingPartPayment(tx, [id], "any");
  if ((await ordersWithUnfiledPayment(tx, [id])).has(id)) {
    throw new AppError("order.payment_in_flight", { workingOrderId: id });
  }
  await refuseRefundInProgress(tx, [id]);
  const [pending] = await tx
    .select({ id: refunds.id })
    .from(refunds)
    .innerJoin(tenders, eq(tenders.id, refunds.tenderId))
    .innerJoin(billPayments, eq(billPayments.id, tenders.billPaymentId))
    .where(and(eq(billPayments.workingOrderId, id), eq(refunds.state, "pending")))
    .limit(1);
  if (pending !== undefined) throw new AppError("bill.refund_in_progress", { workingOrderId: id });
}

/**
 * Moves every received payment of the abandoned printed bill `fromBillId` to `toBillId`, the bill
 * reopened from it, where its money now counts, and the provider row of a card that paid no
 * advance with it, unlinked from the credited ticket; an advance's card stays linked to the
 * advance's own sale. A failed or declined payment holds no money and stays as the printed bill's
 * history.
 */
export async function carryReceivedPayments(
  tx: Transaction,
  fromBillId: string,
  toBillId: string,
): Promise<void> {
  const received = and(
    eq(billPayments.workingOrderId, fromBillId),
    eq(billPayments.state, "received"),
  );
  const plain = await tx
    .select({ id: billPayments.id })
    .from(billPayments)
    .where(and(received, paidNoAdvance));
  await tx.update(billPayments).set({ workingOrderId: toBillId }).where(received);
  await carryProviderRows(tx, {
    billPaymentIds: plain.map((row) => row.id),
    toWorkingOrderId: toBillId,
  });
}
