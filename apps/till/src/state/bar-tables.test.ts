import { describe, expect, it } from "vitest";
import type { TableParty, TableState, TableToday, UnsentDraft } from "../api/client.js";
import { barTables, type LocalBill } from "./bar-tables.js";

function draft(billId: string, ownerId: string, lineCount = 2): UnsentDraft {
  return {
    billId,
    billNumber: Number(billId.replace(/\D/g, "")) || 1,
    ownerId,
    ownerName: ownerId === "ana" ? "Ana" : "Sam",
    lineCount,
    savedAt: "2026-10-26T12:00:00.000Z",
  };
}

function party(id: string, over: Partial<TableParty> = {}): TableParty {
  return {
    kitchenNote: { scope: { partyId: id }, note: null, revision: 0, ownerRevision: 3 },
    id,
    revision: 3,
    guestCount: 2,
    state: "open",
    name: null,
    displayName: id,
    openingBillId: null,
    outstanding: "0.00",
    billCount: 1,
    tableIds: [],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

function today(joinId: string): TableToday {
  return {
    placement: { x: 2, y: 3, width: 2, height: 2, shape: "round", rotation: 0 },
    seats: 4,
    fixed: false,
    takenOff: false,
    joinId,
    joinSeats: null,
    inJoinedTable: null,
    joined: null,
    splitOffFrom: null,
    zoneRevision: 0,
  };
}

/** Table `n`: label "Terrace n", short name "Tn", id "tn". */
function table(
  n: number,
  tableParty: TableParty | null,
  over: Partial<TableState> = {},
): TableState {
  return {
    id: `t${n}`,
    label: `Terrace ${n}`,
    shortName: `T${n}`,
    zoneId: "z1",
    state: tableParty === null ? "free" : "open-tab",
    condition: tableParty === null ? "free" : "held",
    hasOpenTab: tableParty !== null,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: null,
    party: tableParty,
    signals: [],
    ...over,
  };
}

const none = { held: null, released: [] };

function bill(over: Partial<LocalBill> & Pick<LocalBill, "tableId">): LocalBill {
  return { partyId: null, billId: null, lines: 0, takenByOther: false, ...over };
}

describe("barTables", () => {
  it("lists a table where this person has unsent dishes, by its short name", () => {
    const tables = [
      table(4, party("p4", { unsentDrafts: [draft("b1", "ana")] })),
      table(9, party("p9", { unsentDrafts: [draft("b2", "sam")] })),
    ];
    expect(barTables(tables, "ana", none)).toEqual([
      { tableId: "t4", name: "T4", unsent: true, current: false, held: false },
    ]);
  });

  it("gives one button for several of this person's bills at one table", () => {
    const tables = [
      table(4, party("p4", { unsentDrafts: [draft("b1", "ana"), draft("b2", "ana")] })),
    ];
    expect(barTables(tables, "ana", none)).toEqual([
      { tableId: "t4", name: "T4", unsent: true, current: false, held: false },
    ]);
  });

  it("lists no table whose New orders are someone else's or a closed party's", () => {
    const tables = [
      table(4, party("p4", { unsentDrafts: [draft("b1", "sam")] })),
      table(5, party("p5", { state: "closed", unsentDrafts: [draft("b2", "ana")] })),
    ];
    expect(barTables(tables, "ana", none)).toEqual([]);
  });

  it("names a party at two tables by both short names, opening the first listed", () => {
    const joined = party("p4", { unsentDrafts: [draft("b1", "ana")] });
    expect(
      barTables(
        [table(4, joined, { today: today("j1") }), table(5, joined, { today: today("j1") })],
        "ana",
        none,
      ),
    ).toEqual([{ tableId: "t4", name: "T4+T5", unsent: true, current: false, held: false }]);
    expect(barTables([table(4, joined), table(5, joined)], "ana", none)).toEqual([
      { tableId: "t4", name: "T4+T5", unsent: true, current: false, held: false },
    ]);
  });

  it("keeps the floor read's order when a table is added", () => {
    const ana = (id: string, billId: string) => party(id, { unsentDrafts: [draft(billId, "ana")] });
    const before = [table(2, ana("p2", "b2")), table(4, party("p4")), table(9, ana("p9", "b9"))];
    expect(barTables(before, "ana", none).map((entry) => entry.tableId)).toEqual(["t2", "t9"]);
    const after = [table(2, ana("p2", "b2")), table(4, ana("p4", "b4")), table(9, ana("p9", "b9"))];
    expect(barTables(after, "ana", none).map((entry) => entry.tableId)).toEqual(["t2", "t4", "t9"]);
  });

  it("draws the table on screen as current, with ✎ only while something of this person's is unsent", () => {
    const tables = [table(4, party("p4"))];
    const held = (lines: number, onScreen: boolean) => ({
      held: { ...bill({ partyId: "p4", tableId: "t4", billId: "b1", lines }), onScreen },
      released: [],
    });
    expect(barTables(tables, "ana", held(0, true))).toEqual([
      { tableId: "t4", name: "T4", unsent: false, current: true, held: true },
    ]);
    expect(barTables(tables, "ana", held(1, true))).toEqual([
      { tableId: "t4", name: "T4", unsent: true, current: true, held: true },
    ]);
    expect(barTables(tables, "ana", held(0, false))).toEqual([]);
  });

  it("trusts the held bill over the floor read, and the read for the party's other bills", () => {
    const held = {
      held: { ...bill({ partyId: "p4", tableId: "t4", billId: "b1" }), onScreen: false },
      released: [],
    };
    const both = [
      table(4, party("p4", { unsentDrafts: [draft("b1", "ana"), draft("b2", "ana")] })),
    ];
    expect(barTables(both, "ana", held)).toEqual([
      { tableId: "t4", name: "T4", unsent: true, current: false, held: true },
    ]);
    const one = [table(4, party("p4", { unsentDrafts: [draft("b1", "ana")] }))];
    expect(barTables(one, "ana", held)).toEqual([]);
  });

  it("trusts a released bill over the floor read", () => {
    const tables = [
      table(4, party("p4")),
      table(9, party("p9", { unsentDrafts: [draft("b9", "ana")] })),
    ];
    const local = {
      held: null,
      released: [
        bill({ partyId: "p4", tableId: "t4", billId: "b1", lines: 1 }),
        bill({ partyId: "p9", tableId: "t9", billId: "b9", lines: 0 }),
      ],
    };
    expect(barTables(tables, "ana", local)).toEqual([
      { tableId: "t4", name: "T4", unsent: true, current: false, held: false },
    ]);
  });

  it("lists a free table being seated while it is on screen", () => {
    const tables = [table(2, party("p2")), table(3, null), table(4, null)];
    const seating = (lines: number, onScreen: boolean) => ({
      held: { ...bill({ tableId: "t3", lines }), onScreen },
      released: [],
    });
    expect(barTables(tables, "ana", seating(0, true))).toEqual([
      { tableId: "t3", name: "T3", unsent: false, current: true, held: true },
    ]);
    expect(barTables(tables, "ana", seating(2, false))).toEqual([
      { tableId: "t3", name: "T3", unsent: true, current: false, held: true },
    ]);
    expect(barTables(tables, "ana", seating(0, false))).toEqual([]);
  });

  it("marks a table being opened as current, with ✎ from the read for its party's bills", () => {
    const tables = [
      table(4, party("p4", { unsentDrafts: [draft("b1", "ana")] })),
      table(5, party("p5")),
      table(6, null),
    ];
    const opening = (partyId: string | null, tableId: string) => ({
      held: { partyId, tableId, billId: null, lines: 0, takenByOther: false, onScreen: true },
      released: [],
    });
    expect(barTables(tables, "ana", opening("p4", "t4"))).toEqual([
      { tableId: "t4", name: "T4", unsent: true, current: true, held: true },
    ]);
    expect(barTables(tables, "ana", opening("p5", "t5"))).toEqual([
      { tableId: "t4", name: "T4", unsent: true, current: false, held: false },
      { tableId: "t5", name: "T5", unsent: false, current: true, held: true },
    ]);
    expect(barTables(tables, "ana", opening(null, "t6"))).toEqual([
      { tableId: "t4", name: "T4", unsent: true, current: false, held: false },
      { tableId: "t6", name: "T6", unsent: false, current: true, held: true },
    ]);
  });

  it("lists nothing with nobody signed in", () => {
    const tables = [table(4, party("p4", { unsentDrafts: [draft("b1", "")] }))];
    const local = {
      held: { ...bill({ partyId: "p4", tableId: "t4", billId: "b1", lines: 1 }), onScreen: true },
      released: [],
    };
    expect(barTables(tables, "", local)).toEqual([]);
  });

  it("lists a table in any zone the read gives", () => {
    const tables = [
      table(4, party("p4", { unsentDrafts: [draft("b1", "ana")] }), { zoneId: "z2" }),
      table(7, party("p7", { unsentDrafts: [draft("b7", "ana")] }), { zoneId: null }),
    ];
    expect(barTables(tables, "ana", none)).toEqual([
      { tableId: "t4", name: "T4", unsent: true, current: false, held: false },
      { tableId: "t7", name: "T7", unsent: true, current: false, held: false },
    ]);
  });

  it("keeps ✎ on a held bill with lines that nobody else has taken, and drops it once someone has", () => {
    const tables = [table(4, party("p4"))];
    const held = (takenByOther: boolean, onScreen: boolean) => ({
      held: {
        ...bill({ partyId: "p4", tableId: "t4", billId: "b1", lines: 2, takenByOther }),
        onScreen,
      },
      released: [],
    });
    expect(barTables(tables, "ana", held(false, false))).toEqual([
      { tableId: "t4", name: "T4", unsent: true, current: false, held: true },
    ]);
    expect(barTables(tables, "ana", held(true, true))).toEqual([
      { tableId: "t4", name: "T4", unsent: false, current: true, held: true },
    ]);
    expect(barTables(tables, "ana", held(true, false))).toEqual([]);
  });

  it("gives no button for a released bill whose party is gone or closed", () => {
    const released = {
      held: null,
      released: [bill({ partyId: "p4", tableId: "t4", billId: "b1", lines: 1 })],
    };
    expect(barTables([table(4, null)], "ana", released)).toEqual([]);
    expect(barTables([table(4, party("p4", { state: "closed" }))], "ana", released)).toEqual([]);
  });

  it("trusts the held bill over a released record of the same bill", () => {
    const tables = [table(4, party("p4"))];
    const local = (heldLines: number, releasedLines: number) => ({
      held: {
        ...bill({ partyId: "p4", tableId: "t4", billId: "b1", lines: heldLines }),
        onScreen: true,
      },
      released: [bill({ partyId: "p4", tableId: "t4", billId: "b1", lines: releasedLines })],
    });
    expect(barTables(tables, "ana", local(0, 1))).toEqual([
      { tableId: "t4", name: "T4", unsent: false, current: true, held: true },
    ]);
    expect(barTables(tables, "ana", local(1, 0))).toEqual([
      { tableId: "t4", name: "T4", unsent: true, current: true, held: true },
    ]);
  });

  it("trusts a later released record of a bill over an earlier one", () => {
    const tables = [table(4, party("p4"))];
    const released = (...lines: number[]) => ({
      held: null,
      released: lines.map((count) =>
        bill({ partyId: "p4", tableId: "t4", billId: "b1", lines: count }),
      ),
    });
    expect(barTables(tables, "ana", released(1, 0))).toEqual([]);
    expect(barTables(tables, "ana", released(0, 1))).toEqual([
      { tableId: "t4", name: "T4", unsent: true, current: false, held: false },
    ]);
  });

  it("keeps the table on screen when the read does not list its party yet, but not a closed one", () => {
    const seated = {
      held: { ...bill({ partyId: "pNew", tableId: "t3", billId: "b1", lines: 2 }), onScreen: true },
      released: [],
    };
    expect(barTables([table(2, party("p2")), table(3, null)], "ana", seated)).toEqual([
      { tableId: "t3", name: "T3", unsent: true, current: true, held: true },
    ]);
    expect(barTables([table(3, party("pNew", { state: "closed" }))], "ana", seated)).toEqual([]);
    expect(barTables([table(2, party("p2"))], "ana", seated)).toEqual([]);
  });

  it("opens a held party at the table it is held from", () => {
    const joined = party("p4");
    const tables = [
      table(4, joined, { today: today("j1") }),
      table(5, joined, { today: today("j1") }),
    ];
    const local = {
      held: { ...bill({ partyId: "p4", tableId: "t5", billId: "b1" }), onScreen: true },
      released: [],
    };
    expect(barTables(tables, "ana", local)).toEqual([
      { tableId: "t5", name: "T4+T5", unsent: false, current: true, held: true },
    ]);
  });

  it("names and opens a held party by the tables the read seats it at, when its held table is not one", () => {
    const held = {
      ...bill({ partyId: "p4", tableId: "t4", billId: "b1", lines: 1 }),
      onScreen: false,
    };
    const moved = [table(4, null), table(9, party("p4"))];
    expect(barTables(moved, "ana", { held, released: [] })).toEqual([
      { tableId: "t9", name: "T9", unsent: true, current: false, held: false },
    ]);
    const fromFree = { ...held, tableId: "t5", onScreen: true };
    expect(
      barTables([table(4, party("p4")), table(5, null)], "ana", { held: fromFree, released: [] }),
    ).toEqual([{ tableId: "t4", name: "T4", unsent: true, current: true, held: false }]);
  });

  it("gives a held party the read does not list way to the open party the read seats at its table", () => {
    const seatedSince = party("pNew", { unsentDrafts: [draft("b2", "ana")] });
    const stale = { ...bill({ partyId: "pOld", tableId: "t4", billId: "b1" }), onScreen: true };
    expect(
      barTables([table(4, seatedSince), table(5, seatedSince)], "ana", {
        held: stale,
        released: [],
      }),
    ).toEqual([{ tableId: "t4", name: "T4+T5", unsent: true, current: true, held: false }]);
    expect(
      barTables([table(4, seatedSince)], "ana", {
        held: { ...stale, onScreen: false },
        released: [],
      }),
    ).toEqual([{ tableId: "t4", name: "T4", unsent: true, current: false, held: false }]);
  });

  it("gives the party seated at the held table since no ✎ for the held party's dishes", () => {
    const old = {
      ...bill({ partyId: "pOld", tableId: "t4", billId: "b1", lines: 2 }),
      onScreen: false,
    };
    const since = [table(4, party("pNew")), table(5, party("pNew"))];
    expect(barTables(since, "ana", { held: old, released: [] })).toEqual([]);
    expect(barTables(since, "ana", { held: { ...old, onScreen: true }, released: [] })).toEqual([
      { tableId: "t4", name: "T4+T5", unsent: false, current: true, held: false },
    ]);
  });

  it("lets a table being opened on screen stand in for the held bill, until its party is the held one", () => {
    const tables = [table(4, party("p4")), table(5, party("p5")), table(6, null)];
    const heldAt4 = {
      ...bill({ partyId: "p4", tableId: "t4", billId: "b1", lines: 1 }),
      onScreen: true,
    };
    const opening = (tableId: string, onScreen: boolean) => ({
      held: { ...heldAt4, onScreen },
      released: [],
      opening: { tableId, onScreen },
    });
    expect(barTables(tables, "ana", opening("t5", true))).toEqual([
      { tableId: "t5", name: "T5", unsent: false, current: true, held: false },
    ]);
    expect(barTables(tables, "ana", opening("t6", true))).toEqual([
      { tableId: "t6", name: "T6", unsent: false, current: true, held: false },
    ]);
    expect(barTables(tables, "ana", opening("t4", true))).toEqual([
      { tableId: "t4", name: "T4", unsent: true, current: true, held: true },
    ]);
    expect(barTables(tables, "ana", opening("t5", false))).toEqual([
      { tableId: "t4", name: "T4", unsent: true, current: false, held: false },
    ]);
  });

  it("sends only the held table's own button back to the held bill", () => {
    const tables = [
      table(4, party("p4")),
      table(5, party("p5", { unsentDrafts: [draft("b5", "ana")] })),
    ];
    const held = {
      ...bill({ partyId: "p4", tableId: "t4", billId: "b1", lines: 1 }),
      onScreen: false,
    };
    expect(
      barTables(tables, "ana", { held, released: [] }).map((button) => [
        button.tableId,
        button.held,
      ]),
    ).toEqual([
      ["t4", true],
      ["t5", false],
    ]);
    const seating = { ...bill({ partyId: "pNew", tableId: "t3", lines: 1 }), onScreen: true };
    expect(
      barTables([table(3, null)], "ana", {
        held: seating,
        released: [],
        opening: { tableId: "t3", onScreen: true },
      }),
    ).toEqual([{ tableId: "t3", name: "T3", unsent: false, current: true, held: true }]);
  });
});
