import { afterEach, describe, expect, it } from "vitest";
import { freeSide, touchingPlace } from "@waitron/shared";
import { currentLocale, setLocale } from "../i18n/t.js";
import type {
  FloorZone,
  TableParty,
  TableState,
  TableToday,
  TodayPlacement,
} from "../api/client.js";
import {
  carryRevisions,
  dropAction,
  groupName,
  groupSplitOf,
  normalGroupName,
  onTodaysPlan,
  pendingPlaces,
  seatsAtFreeTable,
  seatsGuests,
  sheetActions,
  shownName,
  spareSpot,
  sparesOf,
  takenOffOf,
  joinMembersById,
  nextFloorMoment,
  tightName,
} from "./floor-today.js";

function place(x: number, y: number, over: Partial<TodayPlacement> = {}): TodayPlacement {
  return { x, y, width: 4, height: 4, shape: "rect", rotation: 0, ...over };
}

function today(over: Partial<TableToday> = {}): TableToday {
  return {
    placement: place(0, 0),
    seats: 4,
    fixed: false,
    takenOff: false,
    joinId: null,
    joinSeats: null,
    zoneRevision: 0,
    ...over,
  };
}

function party(id: string, tableIds: string[]): TableParty {
  return {
    kitchenNote: { scope: { partyId: id }, note: null, revision: 0, ownerRevision: 1 },
    id,
    revision: 1,
    guestCount: 2,
    state: "open",
    name: null,
    displayName: tableIds.join("+"),
    openingBillId: null,
    outstanding: "0.00",
    billCount: 1,
    tableIds,
    unsentDrafts: [],
    reminder: null,
  };
}

function table(id: string, label: string, over: Partial<TableState> = {}): TableState {
  return {
    id,
    label,
    zoneId: "z1",
    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: today(),
    signals: [],
    party: null,
    shortName: over.label ?? label,
    ...over,
  };
}

const seatedBy = (p: TableParty): Partial<TableState> => ({
  state: "open-tab",
  condition: "held",
  party: p,
});

const startLocale = currentLocale();
afterEach(() => setLocale(startLocale));

describe("carryRevisions", () => {
  const answeredAt = nextFloorMoment();
  const earlier = new Map([["z1", { revision: 9, answeredAt }]]);

  it("keeps a room an answer does not name, and adds the one it does", () => {
    const carried = carryRevisions(earlier, { z2: 4 });
    expect(carried.get("z1")).toEqual({ revision: 9, answeredAt });
    expect(carried.get("z2")?.revision).toBe(4);
    expect(carried.get("z2")?.answeredAt).toBeGreaterThan(answeredAt);
  });

  it("replaces a room an answer names, as of now", () => {
    const carried = carryRevisions(earlier, { z1: 12 });
    expect(carried.get("z1")?.revision).toBe(12);
    expect(carried.get("z1")?.answeredAt).toBeGreaterThan(answeredAt);
  });

  it("keeps every room when an answer names none", () => {
    expect([...carryRevisions(earlier, undefined)]).toEqual([...earlier]);
  });
});

