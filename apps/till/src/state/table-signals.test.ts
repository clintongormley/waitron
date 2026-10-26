import { describe, expect, it } from "vitest";
import type { TableSignal } from "@waitron/shared";
import type { TableParty, TableState, TableToday } from "../api/client.js";
import { nextReadyBarChange, readyBar, readyTables } from "./table-signals.js";

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

const ready = (
  ...byStation: [string, string, number, (string | null)?, number?][]
): TableSignal => ({
  kind: "ready",
  byStation: byStation.map(
    ([stationId, stationName, count, oldestReadyAt = null, readyWarningAfterMinutes = 3]) => ({
      stationId,
      stationName,
      count,
      oldestReadyAt,
      readyWarningAfterMinutes,
    }),
  ),
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
      {
        partyId: "v2",
        tableId: "t2",
        name: "Table 2",
        count: 3,
        oldestReadyAt: null,
        warnsAt: Number.POSITIVE_INFINITY,
      },
      {
        partyId: "v8",
        tableId: "t8",
        name: "Table 8",
        count: 3,
        oldestReadyAt: null,
        warnsAt: Number.POSITIVE_INFINITY,
      },
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
      {
        partyId: "v5",
        tableId: "t5",
        name: "T5+T6",
        count: 2,
        oldestReadyAt: null,
        warnsAt: Number.POSITIVE_INFINITY,
      },
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
      {
        partyId: "v5",
        tableId: "t5",
        name: "T5+T6",
        count: 1,
        oldestReadyAt: null,
        warnsAt: Number.POSITIVE_INFINITY,
      },
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
      {
        partyId: "v5",
        tableId: "t5",
        name: "Table 5+Table 6",
        count: 1,
        oldestReadyAt: null,
        warnsAt: Number.POSITIVE_INFINITY,
      },
    ]);
    expect(readyTables(tables, new Set(["z2"]))).toEqual([
      {
        partyId: "v5",
        tableId: "t6",
        name: "Table 6",
        count: 1,
        oldestReadyAt: null,
        warnsAt: Number.POSITIVE_INFINITY,
      },
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
      {
        partyId: "v2",
        tableId: "t2",
        name: "T2",
        count: 2,
        oldestReadyAt: null,
        warnsAt: Number.POSITIVE_INFINITY,
      },
    ]);
  });
});

const now = Date.parse("2026-10-26T20:00:00.000Z");
const MIN = 60_000;
const ago = (ms: number): string => new Date(now - ms).toISOString();

/** One party per table, in the order given, each at its own table in a shown zone. */
function partyAt(id: string, ...byStation: [string, string, number, (string | null)?, number?][]) {
  return table({
    id,
    label: id,
    shortName: id,
    party: party({ id: `v-${id}`, displayName: id, tableIds: [id] }),
    signals: [ready(...byStation)],
  });
}

describe("readyTables: each party's wait", () => {
  it("carries the party's longest wait, and the moment its first station warns", () => {
    const tables = [
      partyAt("t1", ["cold", "Cold", 1, ago(5 * MIN), 6], ["grill", "Grill", 1, ago(4 * MIN), 3]),
    ];
    const [entry] = readyTables(tables, shown);
    expect(entry?.oldestReadyAt).toBe(now - 5 * MIN);
    expect(entry?.warnsAt).toBe(now - 1 * MIN);
  });

  it("leaves a station with no time or an unreadable one out of both", () => {
    const [none] = readyTables([partyAt("t1", ["grill", "Grill", 1, null, 3])], shown);
    expect(none?.oldestReadyAt).toBeNull();
    expect(none?.warnsAt).toBe(Number.POSITIVE_INFINITY);
    const [mixed] = readyTables(
      [partyAt("t1", ["cold", "Cold", 1, "not a time", 1], ["grill", "Grill", 1, ago(2 * MIN), 3])],
      shown,
    );
    expect(mixed?.oldestReadyAt).toBe(now - 2 * MIN);
    expect(mixed?.warnsAt).toBe(now + 1 * MIN);
  });
});

