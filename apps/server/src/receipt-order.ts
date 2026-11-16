import "./errors.js";
import { eq } from "drizzle-orm";
import {
  orderTableLabels,
  parties,
  partyTableLabels,
  sales,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { AppError, partyReceiptLabel } from "@waitron/shared";

/**
 * Resolve the commercial grouping shown on receipts and payment slips. A party bill shows the party's
 * name and its active tables ({@link partyReceiptLabel}), or its own label once the party holds none;
 * any other order its table as {@link orderTableLabels} names it.
 */
export async function readReceiptOrder(
  tx: Transaction,
  workingOrderId: string,
  opts: { atIssuance?: boolean } = {},
): Promise<{ orderLabel: string | null; orderNumber: number; takeAway?: true }> {
  const [order] = await tx
    .select({
      orderNumber: workingOrders.orderNumber,
      label: workingOrders.label,
      dining: workingOrders.dining,
      deliveryTableId: workingOrders.deliveryTableId,
      deliveryTableLabel: workingOrders.deliveryTableLabel,
      partyId: parties.id,
      partyName: parties.name,
      saleId: sales.id,
    })
    .from(workingOrders)
    .leftJoin(parties, eq(parties.id, workingOrders.partyId))
    .leftJoin(sales, eq(sales.workingOrderId, workingOrders.id))
    .where(eq(workingOrders.id, workingOrderId));
  if (order === undefined) {
    throw new AppError("working_order.not_found", { workingOrderId });
  }
  const takeAway = order.dining === "takeaway" ? { takeAway: true as const } : {};
  // Issuance freezes the grouping onto the order; later table edits cannot change the document.
  if (!opts.atIssuance && order.saleId !== null) {
    return { orderLabel: order.label, orderNumber: order.orderNumber, ...takeAway };
  }
  if (order.partyId !== null) {
    const labels = (await partyTableLabels(tx, [order.partyId])).get(order.partyId)!;
    return {
      orderLabel: labels.length === 0 ? order.label : partyReceiptLabel(order.partyName, labels),
      orderNumber: order.orderNumber,
      ...takeAway,
    };
  }
  const labels = await orderTableLabels(tx, [
    {
      id: workingOrderId,
      partyId: null,
      deliveryTableId: order.deliveryTableId,
      deliveryTableLabel: order.deliveryTableLabel,
      label: order.label,
    },
  ]);
  return { orderLabel: labels.get(workingOrderId)!, orderNumber: order.orderNumber, ...takeAway };
}