describe("dropAction", () => {
  const a = table("a", "4", { today: today({ placement: place(0, 0) }) });
  const b = table("b", "5", { today: today({ placement: place(20, 0) }) });

  it("a movable table dropped on empty space moves there", () => {
    expect(dropAction([a, b], { tableId: "b", x: 30, y: 7, targetId: null })).toEqual({
      kind: "move",
      tableId: "b",
      x: 30,
      y: 7,
    });
  });

  it("a fixed table dropped on empty space says it is fixed", () => {
    const fixed = table("f", "9", { today: today({ fixed: true }) });
    expect(dropAction([fixed], { tableId: "f", x: 30, y: 7, targetId: null })).toEqual({
      kind: "say",
      message: "That table is fixed in place",
    });
    setLocale("es");
    expect(dropAction([fixed], { tableId: "f", x: 30, y: 7, targetId: null })).toEqual({
      kind: "say",
      message: "Esa mesa está fija",
    });
  });

  it("two free movable tables merge, against the side nearest the drop", () => {
    expect(dropAction([a, b], { tableId: "b", x: 4, y: 0, targetId: "a" })).toEqual({
      kind: "merge",
      tableId: "b",
      targetId: "a",
      side: "right",
      heading: "4+5",
    });
    expect(dropAction([a, b], { tableId: "b", x: 0, y: 3, targetId: "a" })).toMatchObject({
      side: "bottom",
    });
  });

  it("a table dropped on a merge goes against the member nearest the drop, named after all three", () => {
    const m1 = table("m1", "1", { today: today({ joinId: "j", seats: 2, joinSeats: 10 }) });
    const m2 = table("m2", "2", {
      today: today({ joinId: "j", seats: 3, placement: place(4, 0) }),
    });
    const loose = table("l", "3", { today: today({ seats: null, placement: place(20, 0) }) });
    expect(dropAction([m1, m2, loose], { tableId: "l", x: 8, y: 0, targetId: "m1" })).toEqual({
      kind: "merge",
      tableId: "l",
      targetId: "m2",
      side: "right",
      heading: "1+2+3",
    });
  });

  it("a seated table dropped on a free one extends the party and merges", () => {
    const p = party("P", ["b"]);
    const seated = table("b", "5", { ...seatedBy(p), today: today({ placement: place(20, 0) }) });
    expect(dropAction([a, seated], { tableId: "b", x: -4, y: 0, targetId: "a" })).toEqual({
      kind: "join",
      party: p,
      tableId: "a",
      other: null,
      merge: { moving: "b", target: "a", side: "left" },
      heading: "4+5",
    });
  });

  it("a free table dropped on a seated one joins that party", () => {
    const q = party("Q", ["a"]);
    const seated = table("a", "4", { ...seatedBy(q), today: today({ placement: place(0, 0) }) });
    expect(dropAction([seated, b], { tableId: "b", x: 4, y: 0, targetId: "a" })).toEqual({
      kind: "join",
      party: q,
      tableId: "b",
      other: null,
      merge: { moving: "b", target: "a", side: "right" },
      heading: "4+5",
    });
  });

  it("two seated tables join into the target's party", () => {
    const p = party("P", ["b"]);
    const q = party("Q", ["a"]);
    const atA = table("a", "4", { ...seatedBy(q), today: today({ placement: place(0, 0) }) });
    const atB = table("b", "5", { ...seatedBy(p), today: today({ placement: place(20, 0) }) });
    expect(dropAction([atA, atB], { tableId: "b", x: 4, y: 0, targetId: "a" })).toEqual({
      kind: "join",
      party: q,
      tableId: "b",
      other: p,
      merge: { moving: "b", target: "a", side: "right" },
      heading: "4+5",
    });
  });

  it("a table dropped on a merge goes against its nearest member", () => {
    const m1 = table("m1", "1", { today: today({ joinId: "j" }) });
    const m2 = table("m2", "2", { today: today({ joinId: "j", placement: place(4, 0) }) });
    const q = party("Q", ["m1", "m2"]);
    const loose = table("l", "3", { today: today({ placement: place(20, 0) }) });
    expect(dropAction([m1, m2, loose], { tableId: "l", x: 8, y: 0, targetId: "m1" })).toMatchObject(
      { kind: "merge", targetId: "m2" },
    );
    expect(
      dropAction([m1, m2, loose], { tableId: "l", x: -4, y: 0, targetId: "m2" }),
    ).toMatchObject({ kind: "merge", targetId: "m1", side: "left" });
    const held = [m1, m2].map((m) => ({ ...m, ...seatedBy(q) }));
    expect(
      dropAction([...held, loose], { tableId: "l", x: 8, y: 0, targetId: "m1" }),
    ).toMatchObject({
      kind: "join",
      party: q,
      tableId: "l",
      merge: { moving: "l", target: "m2", side: "right" },
    });
  });

  it("a merge dropped on a table does nothing but say so", () => {
    const m1 = table("m1", "1", { today: today({ joinId: "j" }) });
    const m2 = table("m2", "2", { today: today({ joinId: "j", placement: place(4, 0) }) });
    const loose = table("l", "3", { today: today({ placement: place(20, 0) }) });
    expect(dropAction([m1, m2, loose], { tableId: "m1", x: 16, y: 0, targetId: "l" })).toEqual({
      kind: "say",
      message: "Drag the other table onto it",
    });
    setLocale("es");
    expect(dropAction([m1, m2, loose], { tableId: "m1", x: 16, y: 0, targetId: "l" })).toEqual({
      kind: "say",
      message: "Arrastra la otra mesa encima",
    });
  });

  it("a merge dropped on empty space moves", () => {
    const m1 = table("m1", "1", { today: today({ joinId: "j" }) });
    const m2 = table("m2", "2", { today: today({ joinId: "j", placement: place(4, 0) }) });
    expect(dropAction([m1, m2], { tableId: "m1", x: 4, y: 2, targetId: null })).toEqual({
      kind: "move",
      tableId: "m1",
      x: 4,
      y: 2,
    });
  });

  it("two free tables, one fixed, seat one party at both", () => {
    const f1 = table("f1", "Bar 1", { today: today({ placement: place(0, 0) }) });
    const f2 = table("f2", "Bar 2", {
      today: today({ fixed: true, seats: 1, placement: place(4, 0) }),
    });
    expect(dropAction([f1, f2], { tableId: "f1", x: 4, y: 0, targetId: "f2" })).toEqual({
      kind: "seat",
      tableId: "f1",
      withTableIds: ["f2"],
      heading: "Bar 1+2",
    });
    const f3 = table("f1", "Bar 1", { today: today({ fixed: true }) });
    expect(dropAction([f3, f2], { tableId: "f1", x: 4, y: 0, targetId: "f2" })).toMatchObject({
      kind: "seat",
      tableId: "f1",
      withTableIds: ["f2"],
    });
  });

  it("a fixed table and a seated one join without a merge", () => {
    const q = party("Q", ["f2"]);
    const f1 = table("f1", "Bar 1", { today: today({ placement: place(0, 0) }) });
    const f2 = table("f2", "Bar 2", {
      ...seatedBy(q),
      today: today({ fixed: true, placement: place(4, 0) }),
    });
    expect(dropAction([f1, f2], { tableId: "f1", x: 4, y: 0, targetId: "f2" })).toEqual({
      kind: "join",
      party: q,
      tableId: "f1",
      other: null,
      merge: null,
      heading: "Bar 1+2",
    });
  });

  it("a drop on the same party's other table does nothing", () => {
    const p = party("P", ["a", "b"]);
    const atA = table("a", "4", { ...seatedBy(p), today: today({ placement: place(0, 0) }) });
    const atB = table("b", "5", { ...seatedBy(p), today: today({ placement: place(20, 0) }) });
    expect(dropAction([atA, atB], { tableId: "b", x: 4, y: 0, targetId: "a" })).toEqual({
      kind: "none",
    });
  });

  it("a drop on its own merge, or of a table no longer read, does nothing", () => {
    const m1 = table("m1", "1", { today: today({ joinId: "j" }) });
    const m2 = table("m2", "2", { today: today({ joinId: "j", placement: place(4, 0) }) });
    expect(dropAction([m1, m2], { tableId: "m1", x: 1, y: 0, targetId: "m2" })).toEqual({
      kind: "none",
    });
    expect(dropAction([m1, m2], { tableId: "gone", x: 1, y: 0, targetId: null })).toEqual({
      kind: "none",
    });
    expect(dropAction([m1, m2], { tableId: "m1", x: 1, y: 0, targetId: "gone" })).toEqual({
      kind: "none",
    });
    const unplanned = table("u", "6", { today: null });
    const spare = table("s", "7", { today: today({ placement: null }) });
    for (const target of [unplanned, spare]) {
      expect(
        dropAction([m1, m2, target], { tableId: "m1", x: 1, y: 0, targetId: target.id }),
      ).toEqual({ kind: "none" });
    }
  });
});

