import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { readOrderPlaces, readPlacedOrders } from "./order-places.js";
import { diningTables } from "./schema/dining-tables.js";
import { tableMerges } from "./schema/floor-plans.js";
import { workingOrders } from "./schema/orders.js";
import { parties, partyTables } from "./schema/parties.js";
import { withTransaction } from "./tenancy.js";
import { seedPerson, seedVenue, seedWorkingOrder, seedZone } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";

const at = "2026-11-25T11:00:00.000Z";
let zoneId: string;
let operatorId: string;
const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS],
  setup: async (db) => {
    await seedVenue(db);
    zoneId = (await seedZone(db, { name: "Room" })).id;
    operatorId = await seedPerson(db);
  },
});
const inTx = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, fn);

async function table(label: string): Promise<string> {
  const [row] = await inTx((tx) => tx.insert(diningTables).values({ label, zoneId }).returning());
  return row!.id;
}

async function seat(tableId: string) {
  return inTx(async (tx) => {
    const [party] = await tx.insert(parties).values({ openedBy: operatorId }).returning();
    await tx.insert(partyTables).values({ partyId: party!.id, tableId });
    const order = await seedWorkingOrder(tx, { partyId: party!.id });
    return { partyId: party!.id, tabId: order.id };
  });
}

async function join(partyId: string, tableId: string) {
  await inTx((tx) => tx.insert(partyTables).values({ partyId, tableId }));
}

async function closeParty(partyId: string, mergedIntoPartyId: string | null = null) {
  await inTx(async (tx) => {
    await tx.update(partyTables).set({ leftAt: at }).where(eq(partyTables.partyId, partyId));
    await tx
      .update(parties)
      .set({ state: "closed", closedAt: at, mergedIntoPartyId })
      .where(eq(parties.id, partyId));
  });
}

async function nameParty(partyId: string, name: string) {
  await inTx((tx) => tx.update(parties).set({ name }).where(eq(parties.id, partyId)));
}

async function mergeParty(from: string, into: string) {
  const tables = await inTx((tx) =>
    tx.select({ id: partyTables.tableId }).from(partyTables).where(eq(partyTables.partyId, from)),
  );
  await closeParty(from, into);
  for (const { id } of tables) await join(into, id);
}

async function counterOrder(): Promise<string> {
  return (await inTx((tx) => seedWorkingOrder(tx))).id;
}

async function billRow(id: string) {
  const [row] = await inTx((tx) => tx.select().from(workingOrders).where(eq(workingOrders.id, id)));
  return row!;
}

/** Puts the tables into one of today's groups, named `name`. */
async function group(name: string, tableIds: string[]): Promise<void> {
  await inTx(async (tx) => {
    const [row] = await tx
      .insert(tableMerges)
      .values({ zoneId: zoneId, seats: 8, name })
      .returning({ id: tableMerges.id });
    for (const tableId of tableIds) {
      await tx
        .update(diningTables)
        .set({
          onFloor: true,
          mergeId: row!.id,
          mergeBeforeX: 0,
          mergeBeforeY: 0,
          mergeBeforeRotation: 0,
        })
        .where(eq(diningTables.id, tableId));
    }
  });
}

async function placesOf(orderId: string) {
  const places = await inTx((tx) => readOrderPlaces(tx, [orderId]));
  return places.get(orderId)!;
}

