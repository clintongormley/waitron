import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { parties, workingOrders, type Transaction } from "@waitron/db";
import type { BillIdentity } from "@waitron/module";

export async function allocateBillNumber(
  tx: Transaction,
  billId: string,
  partyId: string,
): Promise<number> {
  const [party] = await tx
    .update(parties)
    .set({ lastBillNumber: sql`${parties.lastBillNumber} + 1` })
    .where(eq(parties.id, partyId))
    .returning({ number: parties.lastBillNumber });
  const number = party!.number;
  await tx
    .update(workingOrders)
    .set({ partyId, billNumber: number })
    .where(eq(workingOrders.id, billId));
  return number;
}

/** The caller captures number order before clearing numbers and moving the bills. */
export async function rescopeBillNumbers(
  tx: Transaction,
  billIds: readonly string[],
  intoPartyId: string,
): Promise<void> {
  for (const billId of billIds) await allocateBillNumber(tx, billId, intoPartyId);
}

export async function releaseBillNumber(tx: Transaction, billId: string): Promise<void> {
  await tx.update(workingOrders).set({ billNumber: null }).where(eq(workingOrders.id, billId));
}

export async function setBillName(
  tx: Transaction,
  billId: string,
  name: string | null,
): Promise<void> {
  const updated = await tx
    .update(workingOrders)
    .set({ billName: name })
    .where(and(eq(workingOrders.id, billId), isNotNull(workingOrders.partyId)))
    .returning({ billId: workingOrders.id });
  if (updated.length === 0) throw new Error(`bill ${billId} has no party to name`);
}

export async function readBillIdentities(
  tx: Transaction,
  billIds: readonly string[],
): Promise<ReadonlyMap<string, BillIdentity>> {
  if (billIds.length === 0) return new Map();
  const rows = await tx
    .select({
      billId: workingOrders.id,
      partyId: workingOrders.partyId,
      number: workingOrders.billNumber,
      name: workingOrders.billName,
    })
    .from(workingOrders)
    .where(
      and(
        inArray(workingOrders.id, [...billIds]),
        or(isNotNull(workingOrders.partyId), isNotNull(workingOrders.billName)),
      ),
    );
  return new Map(rows.map(({ billId, ...identity }) => [billId, identity]));
}