describe("seatsGuests", () => {
  const zone = (serviceMode: FloorZone["serviceMode"]): FloorZone => ({
    id: "z1",
    name: "Bar",
    displayOrder: 0,
    active: true,
    closesAt: null,
    closed: false,
    hasPlan: true,
    layoutSetName: null,
    layoutDue: null,
    serviceMode,
  });

  it("seats guests only in a table-service zone, or one the till has not read", () => {
    expect(seatsGuests(undefined)).toBe(true);
    expect(seatsGuests(zone("table_tab"))).toBe(true);
    expect(seatsGuests(zone("prepay"))).toBe(false);
    expect(seatsGuests(zone("ticket_then_pay"))).toBe(false);
    expect(seatsGuests(zone(null))).toBe(false);
  });
});

describe("seatsAtFreeTable", () => {
  const someone = { id: "p" } as TableParty;
  const join = (other: TableParty | null) =>
    ({ kind: "join", party: someone, tableId: "t", other, merge: null, heading: "h" }) as const;

  it("is true for seating two free tables and for joining a party onto a free one", () => {
    expect(
      seatsAtFreeTable({ kind: "seat", tableId: "t", withTableIds: ["u"], heading: "h" }),
    ).toBe(true);
    expect(seatsAtFreeTable(join(null))).toBe(true);
  });

  it("is false for every action that seats no one at a free table", () => {
    expect(seatsAtFreeTable(join(someone))).toBe(false);
    expect(
      seatsAtFreeTable({ kind: "merge", tableId: "t", targetId: "u", side: "left", heading: "h" }),
    ).toBe(false);
    expect(seatsAtFreeTable({ kind: "move", tableId: "t", x: 1, y: 2 })).toBe(false);
    expect(seatsAtFreeTable({ kind: "say", message: "no" })).toBe(false);
    expect(seatsAtFreeTable({ kind: "none" })).toBe(false);
  });
});

