import { and, asc, eq, ne, isNotNull, or } from "drizzle-orm";
import { expect } from "vitest";
import {
  parties,
  withTransaction,
  workingOrders,
  type Database,
  type Transaction,
} from "@waitron/db";
import { VENUE_SERVICE } from "../modules.js";

type HasDb = { db: Database };

/** The bills numbered in the party, as `[billId, number, name]`, in number order. */
export async function numbersOf(
  v: HasDb,
  partyId: string,
): Promise<[string, number | null, string | null][]> {
  const rows = await withTransaction(v.db, (tx) =>
    tx
      .select({
        billId: workingOrders.id,
        number: workingOrders.billNumber,
        name: workingOrders.billName,
      })
      .from(workingOrders)
      .where(and(eq(workingOrders.partyId, partyId), isNotNull(workingOrders.billNumber)))
      .orderBy(asc(workingOrders.billNumber)),
  );
  return rows.map((row) => [row.billId, row.number, row.name]);
}

export async function lastBillNumberOf(v: HasDb, partyId: string): Promise<number> {
  const [row] = await withTransaction(v.db, (tx) =>
    tx.select({ number: parties.lastBillNumber }).from(parties).where(eq(parties.id, partyId)),
  );
  return row!.number;
}

export async function billNumberTables(v: HasDb) {
  return withTransaction(v.db, async (tx) => ({
    identities: await tx
      .select({
        workingOrderId: workingOrders.id,
        partyId: workingOrders.partyId,
        number: workingOrders.billNumber,
        name: workingOrders.billName,
      })
      .from(workingOrders)
      .where(or(isNotNull(workingOrders.partyId), isNotNull(workingOrders.billName)))
      .orderBy(workingOrders.id),
    allocations: await tx
      .select({ partyId: parties.id, lastBillNumber: parties.lastBillNumber })
      .from(parties)
      .orderBy(parties.id),
  }));
}

/** Number a bill a fixture inserted by hand, as opening it at the party would have. */
export async function numberBill(
  tx: Transaction,
  billId: string,
  partyId: string,
): Promise<number> {
  return VENUE_SERVICE.allocateBillNumber(tx, billId, partyId);
}

/**
 * Every bill on a party that is not abandoned is numbered in the party that shows it: the party
 * its own party was merged into, followed to the end.
 */
export async function expectEveryPartyBillNumbered(tx: Transaction): Promise<void> {
  const partyRows = await tx
    .select({ id: parties.id, mergedInto: parties.mergedIntoPartyId })
    .from(parties);
  const mergedInto = new Map(partyRows.map((row) => [row.id, row.mergedInto]));
  const rootOf = (partyId: string): string => {
    let at = partyId;
    for (let next = mergedInto.get(at); next != null; next = mergedInto.get(at)) at = next;
    return at;
  };
  const bills = await tx
    .select({ id: workingOrders.id, partyId: workingOrders.partyId })
    .from(workingOrders)
    .where(ne(workingOrders.status, "abandoned"));
  const rows = await tx
    .select({
      billId: workingOrders.id,
      partyId: workingOrders.partyId,
      number: workingOrders.billNumber,
    })
    .from(workingOrders);
  const scopes = new Map(rows.map((row) => [row.billId, row]));
  const unnumbered = bills
    .filter((bill) => bill.partyId !== null)
    .filter((bill) => {
      const scope = scopes.get(bill.id);
      return scope?.number == null || scope.partyId !== rootOf(bill.partyId!);
    })
    .map((bill) => bill.id);
  expect(unnumbered).toEqual([]);
}