describe("readOrderPlaces", () => {
  it("names a party in a named group by the group once, with both its tables", async () => {
    const t6 = await table("Table 6");
    const t9 = await table("Table 9");
    const { partyId, tabId } = await seat(t6);
    await join(partyId, t9);
    await group("Ana's birthday", [t6, t9]);
    await nameParty(partyId, "Ana");
    const places = await placesOf(tabId);
    expect(places).toEqual({
      orderNumber: (await billRow(tabId)).orderNumber,
      counter: false,
      tables: [
        { id: t6, name: "Table 6" },
        { id: t9, name: "Table 9" },
      ],
      names: ["Ana's birthday"],
      partyName: "Ana",
      billName: null,
    });
  });

  it("names a party holding one table of a group by the group, and lists that table by its own name", async () => {
    const t77 = await table("Table 77");
    const t78 = await table("Table 78");
    const { tabId } = await seat(t77);
    // Seating a grouped table seats the whole group, so the group forms after the party sits.
    await group("Terrace", [t77, t78]);
    const places = await placesOf(tabId);
    expect(places.names).toEqual(["Terrace"]);
    expect(places.tables).toEqual([{ id: t77, name: "Table 77" }]);
    expect(places.counter).toBe(false);
    expect(places.partyName).toBeNull();
  });

  it("reads a paid bill of a party merged into another at the surviving party's tables", async () => {
    const t1 = await table("Table 31");
    const t2 = await table("Table 32");
    const a = await seat(t1);
    const b = await seat(t2);
    await inTx((tx) =>
      tx
        .update(workingOrders)
        .set({ status: "settled", settledAt: at })
        .where(eq(workingOrders.id, b.tabId)),
    );
    await mergeParty(b.partyId, a.partyId);
    expect((await billRow(b.tabId)).partyId).toBe(b.partyId);
    const places = await placesOf(b.tabId);
    expect(places.tables.map((table) => table.id)).toEqual([t1, t2]);
    expect(places.names).toEqual(["Table 31", "Table 32"]);
    expect(places.counter).toBe(false);
    const both = await inTx((tx) => readOrderPlaces(tx, [b.tabId, a.tabId]));
    expect(both.get(b.tabId)!.tables).toEqual(both.get(a.tabId)!.tables);
    expect(both.get(a.tabId)!.tables.map((table) => table.id)).toEqual([t1, t2]);
  });

  it("reads a finished party's bill at no live place even when it kept its receipt label", async () => {
    const t1 = await table("Table 51");
    const { partyId, tabId } = await seat(t1);
    await inTx((tx) =>
      tx
        .update(workingOrders)
        .set({
          status: "settled",
          settledAt: at,
          label: "Table 51",
        })
        .where(eq(workingOrders.id, tabId)),
    );
    await closeParty(partyId);
    expect((await billRow(tabId)).label).toBe("Table 51");
    const places = await placesOf(tabId);
    expect(places.tables).toEqual([]);
    expect(places.names).toEqual([]);
    expect(places.counter).toBe(false);
  });

  it("reads the empty bill a finished party abandoned at no table and no place name", async () => {
    const t1 = await table("Table 52");
    const { partyId, tabId } = await seat(t1);
    await inTx((tx) =>
      tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, tabId)),
    );
    await closeParty(partyId);
    const bill = await billRow(tabId);
    expect(bill.status).toBe("abandoned");
    expect(bill.label).toBeNull();
    expect(await placesOf(tabId)).toEqual({
      orderNumber: bill.orderNumber,
      counter: false,
      tables: [],
      names: [],
      partyName: null,
      billName: null,
    });
  });

  it("reads a counter order delivered to a table at that table's shown name", async () => {
    const t16 = await table("Table 16");
    await group("Bea's birthday", [t16]);
    const id = await counterOrder();
    await inTx((tx) =>
      tx.update(workingOrders).set({ deliveryTableId: t16 }).where(eq(workingOrders.id, id)),
    );
    const places = await placesOf(id);
    expect(places).toEqual({
      orderNumber: (await billRow(id)).orderNumber,
      counter: false,
      tables: [{ id: t16, name: "Table 16" }],
      names: ["Bea's birthday"],
      partyName: null,
      billName: null,
    });
  });

  it("reads a counter order delivered to no table as the counter, not as text", async () => {
    const id = await counterOrder();
    await inTx((tx) =>
      tx.update(workingOrders).set({ label: "Luis" }).where(eq(workingOrders.id, id)),
    );
    const places = await placesOf(id);
    expect(places).toEqual({
      orderNumber: (await billRow(id)).orderNumber,
      counter: true,
      tables: [],
      names: [],
      partyName: null,
      billName: null,
    });
  });

  it("keeps a typed name separate from a released table and its receipt label", async () => {
    const id = await counterOrder();
    await inTx((tx) =>
      tx
        .update(workingOrders)
        .set({
          billName: "Dana",
          label: "Terrace 8",
          deliveryTableLabel: "Terrace 8",
        })
        .where(eq(workingOrders.id, id)),
    );
    expect(await placesOf(id)).toMatchObject({ counter: true, names: [], billName: "Dana" });
  });

  it("reads several orders in one call, each keyed by its id", async () => {
    const t1 = await table("Table 41");
    const { tabId } = await seat(t1);
    const counter = await counterOrder();
    const places = await inTx((tx) => readOrderPlaces(tx, [tabId, counter]));
    expect([...places.keys()].sort()).toEqual([tabId, counter].sort());
    expect(places.get(tabId)!.names).toEqual(["Table 41"]);
    expect(places.get(counter)!.counter).toBe(true);
    const unknown = "cccccccc-9999-4000-8000-0000000000c1";
    expect(await inTx((tx) => readOrderPlaces(tx, [unknown]))).toEqual(new Map());
  });

  it("uses one query for grouped and counter places, including their short names", async () => {
    const tableId = await table("Table 87");
    await inTx((tx) =>
      tx.update(diningTables).set({ shortName: "T87" }).where(eq(diningTables.id, tableId)),
    );
    const { tabId } = await seat(tableId);
    const counter = await counterOrder();
    await inTx(async (tx) => {
      const select = vi.spyOn(tx, "select");
      const execute = vi.spyOn(tx, "execute");
      try {
        const places = await readOrderPlaces(tx, [tabId, counter], { withShortNames: true });
        expect(places.get(tabId)?.tableShortNames).toEqual(["T87"]);
        expect(places.get(counter)?.tableShortNames).toBeUndefined();
        expect(select.mock.calls.length + execute.mock.calls.length).toBe(1);
      } finally {
        select.mockRestore();
        execute.mockRestore();
      }
    });
  });

  it("answers an empty map for no orders", async () => {
    expect(await inTx((tx) => readOrderPlaces(tx, []))).toEqual(new Map());
  });
});

