import { and, asc, eq, sql } from "drizzle-orm";
import { workingOrders, type Transaction } from "@waitron/db";

/** The party's lowest-numbered `open` bill, or null when it has none. */
export async function firstOpenBillOf(tx: Transaction, partyId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(and(eq(workingOrders.partyId, partyId), eq(workingOrders.status, "open")))
    .orderBy(
      sql`${workingOrders.billNumber} is null`,
      asc(workingOrders.billNumber),
      asc(workingOrders.id),
    )
    .limit(1);
  return row?.id ?? null;
}
