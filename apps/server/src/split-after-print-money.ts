import { and, eq } from "drizzle-orm";
import { billAdvances, billPayments, type Transaction } from "@waitron/db";
import { carryProviderRows } from "@waitron/payments";
import { AppError } from "@waitron/shared";
import { ordersWithUnfiledPayment } from "./till-sale.js";
import { refusePendingPartPayment, refuseRefundInProgress } from "./working-order-edit-state.js";
import "./errors.js";

/**
 * Reopen to split's refusals for the printed bill's money: money still moving, then an advance,
 * then a payment that cannot follow the dishes.
 */
export async function refuseSplitMoney(tx: Transaction, id: string): Promise<void> {
  await refusePendingPartPayment(tx, [id], "any");
  if ((await ordersWithUnfiledPayment(tx, [id])).has(id)) {
    throw new AppError("order.payment_in_flight", { workingOrderId: id });
  }
  await refuseRefundInProgress(tx, [id]);
  const [advance] = await tx
    .select({ id: billAdvances.id })
    .from(billAdvances)
    .where(eq(billAdvances.workingOrderId, id))
    .limit(1);
  if (advance !== undefined) throw new AppError("bill.has_advance", { workingOrderId: id });
  const [stays] = await tx
    .select({ id: billPayments.id })
    .from(billPayments)
    .where(
      and(
        eq(billPayments.workingOrderId, id),
        eq(billPayments.state, "received"),
        eq(billPayments.kind, "items"),
      ),
    )
    .limit(1);
  if (stays !== undefined) throw new AppError("bill.payments_received", { workingOrderId: id });
}

/**
 * Moves every received payment of the abandoned printed bill `fromBillId` to `toBillId`, the bill
 * reopened from it, where its money now counts, and a card's provider row with it, unlinked from
 * `fromSaleId`, the credited ticket. A failed or declined payment holds no money and stays as the
 * printed bill's history.
 */
export async function carryReceivedPayments(
  tx: Transaction,
  fromBillId: string,
  toBillId: string,
  fromSaleId: string,
): Promise<void> {
  const moved = await tx
    .update(billPayments)
    .set({ workingOrderId: toBillId })
    .where(and(eq(billPayments.workingOrderId, fromBillId), eq(billPayments.state, "received")))
    .returning({ id: billPayments.id });
  await carryProviderRows(tx, {
    billPaymentIds: moved.map((row) => row.id),
    toWorkingOrderId: toBillId,
    fromSaleId,
  });
}
