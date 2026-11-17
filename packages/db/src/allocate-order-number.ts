import { sql } from "drizzle-orm";
import type { Transaction } from "./client.js";
import { workingOrders } from "./schema/orders.js";

/**
 * The caller holds withTransaction's venue write lock through the bill insert.
 * working_orders_order_number_key refuses a repeated number.
 */
export async function allocateOrderNumber(tx: Transaction): Promise<number> {
  const [row] = await tx
    .select({ allocated: sql<number>`coalesce(max(${workingOrders.orderNumber}), 0) + 1` })
    .from(workingOrders);
  return row!.allocated;
}
