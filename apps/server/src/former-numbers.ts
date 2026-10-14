import { and, asc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { ticketItems, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";

/**
 * Each order's "(was …)" numbers: the distinct numbers its kitchen items were sent under that are
 * not its own, lowest first. An order with none has no entry.
 */
export async function readFormerNumbers(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Map<string, number[]>> {
  const former = new Map<string, number[]>();
  if (orderIds.length === 0) return former;
  const rows = await tx
    .selectDistinct({
      orderId: ticketItems.workingOrderId,
      number: ticketItems.sentOrderNumber,
    })
    .from(ticketItems)
    .innerJoin(workingOrders, eq(workingOrders.id, ticketItems.workingOrderId))
    .where(
      and(
        inArray(ticketItems.workingOrderId, [...new Set(orderIds)]),
        isNotNull(ticketItems.sentOrderNumber),
        ne(ticketItems.sentOrderNumber, workingOrders.orderNumber),
      ),
    )
    .orderBy(asc(ticketItems.sentOrderNumber));
  for (const row of rows) {
    const numbers = former.get(row.orderId);
    if (numbers === undefined) former.set(row.orderId, [row.number!]);
    else numbers.push(row.number!);
  }
  return former;
}