describe("pendingPlaces", () => {
  it("keeps a moved merge's members together until the next read", () => {
    const m1 = table("m1", "1", { today: today({ joinId: "j", placement: place(10, 10) }) });
    const m2 = table("m2", "2", { today: today({ joinId: "j", placement: place(14, 10) }) });
    const other = table("o", "3", { today: today({ placement: place(30, 30) }) });
    const zone = [m1, m2, other];
    expect(
      pendingPlaces(zone, dropAction(zone, { tableId: "m1", x: 14, y: 12, targetId: null })),
    ).toEqual(
      new Map([
        ["m1", place(14, 12)],
        ["m2", place(18, 12)],
      ]),
    );
  });

  it("holds a moved merge inside the grid, as the server does", () => {
    const m1 = table("m1", "1", { today: today({ joinId: "j", placement: place(990, 3) }) });
    const m2 = table("m2", "2", { today: today({ joinId: "j", placement: place(994, 3) }) });
    expect(pendingPlaces([m1, m2], { kind: "move", tableId: "m1", x: 999, y: 0 })).toEqual(
      new Map([
        ["m1", place(995, 0)],
        ["m2", place(999, 0)],
      ]),
    );
  });

  it("puts a merged or joined table against its target", () => {
    const a = table("a", "4", { today: today({ placement: place(10, 10, { rotation: 90 }) }) });
    const b = table("b", "5", { today: today({ placement: place(30, 0, { width: 2 }) }) });
    const turned = place(14, 10, { width: 2, rotation: 90 });
    expect(
      pendingPlaces([a, b], {
        kind: "merge",
        tableId: "b",
        targetId: "a",
        side: "right",
        heading: "4+5",
      }),
    ).toEqual(new Map([["b", { ...turned, x: 11, y: 13 }]]));
    expect(
      pendingPlaces([a, b], {
        kind: "join",
        party: party("P", ["b"]),
        tableId: "a",
        other: null,
        merge: { moving: "b", target: "a", side: "right" },
        heading: "4+5",
      }),
    ).toEqual(new Map([["b", { ...turned, x: 11, y: 13 }]]));
  });

  it("puts a table joining a merge on a side no member stands on, as the server places it", () => {
    const a = table("a", "1", { today: today({ joinId: "j", placement: place(100, 100) }) });
    const b = table("b", "2", { today: today({ joinId: "j", placement: place(104, 100) }) });
    const c = table("c", "3", { today: today({ placement: place(200, 100) }) });
    const zone = [a, b, c];
    const action = dropAction(zone, { tableId: "c", x: 101, y: 100, targetId: "a" });
    expect(action).toMatchObject({ kind: "merge", targetId: "a", side: "right" });

    const drawn = pendingPlaces(zone, action).get("c");

    const members = [a, b].map((each) => each.today!.placement!);
    const side = freeSide(members[0]!, c.today!.placement!, members, "right");
    expect(side).toBe("top");
    expect(drawn).toEqual({ ...place(100, 96), ...touchingPlace(members[0]!, place(0, 0), side) });
  });

  it("draws nothing new for a drop that moves nothing", () => {
    const a = table("a", "4");
    const none = new Map();
    expect(pendingPlaces([a], { kind: "none" })).toEqual(none);
    expect(pendingPlaces([a], { kind: "say", message: "x" })).toEqual(none);
    expect(
      pendingPlaces([a], { kind: "seat", tableId: "a", withTableIds: [], heading: "4" }),
    ).toEqual(none);
    expect(
      pendingPlaces([a], {
        kind: "join",
        party: party("P", ["a"]),
        tableId: "a",
        other: null,
        merge: null,
        heading: "4",
      }),
    ).toEqual(none);
    expect(pendingPlaces([a], { kind: "move", tableId: "gone", x: 1, y: 1 })).toEqual(none);
  });
});

