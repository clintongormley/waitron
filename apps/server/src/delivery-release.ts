import { eq, sql, type SQL } from "drizzle-orm";
import { ticketItems, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";

/**
 * Every order delivered to `tableId` lets go of it and keeps `label` as its table's name. The
 * caller decides the table is tied to nothing live; this only writes.
 */
export async function releaseDeliveries(
  tx: Transaction,
  tableId: string,
  label: string,
): Promise<void> {
  await tx
    .update(workingOrders)
    .set({ deliveryTableId: null, deliveryTableLabel: label })
    .where(eq(workingOrders.deliveryTableId, tableId));
}

/**
 * An order with food on its way to its delivery table: not abandoned, not collected, and holding a
 * ticket item the kitchen makes. The floor shows such a table as waiting for a delivery, and table
 * removal treats it as tied, so both read this one condition. It names `working_orders` unaliased.
 */
export function foodOnItsWay(): SQL {
  return sql`(${workingOrders.status} <> 'abandoned' and ${workingOrders.collectedAt} is null
    and exists (
      select 1 from ${ticketItems}
      where ${ticketItems.workingOrderId} = ${workingOrders.id} and ${ticketItems.madeHere} = 0))`;
}