describe("readyBar", () => {
  const ids = (bar: ReturnType<typeof readyBar>) => bar.tables.map((entry) => entry.tableId);

  it("warns from the moment a station has waited its own minutes", () => {
    const at = readyBar(
      readyTables([partyAt("t1", ["grill", "Grill", 1, ago(3 * MIN), 3])], shown),
      now,
    );
    expect(at.tables[0]?.warning).toBe(true);
    expect(at.waitedMinutes).toBe(3);
    const before = readyBar(
      readyTables([partyAt("t1", ["grill", "Grill", 1, ago(3 * MIN - 1), 3])], shown),
      now,
    );
    expect(before.tables[0]?.warning).toBe(false);
    expect(before.waitedMinutes).toBeNull();
  });

  it("judges each station against its own minutes", () => {
    const cold = readyBar(
      readyTables([partyAt("t1", ["cold", "Cold", 1, ago(4 * MIN), 6])], shown),
      now,
    );
    expect(cold.tables[0]?.warning).toBe(false);
    expect(cold.waitedMinutes).toBeNull();
    const both = readyBar(
      readyTables(
        [
          partyAt(
            "t1",
            ["cold", "Cold", 1, ago(4 * MIN), 6],
            ["grill", "Grill", 1, ago(4 * MIN), 3],
          ),
        ],
        shown,
      ),
      now,
    );
    expect(both.tables[0]?.warning).toBe(true);
    expect(both.waitedMinutes).toBe(4);
  });

  it("puts warning tables first, then the rest, each longest-waiting first, untimed last, ties in floor order", () => {
    const tables = [
      partyAt("t3", ["grill", "Grill", 1, null, 3]),
      partyAt("t1", ["cold", "Cold", 1, ago(5 * MIN), 6]),
      partyAt("t2", ["grill", "Grill", 1, ago(4.5 * MIN), 3]),
      partyAt("t4", ["grill", "Grill", 1, ago(1 * MIN), 3]),
      partyAt("t5", ["grill", "Grill", 1, null, 3]),
      partyAt("t6", ["grill", "Grill", 1, ago(1 * MIN), 3]),
    ];
    const bar = readyBar(readyTables(tables, shown), now);
    expect(ids(bar)).toEqual(["t2", "t1", "t4", "t6", "t3", "t5"]);
    expect(bar.tables.map((entry) => entry.warning)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(bar.waitedMinutes).toBe(4);
  });

  it("a stamp ahead of the clock stays calm", () => {
    const entries = readyTables(
      [partyAt("t1", ["grill", "Grill", 1, new Date(now + 2 * MIN).toISOString(), 3])],
      shown,
    );
    const bar = readyBar(entries, now);
    expect(bar.tables[0]?.warning).toBe(false);
    expect(bar.waitedMinutes).toBeNull();
    expect(nextReadyBarChange(entries, now)).toBe(now + 5 * MIN);
  });

  it("an amber table's place and minutes come from its oldest dish, even a calm one", () => {
    const tables = [
      partyAt("tB", ["grill", "Grill", 1, ago(9 * MIN), 3]),
      partyAt(
        "tA",
        ["cold", "Cold", 1, ago(10 * MIN), 15],
        ["grill", "Grill", 1, ago(3 * MIN + 5_000), 3],
      ),
    ];
    const bar = readyBar(readyTables(tables, shown), now);
    expect(bar.tables.map((entry) => entry.warning)).toEqual([true, true]);
    expect(ids(bar)).toEqual(["tA", "tB"]);
    expect(bar.waitedMinutes).toBe(10);
  });

  it("the next change: the next crossing, and the next minute while warning", () => {
    const calm = partyAt("t1", ["grill", "Grill", 1, ago(1.5 * MIN), 3]);
    expect(nextReadyBarChange(readyTables([calm], shown), now)).toBe(now + 1.5 * MIN);
    const warning = partyAt("t2", ["grill", "Grill", 1, ago(3 * MIN + 20_000), 3]);
    expect(nextReadyBarChange(readyTables([calm, warning], shown), now)).toBe(now + 40_000);
    const untimed = partyAt("t3", ["grill", "Grill", 1, null, 3]);
    expect(nextReadyBarChange(readyTables([untimed], shown), now)).toBe(Number.POSITIVE_INFINITY);
    expect(readyBar([], now)).toEqual({ tables: [], waitedMinutes: null });
    expect(nextReadyBarChange([], now)).toBe(Number.POSITIVE_INFINITY);
  });
});
