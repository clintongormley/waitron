import { eq, getTableColumns } from "drizzle-orm";
import { ticketItems, workingOrderLines, type Transaction } from "@waitron/db";

export function ticketItemsWithBill(tx: Transaction) {
  return tx
    .select({ ...getTableColumns(ticketItems), workingOrderId: workingOrderLines.workingOrderId })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId));
}
