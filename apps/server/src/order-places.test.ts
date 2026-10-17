import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { floorTodayJoins, floorTodayJoinTables, workingOrders } from "@waitron/db";
import {
  partyNameOnPaper,
  readOrderPlaces,
  readPartyNames,
  readPlacedOrders,
} from "./order-places.js";
import { finishTable } from "./testing/party-close-fixture.js";
import { joinTables } from "./testing/table-action-fixture.js";
import {
  billRow,
  commandFor,
  counterOrder,
  inTx,
  join,
  nameParty,
  order,
  pay,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import "./errors.js";

let v: PartyVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

/** Puts the tables into one of today's groups, named `name`. */
async function group(name: string, tableIds: string[]): Promise<void> {
  await inTx(v, async (tx) => {
    const [row] = await tx
      .insert(floorTodayJoins)
      .values({ zoneId: v.tables.zoneId, seats: 8, name })
      .returning({ id: floorTodayJoins.id });
    for (const tableId of tableIds) {
      await tx
        .insert(floorTodayJoinTables)
        .values({ joinId: row!.id, tableId, beforeX: 0, beforeY: 0, beforeRotation: 0 });
    }
  });
}

async function placesOf(orderId: string) {
  const places = await inTx(v, (tx) => readOrderPlaces(tx, [orderId]));
  return places.get(orderId)!;
}

describe("readOrderPlaces", () => {
  it("names a party in a named group by the group once, with both its tables", async () => {
    const t6 = await v.table("Mesa 6");
    const t9 = await v.table("Mesa 9");
    const { partyId, tabId } = await seat(v, t6);
    await join(v, partyId, t9);
    await group("Cumple Ana", [t6, t9]);
    await nameParty(v, partyId, "Ana");
    const places = await placesOf(tabId);
    expect(places).toEqual({
      orderNumber: (await billRow(v, tabId)).orderNumber,
      counter: false,
      tables: [
        { id: t6, name: "Mesa 6" },
        { id: t9, name: "Mesa 9" },
      ],
      names: ["Cumple Ana"],
      partyName: "Ana",
    });
  });

  it("names a party holding one table of a group by the group, and lists that table by its own name", async () => {
    const t77 = await v.table("Mesa 77");
    const t78 = await v.table("Mesa 78");
    const { tabId } = await seat(v, t77);
    // Seating a grouped table seats the whole group, so the group forms after the party sits.
    await group("Terraza", [t77, t78]);
    const places = await placesOf(tabId);
    expect(places.names).toEqual(["Terraza"]);
    expect(places.tables).toEqual([{ id: t77, name: "Mesa 77" }]);
    expect(places.counter).toBe(false);
    expect(places.partyName).toBeNull();
  });

  it("reads a paid bill of a party merged into another at the surviving party's tables", async () => {
    const t1 = await v.table("Mesa 31");
    const t2 = await v.table("Mesa 32");
    const a = await seat(v, t1);
    const b = await seat(v, t2);
    await order(v, b.tabId, "Burger");
    await pay(v, b.tabId, "12.00");
    const sent = await commandFor(v, a.partyId);
    await inTx(v, (tx) =>
      joinTables(tx, v.cfg, a.partyId, t2, {
        ...sent,
        bills: "separate",
        otherPartyId: b.partyId,
        expectedOtherPartyRevision: b.revision,
      }),
    );
    expect((await billRow(v, b.tabId)).partyId).toBe(b.partyId);
    const places = await placesOf(b.tabId);
    expect(places.tables.map((table) => table.id)).toEqual([t1, t2]);
    expect(places.names).toEqual(["Mesa 31", "Mesa 32"]);
    expect(places.counter).toBe(false);
    const both = await inTx(v, (tx) => readOrderPlaces(tx, [b.tabId, a.tabId]));
    expect(both.get(b.tabId)!.tables).toEqual(both.get(a.tabId)!.tables);
    expect(both.get(a.tabId)!.tables.map((table) => table.id)).toEqual([t1, t2]);
  });

  it("reads the bill of a finished party, which holds no table, at no table and by its own label", async () => {
    const t1 = await v.table("Mesa 51");
    const { partyId, tabId } = await seat(v, t1);
    await order(v, tabId, "Burger");
    await pay(v, tabId, "12.00");
    const sent = await commandFor(v, partyId);
    await inTx(v, (tx) => finishTable(tx, { partyId, ...sent }));
    expect((await billRow(v, tabId)).label).toBe("Mesa 51");
    const places = await placesOf(tabId);
    expect(places.tables).toEqual([]);
    expect(places.names).toEqual(["Mesa 51"]);
    expect(places.counter).toBe(false);
  });

  it("reads the empty bill a finished party abandoned at no table and no place name", async () => {
    const t1 = await v.table("Mesa 52");
    const { partyId, tabId } = await seat(v, t1);
    const sent = await commandFor(v, partyId);
    await inTx(v, (tx) => finishTable(tx, { partyId, ...sent }));
    const bill = await billRow(v, tabId);
    expect(bill.status).toBe("abandoned");
    expect(bill.label).toBeNull();
    expect(await placesOf(tabId)).toEqual({
      orderNumber: bill.orderNumber,
      counter: false,
      tables: [],
      names: [],
      partyName: null,
    });
  });

  it("reads a counter order delivered to a table at that table's shown name", async () => {
    const t16 = await v.table("Mesa 16");
    await group("Cumple Bea", [t16]);
    const id = await counterOrder(v, "Burger");
    await inTx(v, (tx) =>
      tx.update(workingOrders).set({ deliveryTableId: t16 }).where(eq(workingOrders.id, id)),
    );
    const places = await placesOf(id);
    expect(places).toEqual({
      orderNumber: (await billRow(v, id)).orderNumber,
      counter: false,
      tables: [{ id: t16, name: "Mesa 16" }],
      names: ["Cumple Bea"],
      partyName: null,
    });
  });

  it("reads a counter order delivered to no table as the counter, not as text", async () => {
    const id = await counterOrder(v, "Burger");
    await inTx(v, (tx) =>
      tx.update(workingOrders).set({ label: "Luis" }).where(eq(workingOrders.id, id)),
    );
    const places = await placesOf(id);
    expect(places).toEqual({
      orderNumber: (await billRow(v, id)).orderNumber,
      counter: true,
      tables: [],
      names: [],
      partyName: null,
    });
  });

  it("reads several orders in one call, each keyed by its id", async () => {
    const t1 = await v.table("Mesa 41");
    const { tabId } = await seat(v, t1);
    const counter = await counterOrder(v, "Burger");
    const places = await inTx(v, (tx) => readOrderPlaces(tx, [tabId, counter]));
    expect([...places.keys()].sort()).toEqual([tabId, counter].sort());
    expect(places.get(tabId)!.names).toEqual(["Mesa 41"]);
    expect(places.get(counter)!.counter).toBe(true);
    const unknown = "cccccccc-9999-4000-8000-0000000000c1";
    expect(await inTx(v, (tx) => readOrderPlaces(tx, [unknown]))).toEqual(new Map());
  });

  it("answers an empty map for no orders", async () => {
    expect(await inTx(v, (tx) => readOrderPlaces(tx, []))).toEqual(new Map());
  });
});

describe("partyNameOnPaper", () => {
  it("gives the name of the party at the end of the merges when there is one, else the order's own party's", () => {
    expect(partyNameOnPaper("Bea", { name: "Ana" })).toBe("Ana");
    expect(partyNameOnPaper("Bea", { name: null })).toBeNull();
    expect(partyNameOnPaper("Bea", undefined)).toBe("Bea");
    expect(partyNameOnPaper(null, undefined)).toBeNull();
  });
});

describe("readPartyNames", () => {
  it("names an order by its own party's name, and an unnamed party's and a counter order's by null", async () => {
    const named = await seat(v, await v.table("Mesa 61"));
    await nameParty(v, named.partyId, "Ana");
    const unnamed = await seat(v, await v.table("Mesa 62"));
    const counter = await counterOrder(v, "Burger");
    const ids = [named.tabId, unnamed.tabId, counter];
    expect(await inTx(v, (tx) => readPartyNames(tx, ids))).toEqual(
      new Map([
        [named.tabId, "Ana"],
        [unnamed.tabId, null],
        [counter, null],
      ]),
    );
    const placed = await inTx(v, (tx) => readPlacedOrders(tx, ids));
    expect(ids.map((id) => placed.get(id)!.sittingWith)).toEqual(["Ana", null, null]);
  });

  it("names the order of a party merged into another by the surviving party's name, as a MOVED slip does", async () => {
    const t1 = await v.table("Mesa 63");
    const t2 = await v.table("Mesa 64");
    const a = await seat(v, t1);
    const b = await seat(v, t2);
    await nameParty(v, a.partyId, "Ana");
    await nameParty(v, b.partyId, "Bea");
    await order(v, b.tabId, "Burger");
    await pay(v, b.tabId, "12.00");
    const sent = await commandFor(v, a.partyId);
    const bRevision = (await commandFor(v, b.partyId)).expectedPartyRevision;
    await inTx(v, (tx) =>
      joinTables(tx, v.cfg, a.partyId, t2, {
        ...sent,
        bills: "separate",
        otherPartyId: b.partyId,
        expectedOtherPartyRevision: bRevision,
      }),
    );
    const ids = [a.tabId, b.tabId];
    expect(await inTx(v, (tx) => readPartyNames(tx, ids))).toEqual(
      new Map([
        [a.tabId, "Ana"],
        [b.tabId, "Ana"],
      ]),
    );
    const placed = await inTx(v, (tx) => readPlacedOrders(tx, ids));
    expect(placed.get(b.tabId)!.sittingWith).toBe("Ana");
  });

  it("answers an empty map for no orders, and leaves out an id that names no order", async () => {
    expect(await inTx(v, (tx) => readPartyNames(tx, []))).toEqual(new Map());
    const unknown = "cccccccc-9999-4000-8000-0000000000c2";
    expect(await inTx(v, (tx) => readPartyNames(tx, [unknown]))).toEqual(new Map());
  });
});
