import { afterEach, describe, expect, it } from "vitest";
import { freeSide, touchingPlace } from "@waitron/shared";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { TableParty, TableState, TableToday, TodayPlacement } from "../api/client.js";
import {
  dropAction,
  joinAgainOf,
  onTodaysPlan,
  outOfServiceJoined,
  pendingPlaces,
  sheetActions,
  spareSpot,
  sparesOf,
  takenOffOf,
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
    inJoinedTable: null,
    joined: null,
    splitOffFrom: null,
    zoneRevision: 0,
    ...over,
  };
}

function party(id: string, tableIds: string[]): TableParty {
  return {
    id,
    revision: 1,
    guestCount: 2,
    state: "open",
    name: null,
    displayName: tableIds.join("+"),
    mainBillId: null,
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
    enRoute: 0,
    timingBand: "fresh",
    status: null,
    nextReservation: null,
    today: today(),
    signals: [],
    party: null,
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

  it("two seated tables join into the target's party, after the bill choice", () => {
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

  it("offers Stool 2 as a spare but no part of Long table", () => {
    const part = (id: string, label: string) =>
      table(id, label, { today: today({ placement: null, inJoinedTable: "Long table" }) });
    const long = table("long", "Long table");
    const stool = table("stool-2", "Stool 2", { today: today({ placement: null }) });
    const zone = [
      part("c3", "Counter 3"),
      part("c4", "Counter 4"),
      part("c5", "Counter 5"),
      long,
      stool,
    ];
    expect(sparesOf(zone)).toEqual([stool]);
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

  it("leaves a placed part still in a joined table out of the spare's crop", () => {
    const square = { width: 8, height: 8 };
    const left = table("l", "1", { today: today({ placement: place(0, 0, square) }) });
    const right = table("r", "2", { today: today({ placement: place(20, 0, square) }) });
    const part = table("c3", "Counter 3", {
      today: today({ placement: place(500, 500, square), inJoinedTable: "Long table" }),
    });
    expect(spareSpot([left, right, part])).toEqual({ x: 10, y: 0 });
  });
});

describe("a joined table split today", () => {
  const long = table("long", "Long table", {
    today: today({
      placement: place(10, 20, { width: 6, height: 2 }),
      seats: 10,
      joined: { parts: ["c3", "c4"], splitOff: ["c5"], apart: false },
    }),
  });
  const c3 = table("c3", "Counter 3", {
    today: today({ placement: null, seats: 2, inJoinedTable: "Long table" }),
  });
  const c4 = table("c4", "Counter 4", {
    today: today({ placement: null, seats: 6, inJoinedTable: "Long table" }),
  });
  const c5 = table("c5", "Counter 5", {
    today: today({ placement: place(10, 22, { width: 8, height: 8 }), splitOffFrom: "long" }),
  });
  const bar = table("bar", "Bar table", {
    today: today({
      placement: place(40, 0, { width: 6, height: 2 }),
      joined: { parts: [], splitOff: ["b1", "b2"], apart: true },
    }),
  });

  it("offers Split tables… on Long table while two or more parts are joined, and not once it has come apart", () => {
    expect(sheetActions(long)).toContain("split-off");
    const merged = sheetActions(
      table("long", "Long table", { today: { ...long.today!, joinId: "m1" } }),
    );
    expect(merged.indexOf("split-off")).toBe(merged.indexOf("split") + 1);
    expect(sheetActions(bar)).not.toContain("split-off");
    const heldWithOnePart = table("long", "Long table", {
      ...seatedBy(party("p1", ["long"])),
      today: today({ joined: { parts: ["c3"], splitOff: ["c4", "c5"], apart: false } }),
    });
    expect(sheetActions(heldWithOnePart)).not.toContain("split-off");
    expect(sheetActions(table("t", "1"))).not.toContain("split-off");
  });

  it("offers neither Back nor Take off on a part split off", () => {
    expect(sheetActions(c5)).not.toContain("back");
    expect(sheetActions(c5)).not.toContain("take-off");
    expect(sheetActions(table("t", "1"))).toEqual(expect.arrayContaining(["back", "take-off"]));
  });

  it("offers no Back on Long table once a part is split off", () => {
    expect(sheetActions(long)).not.toContain("back");
    const whole = table("long", "Long table", {
      today: today({ joined: { parts: ["c3", "c4", "c5"], splitOff: [], apart: false } }),
    });
    expect(sheetActions(whole)).toContain("back");
  });

  it("keeps a joined table that came apart off the map, out of the spares and out of the pickers", () => {
    expect(onTodaysPlan(bar)).toBe(false);
    expect(outOfServiceJoined(bar)).toBe(true);
    const unplacedBar = table("bar", "Bar table", {
      today: today({ placement: null, joined: { parts: [], splitOff: ["b1", "b2"], apart: true } }),
    });
    expect(sparesOf([unplacedBar, c3, c4])).toEqual([]);
    expect(outOfServiceJoined(long)).toBe(false);
    expect(outOfServiceJoined(c5)).toBe(false);
    expect(outOfServiceJoined(c3)).toBe(true);
    expect(onTodaysPlan(long)).toBe(true);
    expect(onTodaysPlan(c5)).toBe(true);
  });

  it("offers Join again on Long table and on Counter 5 while Counter 5 is free", () => {
    const zone = [long, c3, c4, c5];
    const offered = sheetActions(long, zone);
    expect(offered.indexOf("join-again")).toBe(offered.indexOf("split-off") + 1);
    expect(sheetActions(c5, zone)).toContain("join-again");
    expect(sheetActions(long)).not.toContain("join-again");
  });

  const busy: [string, Partial<TableState>][] = [
    ["seated", seatedBy(party("p1", ["c5"]))],
    ["needing clearing", { condition: "needs_clearing" }],
    ["merged", { today: { ...c5.today!, joinId: "m1" } }],
    ["with food on its way", { pendingDeliveries: 1 }],
  ];

  it.each(busy)(
    "offers no Join again on a table split off that is not free, nor on a joined table none of whose split-off tables is free: Counter 5 %s",
    (_, over) => {
      const busyC5 = table("c5", "Counter 5", { ...c5, ...over });
      const zone = [long, c3, c4, busyC5];
      expect(sheetActions(busyC5, zone)).not.toContain("join-again");
      expect(sheetActions(long, zone)).not.toContain("join-again");
    },
  );

  it.each(busy)(
    "offers Join again on a free table split off, but not on one that is busy, while another is free: Counter 5 %s",
    (_, over) => {
      const standing = table("long", "Long table", {
        today: today({
          placement: place(10, 20, { width: 6, height: 2 }),
          seats: 10,
          joined: { parts: ["c3", "c6"], splitOff: ["c4", "c5"], apart: false },
        }),
      });
      const freeC4 = table("c4", "Counter 4", {
        today: today({ placement: place(30, 22), splitOffFrom: "long" }),
      });
      const busyC5 = table("c5", "Counter 5", { ...c5, ...over });
      const zone = [standing, c3, freeC4, busyC5];
      expect(sheetActions(busyC5, zone)).not.toContain("join-again");
      expect(sheetActions(freeC4, zone)).toContain("join-again");
      expect(sheetActions(standing, zone)).toContain("join-again");
    },
  );

  describe("Bar table, come apart", () => {
    const comeApart = (splitOff: string[]) =>
      table("bar", "Bar table", {
        today: today({
          placement: place(40, 0, { width: 6, height: 2 }),
          joined: { parts: [], splitOff, apart: true },
        }),
      });
    const barPart = (id: string, label: string, over: Partial<TableState> = {}) =>
      table(id, label, {
        ...over,
        today: today({ placement: place(40, 10), splitOffFrom: "bar", ...over.today }),
      });

    it("names why each table stays apart, and says whether every table comes back", () => {
      const bar3 = comeApart(["b1", "b2", "b3"]);
      const b1 = barPart("b1", "Bar 1", seatedBy(party("p1", ["b1"])));
      const b2 = barPart("b2", "Bar 2");
      const b3 = barPart("b3", "Bar 3");
      expect(joinAgainOf(b2, [bar3, b1, b2, b3])).toEqual({
        joined: bar3,
        back: [b2, b3],
        apart: [{ table: b1, reason: "guests" }],
        whole: false,
      });
      const reasons: [Partial<TableState>, string][] = [
        [{ condition: "needs_clearing" }, "clearing"],
        [
          { today: today({ placement: place(40, 10), splitOffFrom: "bar", joinId: "m1" }) },
          "merged",
        ],
        [{ pendingDeliveries: 1 }, "food"],
        [
          {
            ...seatedBy(party("p1", ["b1"])),
            today: today({ placement: place(40, 10), splitOffFrom: "bar", joinId: "m1" }),
          },
          "guests",
        ],
      ];
      for (const [over, reason] of reasons) {
        const apartB1 = barPart("b1", "Bar 1", over);
        expect(joinAgainOf(b2, [bar3, apartB1, b2, b3])?.apart).toEqual([
          { table: apartB1, reason },
        ]);
      }
      const freeB1 = barPart("b1", "Bar 1");
      expect(joinAgainOf(b2, [bar3, freeB1, b2, b3])).toEqual({
        joined: bar3,
        back: [freeB1, b2, b3],
        apart: [],
        whole: true,
      });
    });

    it("offers no Join again when fewer than two tables would be joined", () => {
      const bar2 = comeApart(["b1", "b2"]);
      const b1 = barPart("b1", "Bar 1", seatedBy(party("p1", ["b1"])));
      const b2 = barPart("b2", "Bar 2");
      expect(joinAgainOf(b2, [bar2, b1, b2])).toBeNull();
    });
  });
});