describe("readPlacedOrders", () => {
  it("names an order by its own party's name, and an unnamed party's and a counter order's by null", async () => {
    const named = await seat(await table("Table 61"));
    await nameParty(named.partyId, "Ana");
    const unnamed = await seat(await table("Table 62"));
    const counter = await counterOrder();
    const ids = [named.tabId, unnamed.tabId, counter];
    const placed = await inTx((tx) => readPlacedOrders(tx, ids));
    expect(ids.map((id) => placed.get(id)!.sittingWith)).toEqual(["Ana", null, null]);
  });

  it("names the order of a party merged into another by the surviving party's name, as a MOVED slip does", async () => {
    const t1 = await table("Table 63");
    const t2 = await table("Table 64");
    const a = await seat(t1);
    const b = await seat(t2);
    await nameParty(a.partyId, "Ana");
    await nameParty(b.partyId, "Bea");
    await mergeParty(b.partyId, a.partyId);
    const ids = [a.tabId, b.tabId];
    const placed = await inTx((tx) => readPlacedOrders(tx, ids));
    expect(placed.get(b.tabId)!.sittingWith).toBe("Ana");
  });

  it("answers an empty map for no orders, and leaves out an id that names no order", async () => {
    expect(await inTx((tx) => readPlacedOrders(tx, []))).toEqual(new Map());
    const unknown = "cccccccc-9999-4000-8000-0000000000c2";
    expect(await inTx((tx) => readPlacedOrders(tx, [unknown]))).toEqual(new Map());
  });
});
