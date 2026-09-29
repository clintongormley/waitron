import "./errors.js";
import { eq } from "drizzle-orm";
import {
  diningTables,
  parties,
  partyTableLabels,
  sales,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { AppError, partyReceiptLabel } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";

/**
 * Resolve the commercial grouping shown on receipts and payment slips. A party bill shows the party's
 * name and its active tables ({@link partyReceiptLabel}), or its own label once the party holds none.
 */
export async function readReceiptOrder(
  tx: Transaction,
  cfg: TillConfig,
  workingOrderId: string,
  opts: { atIssuance?: boolean } = {},
): Promise<{ orderLabel: string | null; orderNumber: number }> {
  void cfg;
  const [order] = await tx
    .select({
      orderNumber: workingOrders.orderNumber,
      label: workingOrders.label,
      deliveryTableId: workingOrders.deliveryTableId,
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
  // Issuance freezes the grouping onto the order; later table edits cannot change the document.
  if (!opts.atIssuance && order.saleId !== null) {
    return { orderLabel: order.label, orderNumber: order.orderNumber };
  }
  if (order.partyId !== null) {
    const labels = (await partyTableLabels(tx, [order.partyId])).get(order.partyId)!;
    return {
      orderLabel: labels.length === 0 ? order.label : partyReceiptLabel(order.partyName, labels),
      orderNumber: order.orderNumber,
    };
  }
  if (order.deliveryTableId === null) {
    return { orderLabel: order.label, orderNumber: order.orderNumber };
  }
  const [table] = await tx
    .select({ label: diningTables.label })
    .from(diningTables)
    .where(eq(diningTables.id, order.deliveryTableId));
  return { orderLabel: table!.label, orderNumber: order.orderNumber };
}
