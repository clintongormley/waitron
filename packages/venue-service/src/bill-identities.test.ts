import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  locations,
  parties,
  withTransaction,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  allocateBillNumber,
  readBillIdentities,
  releaseBillNumber,
  rescopeBillNumbers,
  setBillName,
} from "./bill-identities.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { billIdentities, billNumberAllocations } from "./schema/bill-identities.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
const actor = randomUUID();
const tx = <T>(fn: (t: Transaction) => Promise<T>) => withTransaction(suite.db, fn);
let locationId: string;
let nextOrderNumber = 1;

beforeEach(async () => {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Sala",
      invoiceLocales: ["en"],
      operationDescription: "Restaurant",
      timeZone: "UTC",
    })
    .returning();
  locationId = location!.id;
});

async function newParty(): Promise<string> {
  const [party] = await suite.db.insert(parties).values({ openedBy: actor }).returning();
  return party!.id;
}

async function newBill(partyId: string | null, id: string = randomUUID()): Promise<string> {
  await suite.db
    .insert(workingOrders)
    .values({ id, locationId, partyId, orderNumber: nextOrderNumber++, source: "dashboard" });
  return id;
}

const allocate = (billId: string, partyId: string) =>
  tx((t) => allocateBillNumber(t, billId, partyId));

async function identitiesOf(partyId: string) {
  return suite.db
    .select({ bill: billIdentities.workingOrderId, number: billIdentities.number })
    .from(billIdentities)
    .where(eq(billIdentities.partyId, partyId))
    .orderBy(asc(billIdentities.number));
}

async function bothTables() {
  const identities = await suite.db
    .select()
    .from(billIdentities)
    .orderBy(asc(billIdentities.workingOrderId));
  const history = await suite.db
    .select()
    .from(billNumberAllocations)
    .orderBy(asc(billNumberAllocations.partyId), asc(billNumberAllocations.number));
  return { identities, history };
}