describe("spares and taken-off tables", () => {
  it("lists movable spares and taken-off tables", () => {
    const placed = table("p", "1");
    const spare = table("s", "2", { today: today({ placement: null }) });
    const fixedSpare = table("fs", "3", { today: today({ placement: null, fixed: true }) });
    const off = table("off", "4", { today: today({ placement: null, takenOff: true }) });
    const unplanned = table("u", "5", { today: null });
    const zone = [placed, spare, fixedSpare, off, unplanned];
    expect(sparesOf(zone)).toEqual([spare]);
    expect(takenOffOf(zone)).toEqual([off]);
  });

  it("offers every unplaced real table as a spare", () => {
    const part = (id: string, label: string) =>
      table(id, label, { today: today({ placement: null, }) });
    const long = table("long", "Long table");
    const stool = table("stool-2", "Stool 2", { today: today({ placement: null }) });
    const zone = [
      part("c3", "Counter 3"),
      part("c4", "Counter 4"),
      part("c5", "Counter 5"),
      long,
      stool,
    ];
    expect(sparesOf(zone).map((each) => each.id)).toEqual(["c3", "c4", "c5", "stool-2"]);
  });

  it("puts a spare in the middle of the zone's crop", () => {
    const square = { width: 8, height: 8 };
    const left = table("l", "1", { today: today({ placement: place(0, 0, square) }) });
    const right = table("r", "2", { today: today({ placement: place(20, 0, square) }) });
    const off = table("off", "3", {
      today: today({ placement: place(500, 500, square), takenOff: true }),
    });
    expect(spareSpot([left, right, off])).toEqual({ x: 10, y: 0 });
    expect(spareSpot([table("s", "4", { today: today({ placement: null }) })])).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("Split tables… on a group", () => {
  const long = table("long", "Long table", {
    today: today({
      placement: null,
      seats: 10,
    }),
  });
  const inGroup = (id: string, label: string, over: Partial<TableState> = {}) =>
    table(id, label, {
      ...over,
      today: today({ placement: place(40, 0), joinId: "g", ...over.today }),
    });
  const bar = table("bar", "Bar", { today: today({ placement: place(38, 0), joinId: "g" }) });
  const c3 = inGroup("c3", "Counter 3");
  const c4 = inGroup("c4", "Counter 4");
  const c5 = inGroup("c5", "Counter 5");
  const zone = [c5, long, c3, bar, c4];

  it("offers Split tables… on any table in a group, and never the old Split", () => {
    expect(sheetActions(bar, zone)).toContain("split-off");
    expect(sheetActions(c4, zone)).toContain("split-off");
    expect(sheetActions(bar, zone)).not.toContain("split");
    const one = table("a", "1", { today: today({ joinId: "m" }) });
    const two = table("b", "2", { today: today({ joinId: "m", placement: place(4, 0) }) });
    expect(sheetActions(one, [one, two])).toContain("split-off");
  });

  it("lists the group's tables in number order and names the group after them", () => {
    const split = groupSplitOf(c4, zone)!;
    expect(split.members.map((each) => each.label)).toEqual([
      "Bar",
      "Counter 3",
      "Counter 4",
      "Counter 5",
    ]);
    expect(split.name).toBe("Bar+Counter 3+Counter 4+Counter 5");
    expect(groupSplitOf(table("t", "1"), zone)).toBeNull();
  });

  it("asks seats whenever two or more tables stay", () => {
    const asks = groupSplitOf(bar, zone)!.asksSeats;
    expect(asks(["c3", "c4", "c5"])).toBe(true);
    expect(asks(["c3", "c4"])).toBe(true);
    expect(asks(["bar", "c3", "c4"])).toBe(true);
    expect(asks(["c3"])).toBe(false);
  });

  describe("where the guests go", () => {
    const seatedAt = (...ids: string[]) => {
      const p = party("p", ids);
      return zone.map((each) =>
        ids.includes(each.id) ? { ...each, ...seatedBy(p), today: each.today } : each,
      );
    };

    it("names the tables a party keeps when a table it holds is ticked", () => {
      const seated = seatedAt("bar", "c3", "c4");
      const moves = groupSplitOf(bar, seated)!.guestsMoveTo;
      expect(moves(["bar"])).toEqual(["Counter 3+4"]);
      expect(moves(["c3", "c5"])).toEqual(["Bar+Counter 4"]);
    });

    it("names nothing when no ticked table holds a party, or the party would keep none", () => {
      const moves = groupSplitOf(bar, seatedAt("bar", "c3"))!.guestsMoveTo;
      expect(moves(["c4", "c5"])).toEqual([]);
      expect(moves(["bar", "c3"])).toEqual([]);
      expect(groupSplitOf(bar, zone)!.guestsMoveTo(["bar"])).toEqual([]);
    });

    it("says a ticked set strands guests when it holds every table one party holds", () => {
      const alone = groupSplitOf(bar, seatedAt("bar"))!.strandsGuests;
      expect(alone(["bar"])).toBe(true);
      expect(alone(["bar", "c3"])).toBe(true);
      expect(alone(["c3", "c4"])).toBe(false);
      const two = groupSplitOf(bar, seatedAt("bar", "c3"))!.strandsGuests;
      expect(two(["bar"])).toBe(false);
      expect(two(["bar", "c3"])).toBe(true);
      expect(groupSplitOf(bar, zone)!.strandsGuests(["bar"])).toBe(false);
    });

    it("strands no party that keeps a table off this zone's tables", () => {
      const p = party("p", ["bar", "elsewhere"]);
      const seated = zone.map((each) => (each.id === "bar" ? { ...each, ...seatedBy(p) } : each));
      expect(groupSplitOf(bar, seated)!.strandsGuests(["bar"])).toBe(false);
    });

    it("names nothing for a party that keeps a table off this zone's tables", () => {
      const p = party("p", ["bar", "elsewhere"]);
      const seated = zone.map((each) => (each.id === "bar" ? { ...each, ...seatedBy(p) } : each));
      expect(groupSplitOf(bar, seated)!.guestsMoveTo(["bar"])).toEqual([]);
    });
  });

});

describe("today's names", () => {
  const bar = table("bar", "Bar", { today: today({ joinId: "j" }) });
  const c4 = table("c4", "Counter 4", { today: today({ joinId: "j" }) });
  const window4 = table("c4", "Counter 4", { today: today({ joinId: "j", name: "Window" }) });
  const named = (each: TableState): TableState => ({
    ...each,
    today: { ...each.today!, joinName: "García birthday" },
  });

  it("shows a table's own name for today, else its saved label", () => {
    expect(shownName(window4)).toBe("Window");
    expect(shownName(c4)).toBe("Counter 4");
    expect(shownName(table("c4", "Counter 4", { today: today({ name: null }) }))).toBe("Counter 4");
    expect(shownName(table("c4", "Counter 4", { today: null }))).toBe("Counter 4");
  });

  it("names a group by its own name, else its tables' shown names in number order", () => {
    expect(groupName([named(bar), named(window4)])).toBe("García birthday");
    expect(groupName([window4, bar])).toBe("Bar+Window");
    expect(groupName([c4, bar])).toBe("Bar+Counter 4");
    expect(groupName([{ ...bar, today: { ...bar.today!, joinName: null } }, c4])).toBe(
      "Bar+Counter 4",
    );
    expect(groupName([])).toBe("");
  });

  it("names a group's normal name from its tables' shown names, never its own name", () => {
    expect(normalGroupName([named(bar), named(window4)])).toBe("Bar+Window");
    expect(normalGroupName([c4, bar])).toBe("Bar+Counter 4");
  });
});

describe("tightName", () => {
  it("uses the saved short name, whatever today's name", () => {
    const renamed = table("t2", "Table 2", { shortName: "T2", today: today({ name: "Window" }) });
    expect(tightName(renamed, joinMembersById([renamed]))).toBe("T2");
  });

  it("names a table of today's join by the join's tables' short names, in number order", () => {
    const joined = today({ joinId: "j1", joinName: "Birthday" });
    const t10 = table("t10", "Table 10", { shortName: "T10", today: joined });
    const t9 = table("t9", "Table 9", { shortName: "T9", today: joined });
    const t3 = table("t3", "Table 3", { shortName: "T3" });
    const tables = [t10, t3, t9];
    expect(tightName(t10, joinMembersById(tables))).toBe("T9+T10");
    expect(tightName(t9, joinMembersById(tables))).toBe("T9+T10");
    expect(tightName(t3, joinMembersById(tables))).toBe("T3");
  });

  it("falls back to its own short name when its join's tables are not in the list", () => {
    const t9 = table("t9", "Table 9", { shortName: "T9", today: today({ joinId: "j1" }) });
    const t3 = table("t3", "Table 3", { shortName: "T3" });
    expect(tightName(t9, joinMembersById([t3]))).toBe("T9");
  });
});

describe("today's names on a drop and a group split", () => {
  const garcia = (id: string, label: string, x: number, over: Partial<TableToday> = {}) =>
    table(id, label, {
      today: today({ placement: place(x, 0), joinId: "g", joinName: "García birthday", ...over }),
    });
  const c6 = table("c6", "Counter 6", { today: today({ placement: place(20, 0) }) });

  it("heads a drop on a group with a name for today with that name", () => {
    const zone = [garcia("c4", "Counter 4", 0, { fixed: true }), garcia("c5", "Counter 5", 4), c6];
    expect(dropAction(zone, { tableId: "c6", x: 8, y: 0, targetId: "c5" })).toEqual({
      kind: "seat",
      tableId: "c6",
      withTableIds: ["c4", "c5"],
      heading: "García birthday",
    });
  });

  it("heads a drop on a renamed table with its tables' shown names", () => {
    const window4 = table("c4", "Counter 4", {
      today: today({ placement: place(0, 0), fixed: true, name: "Window" }),
    });
    const bar = table("bar", "Bar", { today: today({ placement: place(20, 0) }) });
    expect(dropAction([window4, bar], { tableId: "bar", x: 4, y: 0, targetId: "c4" })).toEqual({
      kind: "seat",
      tableId: "bar",
      withTableIds: ["c4"],
      heading: "Bar+Window",
    });
  });

  describe("a group split by its name for today", () => {
    const seatedAt = (...ids: string[]) => {
      const p = party("p", ids);
      return (id: string, label: string, x: number, name: string | null = null) => {
        const each = garcia(id, label, x, { name });
        return ids.includes(id) ? { ...each, ...seatedBy(p) } : each;
      };
    };

    it("is headed with the group's name, and guests kept in the group while two or more tables stay move to its name once", () => {
      const seated = seatedAt("c3", "c4", "c5");
      const zone = [
        seated("c3", "Counter 3", 0),
        seated("c4", "Counter 4", 4, "Window"),
        seated("c5", "Counter 5", 8),
      ];
      const split = groupSplitOf(zone[0]!, zone)!;
      expect(split.name).toBe("García birthday");
      expect(split.guestsMoveTo(["c3"])).toEqual(["García birthday"]);
    });

    it("names the group once for guests keeping one of its tables while others stay", () => {
      const seated = seatedAt("c3", "c4");
      const zone = [
        seated("c3", "Counter 3", 0),
        seated("c4", "Counter 4", 4, "Window"),
        seated("c5", "Counter 5", 8),
        seated("bar", "Bar", 12),
      ];
      expect(groupSplitOf(zone[0]!, zone)!.guestsMoveTo(["c3"])).toEqual(["García birthday"]);
    });

    it("names the one table that stays by its own shown name, the group ending", () => {
      const seated = seatedAt("c3", "c4");
      const zone = [
        seated("c3", "Counter 3", 0),
        seated("c4", "Counter 4", 4, "Window"),
        seated("c5", "Counter 5", 8),
      ];
      expect(groupSplitOf(zone[0]!, zone)!.guestsMoveTo(["c3", "c5"])).toEqual(["Window"]);
    });
  });
});

it("draws an ordinary table from the new wire shape and offers ordinary actions", () => {
  const plain = table("member", "Counter 3");
  for (const key of ["inJoinedTable", "joined", "splitOffFrom"] as const) delete (plain.today as unknown as Record<string, unknown>)[key];
  expect(onTodaysPlan(plain)).toBe(true);
  expect(sheetActions(plain)).toEqual(["join-with", "rotate", "seats", "rename", "back", "take-off"]);
});
