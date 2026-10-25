import { describe, expect, it } from "vitest";
import type { TableSignal } from "@waitron/shared";
import type { TableParty, TableState, TableToday } from "../api/client.js";
import { readyTables } from "./table-signals.js";

function party(over: Partial<TableParty> = {}): TableParty {
  return {
    kitchenNote: {
      scope: { partyId: over.id ?? "v2" },
      note: null,
      revision: 0,
      ownerRevision: over.revision ?? 3,
    },
    id: "v2",
    revision: 3,
    guestCount: 2,
    state: "open",
    name: null,
    displayName: "Table 2",
    mainBillId: "wo-2",
    outstanding: "20.00",
    billCount: 1,
    tableIds: ["t2"],
    unsentDrafts: [],
    reminder: null,
    ...over,
  };
}

function today(over: Partial<TableToday> = {}): TableToday {
  return {
    placement: { x: 2, y: 3, width: 2, height: 2, shape: "round", rotation: 0 },
    seats: 4,
    fixed: false,
    takenOff: false,
    joinId: null,
    joinSeats: null,
    inJoinedTable: null,
    joined: null,
    splitOffFrom: null,
    zoneRevision: 0,
    ...over,
  };
}

function table(over: Partial<TableState> = {}): TableState {
  return {
    id: "t2",
    label: "Table 2",
    zoneId: "z1",
    state: "open-tab",
    condition: "held",
    hasOpenTab: true,
    tabLineCount: 2,
    tabTotal: "20.00",
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: null,
    party: party(),
    signals: [],
    shortName: over.label ?? "Table 2",
    ...over,
  };
}

const ready = (...byStation: [string, string, number][]): TableSignal => ({
  kind: "ready",
  byStation: byStation.map(([stationId, stationName, count]) => ({
    stationId,
    stationName,
    count,
  })),
});

const shown = new Set(["z1", "z2"]);

describe("readyTables", () => {
  it("lists each party with food ready once, its count summed over its stations", () => {
    const tables = [
      table({ signals: [ready(["bar", "Bar", 3])] }),
      table({
        id: "t8",
        label: "Table 8",
        party: party({ id: "v8", displayName: "Table 8", tableIds: ["t8"] }),
        signals: [ready(["bar", "Bar", 1], ["kitchen", "Kitchen", 2])],
      }),
      table({ id: "t3", label: "Table 3", party: null, state: "free", signals: [] }),
    ];
    expect(readyTables(tables, shown)).toEqual([
      { partyId: "v2", tableId: "t2", name: "Table 2", count: 3 },
      { partyId: "v8", tableId: "t8", name: "Table 8", count: 3 },
    ]);
  });

  it("names a party at one of today's joins by its tables' short names, once", () => {
    const joined = party({ id: "v5", displayName: "Birthday", tableIds: ["t5", "t6"] });
    const signals = [ready(["kitchen", "Kitchen", 2])];
    const tables = [
      table({
        id: "t5",
        label: "Table 5",
        shortName: "T5",
        party: joined,
        signals,
        today: today({ joinId: "j1", joinName: "Birthday" }),
      }),
      table({
        id: "t6",
        label: "Table 6",
        shortName: "T6",
        party: joined,
        signals,
        today: today({ joinId: "j1", joinName: "Birthday" }),
      }),
    ];
    expect(readyTables(tables, shown)).toEqual([
      { partyId: "v5", tableId: "t5", name: "T5+T6", count: 2 },
    ]);
  });

  it("names a party at two separate tables by both short names", () => {
    const apart = party({ id: "v5", displayName: "Table 5", tableIds: ["t5", "t6"] });
    const signals = [ready(["kitchen", "Kitchen", 1])];
    const tables = [
      table({ id: "t5", label: "Table 5", shortName: "T5", party: apart, signals }),
      table({ id: "t6", label: "Table 6", shortName: "T6", party: apart, signals }),
    ];
    expect(readyTables(tables, shown)).toEqual([
      { partyId: "v5", tableId: "t5", name: "T5+T6", count: 1 },
    ]);
  });

  it("names a party at two separate tables by both, and by the shown one only when a zone is hidden", () => {
    const apart = party({ id: "v5", displayName: "Table 5", tableIds: ["t5", "t6"] });
    const signals = [ready(["kitchen", "Kitchen", 1])];
    const tables = [
      table({ id: "t5", label: "Table 5", zoneId: "z1", party: apart, signals }),
      table({ id: "t6", label: "Table 6", zoneId: "z2", party: apart, signals }),
    ];
    expect(readyTables(tables, shown)).toEqual([
      { partyId: "v5", tableId: "t5", name: "Table 5+Table 6", count: 1 },
    ]);
    expect(readyTables(tables, new Set(["z2"]))).toEqual([
      { partyId: "v5", tableId: "t6", name: "Table 6", count: 1 },
    ]);
  });

  it("leaves out a party whose tables are all in hidden zones, and a table with no zone", () => {
    const tables = [
      table({ zoneId: "z3", signals: [ready(["bar", "Bar", 3])] }),
      table({
        id: "t9",
        label: "Table 9",
        zoneId: null,
        party: party({ id: "v9", displayName: "Table 9", tableIds: ["t9"] }),
        signals: [ready(["bar", "Bar", 1])],
      }),
    ];
    expect(readyTables(tables, shown)).toEqual([]);
  });

  it("uses the saved short name, not today's name or the party's", () => {
    const tables = [
      table({
        shortName: "T2",
        party: party({ name: "Alex", displayName: "Alex" }),
        today: today({ name: "Window" }),
        signals: [ready(["bar", "Bar", 2])],
      }),
    ];
    expect(readyTables(tables, shown)).toEqual([
      { partyId: "v2", tableId: "t2", name: "T2", count: 2 },
    ]);
  });
});
