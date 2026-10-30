import { and, asc, eq, sql } from "drizzle-orm";
import { workingOrders, type Transaction } from "@waitron/db";
import { billIdentities } from "@waitron/venue-service";

/** The party's lowest-numbered `open` bill, or null when it has none. */
export async function firstOpenBillOf(tx: Transaction, partyId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .leftJoin(billIdentities, eq(billIdentities.workingOrderId, workingOrders.id))
    .where(and(eq(workingOrders.partyId, partyId), eq(workingOrders.status, "open")))
    .orderBy(
      sql`${billIdentities.number} is null`,
      asc(billIdentities.number),
      asc(workingOrders.id),
    )
    .limit(1);
  return row?.id ?? null;
}