describe("A803 bill numbers (seat)", () => {
  it("A803 bill numbers (seat): the first bill of a party is 1 and each next one counts up", async () => {
    const party = await newParty();
    const bills = [await newBill(party), await newBill(party), await newBill(party)];
    const numbers = [];
    for (const bill of bills) numbers.push(await allocate(bill, party));
    expect(numbers).toEqual([1, 2, 3]);
    expect(await identitiesOf(party)).toEqual(bills.map((bill, i) => ({ bill, number: i + 1 })));
  });

  it("A803 bill numbers (seat): the party's highest-numbered bill, numbered elsewhere, is not given its number again", async () => {
    const party = await newParty();
    const elsewhere = await newParty();
    const bills = [await newBill(party), await newBill(party), await newBill(party)];
    for (const bill of bills) await allocate(bill, party);
    expect(await allocate(bills[2]!, elsewhere)).toBe(1);
    const fourth = await newBill(party);
    expect(await allocate(fourth, party)).toBe(4);
    expect(await identitiesOf(party)).toEqual([
      { bill: bills[0], number: 1 },
      { bill: bills[1], number: 2 },
      { bill: fourth, number: 4 },
    ]);
  });

  it("A803 bill numbers (seat): renumbering a closed party's bills gives them the other party's next numbers in their own number order, keeps their names and leaves an abandoned bill's row as it was", async () => {
    const from = await newParty();
    const into = await newParty();
    const kept = await newBill(into);
    await allocate(kept, into);
    // Ids run against the numbers, so an order by id would give a different answer.
    const one = await newBill(from, "ffffffff-0000-4000-8000-000000000001");
    const two = await newBill(from, "cccccccc-0000-4000-8000-000000000002");
    const gone = await newBill(from, "bbbbbbbb-0000-4000-8000-000000000003");
    const four = await newBill(from, "aaaaaaaa-0000-4000-8000-000000000004");
    for (const bill of [one, two, gone, four]) await allocate(bill, from);
    await tx((t) => setBillName(t, two, "Clint"));
    await suite.db
      .update(workingOrders)
      .set({ status: "abandoned" })
      .where(eq(workingOrders.id, gone));

    await tx((t) => rescopeBillNumbers(t, from, into));

    expect(await identitiesOf(into)).toEqual([
      { bill: kept, number: 1 },
      { bill: one, number: 2 },
      { bill: two, number: 3 },
      { bill: four, number: 4 },
    ]);
    expect(await identitiesOf(from)).toEqual([{ bill: gone, number: 3 }]);
    const names = await tx((t) => readBillIdentities(t, [two]));
    expect(names.get(two)).toEqual({ partyId: into, number: 3, name: "Clint" });
  });

  it("A803 bill numbers (seat): dropping a bill's number keeps its name, and returning it to a party gives it that party's next number with its name", async () => {
    const party = await newParty();
    const other = await newParty();
    const first = await newBill(party);
    const bill = await newBill(party);
    await allocate(first, party);
    await allocate(bill, party);
    await tx((t) => setBillName(t, bill, "Ana"));

    await tx((t) => releaseBillNumber(t, bill));
    expect((await tx((t) => readBillIdentities(t, [bill]))).get(bill)).toEqual({
      partyId: null,
      number: null,
      name: "Ana",
    });
    const third = await newBill(party);
    expect(await allocate(third, party)).toBe(3);

    await allocate(first, other);
    expect(await allocate(bill, other)).toBe(2);
    expect((await tx((t) => readBillIdentities(t, [bill]))).get(bill)).toEqual({
      partyId: other,
      number: 2,
      name: "Ana",
    });
  });

  it("A803 bill numbers (seat): releasing a bill with no row does nothing", async () => {
    const bill = await newBill(null);
    const before = await bothTables();
    await tx((t) => releaseBillNumber(t, bill));
    expect(await bothTables()).toEqual(before);
  });

  it("A803 bill numbers (seat): a name is set, replaced and cleared", async () => {
    const party = await newParty();
    const bill = await newBill(party);
    await allocate(bill, party);
    const nameOf = async () => (await tx((t) => readBillIdentities(t, [bill]))).get(bill)?.name;
    await tx((t) => setBillName(t, bill, "Ana"));
    expect(await nameOf()).toBe("Ana");
    await tx((t) => setBillName(t, bill, "Clint"));
    expect(await nameOf()).toBe("Clint");
    await tx((t) => setBillName(t, bill, null));
    expect(await nameOf()).toBeNull();
  });

  it("A803 bill numbers (seat): reading unknown bills answers nothing for them", async () => {
    const party = await newParty();
    const bill = await newBill(party);
    await allocate(bill, party);
    const unknown = randomUUID();
    const read = await tx((t) => readBillIdentities(t, [bill, unknown]));
    expect([...read.entries()]).toEqual([[bill, { partyId: party, number: 1, name: null }]]);
    expect((await tx((t) => readBillIdentities(t, []))).size).toBe(0);
  });

  it("A803 bill numbers (seat): setting a name on a bill with no row throws", async () => {
    const bill = await newBill(null);
    await expect(tx((t) => setBillName(t, bill, "Ana"))).rejects.toThrow(bill);
    expect(await bothTables()).toEqual({ identities: [], history: [] });
  });

  it("A803 bill numbers (seat): two transactions started together, each allocating a number for one party, get n and n+1 and leave two history rows", async () => {
    const party = await newParty();
    const first = await newBill(party);
    const second = await newBill(party);
    const numbers = await Promise.all([allocate(first, party), allocate(second, party)]);
    expect([...numbers].sort()).toEqual([1, 2]);
    const { history } = await bothTables();
    expect(history.map((row) => [row.workingOrderId, row.number]).sort()).toEqual(
      [
        [first, numbers[0]],
        [second, numbers[1]],
      ].sort(),
    );
  });

  it("A803 bill numbers (seat): a transaction that allocates a number and then throws leaves both tables as they were, and the next allocation gives that same number", async () => {
    const party = await newParty();
    const first = await newBill(party);
    await allocate(first, party);
    const bill = await newBill(party);
    const before = await bothTables();
    await expect(
      tx(async (t) => {
        await allocateBillNumber(t, bill, party);
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
    expect(await bothTables()).toEqual(before);
    expect(await allocate(bill, party)).toBe(2);
  });
});
