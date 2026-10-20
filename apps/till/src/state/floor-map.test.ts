import { afterEach, describe, expect, it } from "vitest";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { TableParty, TableState, TableToday } from "../api/client.js";
import {
  combinedStatus,
  listedTables,
  mapTables,
  pinText,
  seatsFor,
  standInStatus,
  statusPin,
} from "./floor-map.js";
import "@waitron/ui/src/components/wt-floor-map.js";

function table(over: Partial<TableState> = {}): TableState {
  return {
    id: "t1",
    label: "1",
    zoneId: "z1",
    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: null,
    signals: [],
    party: null,
    ...over,
  };
}

const placement = { x: 2, y: 3, width: 2, height: 2, shape: "round" as const, rotation: 0 };

function today(over: Partial<TableToday> = {}): TableToday {
  return {
    placement,
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

const now = Date.parse("2026-10-10T20:30:00Z");

function party(id: string): TableParty {
  return {
    id,
    kitchenNote: { scope: { partyId: id }, note: null, revision: 0, ownerRevision: 1 },
    revision: 1,
    guestCount: 2,
    state: "open",
    name: null,
    displayName: id,
    mainBillId: null,
    outstanding: "0.00",
    billCount: 1,
    tableIds: [],
    unsentDrafts: [],
    reminder: null,
  };
}

const bill = { kind: "bill_requested" as const, requestedAt: "2026-10-10T20:00:00Z" };
const seated = { state: "open-tab" as const, condition: "held" as const, party: party("S") };

const startLocale = currentLocale();
afterEach(() => setLocale(startLocale));

describe("standInStatus", () => {
  it("a free table is free, a booked free one reserved", () => {
    expect(standInStatus(table())).toEqual({ fill: "free", dot: null });
    expect(standInStatus(table({ nextReservation: { time: "20:30" } }))).toEqual({
      fill: "reserved",
      dot: null,
    });
  });

  it("a party or a delivery on its way makes it seated, even when booked", () => {
    expect(standInStatus(table({ state: "open-tab" })).fill).toBe("seated");
    expect(standInStatus(table({ state: "delivery-pending" })).fill).toBe("seated");
    expect(
      standInStatus(table({ state: "open-tab", nextReservation: { time: "20:30" } })).fill,
    ).toBe("seated");
  });

  it("a bill requested beats seated, and needs clearing beats both", () => {
    expect(standInStatus(table({ ...seated, signals: [bill] })).fill).toBe("bill");
    expect(standInStatus(table({ condition: "needs_clearing", signals: [bill] })).fill).toBe(
      "clearing",
    );
  });

  it("a forgotten order's dot beats ready dishes'", () => {
    expect(standInStatus(table({ ...seated, readyToServe: 2 })).dot).toBe("ready");
    expect(standInStatus(table({ ...seated, readyToServe: 2, timingBand: "forgotten" })).dot).toBe(
      "forgotten",
    );
    expect(standInStatus(table({ ...seated, timingBand: "overdue" })).dot).toBeNull();
  });
});

describe("combinedStatus", () => {
  it("a merge shows its most urgent member", () => {
    expect(
      combinedStatus([
        { fill: "seated", dot: "ready" },
        { fill: "free", dot: null },
      ]),
    ).toEqual({ fill: "seated", dot: "ready" });
    expect(
      combinedStatus([
        { fill: "bill", dot: null },
        { fill: "seated", dot: "forgotten" },
      ]),
    ).toEqual({ fill: "bill", dot: "forgotten" });
    expect(
      combinedStatus([
        { fill: "reserved", dot: null },
        { fill: "clearing", dot: null },
        { fill: "free", dot: "ready" },
      ]),
    ).toEqual({ fill: "clearing", dot: "ready" });
  });
});

describe("words", () => {
  const pin = (over: Partial<TableState>): string => pinText(table(over));

  it("says one ready dish in the singular on the pin", () => {
    expect(pin({ ...seated, readyToServe: 1 })).toBe("1 ready");
    setLocale("es");
    expect(pin({ ...seated, readyToServe: 1 })).toBe("1 listo");
    expect(pin({ ...seated, readyToServe: 2 })).toBe("2 listos");
  });

  it("gives the pin its shortest word", () => {
    expect(pin({ ...seated, readyToServe: 2, timingBand: "forgotten" })).toBe("Forgotten");
    expect(pin({ ...seated, readyToServe: 2, pendingToServe: 3 })).toBe("2 ready");
    expect(pin({ ...seated, signals: [bill] })).toBe("Bill requested");
    expect(pin({ ...seated, pendingToServe: 3 })).toBe("3 to serve");
    expect(pin({ ...seated })).toBe("Seated");
    expect(pin({ nextReservation: { time: "20:30" } })).toBe("Reserved 20:30");
    expect(pin({ signals: [bill], pendingToServe: 3 })).toBe("Bill requested");
  });

  it("takes a merge's pin count from the member that gave the dot, never summed", () => {
    const free = table({ id: "b" });
    const party = table({ id: "c", ...seated, readyToServe: 2, pendingToServe: 5 });
    const sameParty = table({ id: "d", ...seated, readyToServe: 2, pendingToServe: 5 });
    const merged = [free, party, sameParty];
    expect(pinText(merged)).toBe("2 ready");
    expect(pinText([free, table({ id: "e", ...seated, pendingToServe: 5 })])).toBe("5 to serve");
  });

  it("reads a merge's to-serve count from its seated member with the most, in either order", () => {
    const delivery = table({ id: "a", state: "delivery-pending", pendingToServe: 0 });
    const party = table({ id: "b", ...seated, pendingToServe: 3 });
    const other = table({ id: "c", ...seated, pendingToServe: 2 });
    expect(pinText([delivery, party])).toBe("3 to serve");
    expect(pinText([party, delivery])).toBe("3 to serve");
    expect(pinText([other, party, delivery])).toBe("3 to serve");
  });
});

describe("a table that needs moving", () => {
  const movingToday = today({ needsMoving: true });

  it("takes the clearing fill and reads Needs moving on the pin, even with a booking to come", () => {
    const moving = table({ today: movingToday });
    expect(standInStatus(moving)).toEqual({ fill: "clearing", dot: null });
    expect(pinText(moving)).toBe("Needs moving");
    const booked = table({ today: movingToday, nextReservation: { time: "20:30" } });
    expect(standInStatus(booked).fill).toBe("clearing");
    expect(pinText(booked)).toBe("Needs moving");
  });

  it("takes the clearing fill while it also needs clearing", () => {
    const both = table({ condition: "needs_clearing", today: movingToday });
    expect(standInStatus(both).fill).toBe("clearing");
  });

  it("in a merge ranks with Needs clearing, above a bill, on the pin", () => {
    const moving = table({ id: "a", today: movingToday });
    const billed = table({ id: "b", ...seated, signals: [bill] });
    expect(statusPin([billed, moving])).toEqual({
      fill: "clearing",
      dot: null,
      text: "Needs moving",
    });
  });

  it("is drawn in its old place with the dashed outline over the next fill, and its words", () => {
    const drawn = mapTables([table({ today: movingToday })], now);
    expect(drawn.map((row) => [row.placement, row.fill, row.outline, row.description])).toEqual([
      [placement, "free", "clearing", "Needs moving"],
    ]);
  });
});

describe("zones and their tables", () => {
  it("A669 carries allergy presence across joined tables without replacing their status", () => {
    const marked = table({ id: "a", today: today({ joinId: "j" }), hasAllergy: true });
    const joined = table({ id: "b", today: today({ joinId: "j" }), readyToServe: 2 });
    const other = table({ id: "c", today: today() });
    const mapped = mapTables([marked, joined, other], now);
    const ready = { fill: "ready", cue: { icon: "floor-ready", text: "2" } };
    expect(mapped[0]).toMatchObject({ allergy: true, ...ready });
    expect(mapped[1]).toMatchObject({ allergy: true, ...ready });
    expect(mapped[2]).not.toHaveProperty("allergy");
    expect(mapTables([joined, marked], now).map((row) => row.allergy)).toEqual([true, true]);
    expect(mapTables([{ ...marked, hasAllergy: undefined }, joined], now)[0]).not.toHaveProperty(
      "allergy",
    );
  });

  it("maps placed tables, leaving out spares and taken-off ones", () => {
    const t1 = table({ id: "t1", label: "1", today: today() });
    const t2 = table({ id: "t2", label: "2", today: today({ placement: null }) });
    const t3 = table({ id: "t3", label: "3", today: today({ takenOff: true }) });
    expect(mapTables([t1, t2, t3], now)).toEqual([
      {
        id: "t1",
        label: "1",
        placement,
        fill: "free",
        outline: null,
        pulse: null,
        cue: null,
        joinId: null,
        fixed: false,
        linkId: null,
        description: "Free",
      },
    ]);
  });

  it("gives a merge's members one status and one description", () => {
    const t4 = table({
      id: "t4",
      label: "4",
      ...seated,
      readyToServe: 2,
      today: today({ joinId: "j1" }),
    });
    const t5 = table({ id: "t5", label: "5", today: today({ joinId: "j1" }) });
    const t6 = table({ id: "t6", label: "6", ...seated, party: party("T6"), today: today() });
    const shared = {
      fill: "ready",
      outline: null,
      pulse: null,
      cue: { icon: "floor-ready", text: "2" },
      joinId: "j1",
      fixed: false,
      linkId: null,
      description: "Seated, 2 ready",
    };
    expect(mapTables([t5, t4, t6], now)).toEqual([
      { id: "t5", label: "5", placement, ...shared },
      { id: "t4", label: "4", placement, ...shared },
      {
        id: "t6",
        label: "6",
        placement,
        fill: "calm",
        outline: null,
        pulse: null,
        cue: { icon: "floor-check", text: "" },
        joinId: null,
        fixed: false,
        linkId: null,
        description: "Seated, Nothing needed",
      },
    ]);
  });

  it("links a party's tables on the map and gives them one status", () => {
    const p = party("P");
    const t1 = table({
      id: "t1",
      label: "1",
      ...seated,
      party: p,
      readyToServe: 2,
      today: today(),
    });
    const t2 = table({ id: "t2", label: "2", ...seated, party: p, today: today() });
    const t3 = table({ id: "t3", label: "3", ...seated, party: p, today: today({ joinId: "j" }) });
    const t4 = table({ id: "t4", label: "4", ...seated, party: p, today: today({ joinId: "j" }) });
    const off = table({
      id: "t5",
      label: "5",
      ...seated,
      party: p,
      today: today({ takenOff: true }),
    });
    const linked = mapTables([t1, t2, t3, t4, off], now);
    const readyCue = { icon: "floor-ready", text: "2" };
    expect(linked.map((row) => [row.id, row.linkId, row.fill, row.cue, row.description])).toEqual([
      ["t1", "P", "ready", readyCue, "Seated, 2 ready"],
      ["t2", "P", "ready", readyCue, "Seated, 2 ready"],
      ["t3", "P", "ready", readyCue, "Seated, 2 ready"],
      ["t4", "P", "ready", readyCue, "Seated, 2 ready"],
    ]);

    const q = party("Q");
    const alone = table({ id: "t6", label: "6", ...seated, party: q, today: today() });
    const merged = [t3, t4].map((each) => ({ ...each, party: q }));
    expect(mapTables([alone, t2], now).map((row) => row.linkId)).toEqual([null, null]);
    expect(mapTables(merged, now).map((row) => [row.linkId, row.description])).toEqual([
      [null, "Seated, Nothing needed"],
      [null, "Seated, Nothing needed"],
    ]);
    expect(mapTables([...merged, alone], now).map((row) => row.linkId)).toEqual(["Q", "Q", "Q"]);
  });

  it("carries today's names only when a table or its group has one", () => {
    const plain = table({ id: "t1", today: today({ name: null, joinName: null }) });
    expect(mapTables([plain], now)[0]).not.toHaveProperty("name");
    expect(mapTables([plain], now)[0]).not.toHaveProperty("groupName");
    expect(mapTables([table({ id: "t1", today: today() })], now)[0]).not.toHaveProperty("name");
    const named = table({
      id: "t1",
      today: today({ joinId: "j", name: "Window", joinName: "García birthday" }),
    });
    expect(mapTables([named], now)[0]).toMatchObject({
      name: "Window",
      groupName: "García birthday",
    });
  });

  it("marks a fixed table fixed", () => {
    const fixed = table({ id: "t1", today: today({ fixed: true }) });
    expect(mapTables([fixed], now)[0]!.fixed).toBe(true);
  });

  it("lists what is on today's plan and what must stay reachable", () => {
    const t1 = table({ id: "t1", today: today() });
    const t2 = table({ id: "t2", today: today({ placement: null }) });
    const t3 = table({ id: "t3", today: today({ takenOff: true }) });
    const t4 = table({ id: "t4", ...seated, today: today({ placement: null }) });
    const t5 = table({ id: "t5", condition: "needs_clearing", today: today({ placement: null }) });
    const t6 = table({ id: "t6", state: "delivery-pending", today: today({ placement: null }) });
    const t7 = table({ id: "t7" });
    expect(listedTables([t1, t2, t3, t4, t5, t6, t7])).toEqual([t1, t4, t5, t6, t7]);
  });

  it("lists a taken-off table that needs clearing, and does not draw it", () => {
    const off = table({
      id: "t8",
      condition: "needs_clearing",
      today: today({ placement: null, takenOff: true }),
    });
    expect(listedTables([off])).toEqual([off]);
    expect(mapTables([off], now)).toEqual([]);
  });

  it.each([
    ["map", (tables: TableState[]) => mapTables(tables, now)],
    ["list", listedTables],
  ] as const)("a still-joined part that kept its place is absent from the %s", (_name, read) => {
    const part = table({
      id: "c3",
      label: "Counter 3",
      today: today({ inJoinedTable: "Long table" }),
    });
    const joined = table({ id: "long", label: "Long table", today: today() });
    expect(read([part, joined]).map((each) => each.id)).toEqual(["long"]);
  });

  it("lists a still-joined part that needs clearing, and does not draw it", () => {
    const part = table({
      id: "c3",
      condition: "needs_clearing",
      today: today({ inJoinedTable: "Long table" }),
    });
    expect(listedTables([part])).toEqual([part]);
    expect(mapTables([part], now)).toEqual([]);
  });

  it("reads seats only from today or its merge, with none without a today row", () => {
    expect(seatsFor(table({ today: today({ seats: 6 }) }))).toBe(6);
    expect(seatsFor(table({ today: today({ seats: 6, joinId: "j1", joinSeats: 10 }) }))).toBe(10);
    expect(seatsFor(table({}))).toBeNull();
    expect(seatsFor(table({ today: today({ seats: null }) }))).toBeNull();
  });
});

describe("a joined table split today", () => {
  it("draws a part split off after its joined table, so it sits on top", () => {
    const c5 = table({
      id: "c5",
      label: "Counter 5",
      today: today({ splitOffFrom: "long" }),
    });
    const long = table({
      id: "long",
      label: "Long table",
      today: today({ joined: { parts: ["c3", "c4"], splitOff: ["c5"], apart: false } }),
    });
    const stool = table({ id: "stool", label: "Stool 2", today: today() });
    expect(mapTables([c5, long, stool], now).map((each) => each.id)).toEqual([
      "long",
      "stool",
      "c5",
    ]);
    expect(mapTables([long, c5, stool], now).map((each) => each.id)).toEqual([
      "long",
      "stool",
      "c5",
    ]);
  });

  it("draws a part split off on top when it is merged with a table listed before its joined table", async () => {
    const bar2 = table({
      id: "bar2",
      label: "Bar 2",
      today: today({ joinId: "J", placement: { ...placement, x: 0 } }),
    });
    const long = table({
      id: "long",
      label: "Long table",
      today: today({ joined: { parts: ["c3", "c4"], splitOff: ["c5"], apart: false } }),
    });
    const c5 = table({
      id: "c5",
      label: "Counter 5",
      today: today({ splitOffFrom: "long", joinId: "J" }),
    });
    const map = document.createElement("wt-floor-map");
    map.style.cssText = "display: block; width: 600px; height: 300px";
    map.tables = mapTables([bar2, long, c5], now);
    document.body.append(map);
    try {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      await map.updateComplete;
      const drawn = [...map.shadowRoot!.querySelectorAll<HTMLElement>('[part="table"]')].map(
        (group) => group.dataset["tableId"],
      );
      expect(drawn).toEqual(["long", "bar2"]);
    } finally {
      map.remove();
    }
  });
});
