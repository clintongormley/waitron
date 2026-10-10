import { eq } from "drizzle-orm";
import { workingOrders } from "@waitron/db";
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
