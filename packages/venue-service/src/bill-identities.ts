import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { workingOrders, type Transaction } from "@waitron/db";
import type { BillIdentity } from "@waitron/module";
import { billIdentities, billNumberAllocations } from "./schema/bill-identities.js";

/**
 * Give a bill the party's next number. The next number is read from the history, not from the
 * bills the party shows now, so a number whose bill merged away or left is never given again.
 */
export async function allocateBillNumber(
  tx: Transaction,
  billId: string,
  partyId: string,
): Promise<number> {
  const [top] = await tx
    .select({ number: sql<number | null>`max(${billNumberAllocations.number})` })
    .from(billNumberAllocations)
    .where(eq(billNumberAllocations.partyId, partyId));
  const number = (top?.number ?? 0) + 1;
  await tx.insert(billNumberAllocations).values({ partyId, number, workingOrderId: billId });
  await tx
    .insert(billIdentities)
    .values({ workingOrderId: billId, partyId, number })
    .onConflictDoUpdate({ target: billIdentities.workingOrderId, set: { partyId, number } });
  return number;
}

/**
 * Give every bill numbered in `fromPartyId` that is not abandoned the next numbers of `intoPartyId`,
 * in their old number order. Run it after any merge, so a bill merged away keeps its old row.
 */
export async function rescopeBillNumbers(
  tx: Transaction,
  fromPartyId: string,
  intoPartyId: string,
): Promise<void> {
  const rows = await tx
    .select({ billId: billIdentities.workingOrderId })
    .from(billIdentities)
    .innerJoin(workingOrders, eq(workingOrders.id, billIdentities.workingOrderId))
    .where(and(eq(billIdentities.partyId, fromPartyId), ne(workingOrders.status, "abandoned")))
    .orderBy(asc(billIdentities.number), asc(billIdentities.workingOrderId));
  for (const { billId } of rows) await allocateBillNumber(tx, billId, intoPartyId);
}

/** A bill leaving for the counter keeps its name and loses its number; its history row stays. */
export async function releaseBillNumber(tx: Transaction, billId: string): Promise<void> {
  await tx
    .update(billIdentities)
    .set({ partyId: null, number: null })
    .where(eq(billIdentities.workingOrderId, billId));
}

export async function setBillName(
  tx: Transaction,
  billId: string,
  name: string | null,
): Promise<void> {
  const updated = await tx
    .update(billIdentities)
    .set({ name })
    .where(eq(billIdentities.workingOrderId, billId))
    .returning({ billId: billIdentities.workingOrderId });
  if (updated.length === 0) throw new Error(`bill ${billId} has no identity to name`);
}

export async function readBillIdentities(
  tx: Transaction,
  billIds: readonly string[],
): Promise<ReadonlyMap<string, BillIdentity>> {
  if (billIds.length === 0) return new Map();
  const rows = await tx
    .select({
      billId: billIdentities.workingOrderId,
      number: billIdentities.number,
      name: billIdentities.name,
    })
    .from(billIdentities)
    .where(inArray(billIdentities.workingOrderId, [...billIds]));
  return new Map(rows.map(({ billId, number, name }) => [billId, { number, name }]));
}
