import { and, eq, inArray, ne } from "drizzle-orm";
import { parties, sales, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { partyFamily } from "./parties.js";

/**
 * The guests a sale's receipt prints, read as the party is now, or `undefined` for no line: the
 * sale's bill belongs to a party with a count that was not merged into another, and that party and
 * every party merged into it hold exactly one bill that is not abandoned.
 */
export async function readReceiptGuests(
  tx: Transaction,
  saleId: string,
): Promise<number | undefined> {
  const [row] = await tx
    .select({
      partyId: parties.id,
      guests: parties.guestCount,
      mergedInto: parties.mergedIntoPartyId,
    })
    .from(sales)
    .innerJoin(workingOrders, eq(workingOrders.id, sales.workingOrderId))
    .innerJoin(parties, eq(parties.id, workingOrders.partyId))
    .where(eq(sales.id, saleId));
  if (row === undefined || row.guests === null || row.mergedInto !== null) return undefined;
  const family = await partyFamily(tx, row.partyId);
  const bills = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(and(inArray(workingOrders.partyId, family), ne(workingOrders.status, "abandoned")))
    .limit(2);
  return bills.length === 1 ? row.guests : undefined;
}
