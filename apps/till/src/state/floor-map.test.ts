import { afterEach, describe, expect, it } from "vitest";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { TableState, TableToday } from "../api/client.js";
import {
  combinedStatus,
  isPlannedZone,
  listedTables,
  mapTables,
  pinText,
  seatsFor,
  standInStatus,
  statusWords,
} from "./floor-map.js";

function table(over: Partial<TableState> = {}): TableState {
  return {
    id: "t1",
    label: "1",
    zoneId: "z1",
    capacity: 4,
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
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
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
    ...over,
  };
}

const bill = { kind: "bill_requested" as const, requestedAt: "2026-10-10T20:00:00Z" };
const seated = { state: "open-tab" as const, condition: "held" as const };

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
  const words = (over: Partial<TableState>): string => {
    const one = table(over);
    return statusWords(one, standInStatus(one));
  };
  const pin = (over: Partial<TableState>): string => {
    const one = table(over);
    return pinText(one, standInStatus(one));
  };

  it("says the status in words", () => {
    expect(words({})).toBe("Free");
    expect(words({ nextReservation: { time: "20:30" } })).toBe("Reserved 20:30");
    expect(words({ ...seated, readyToServe: 2 })).toBe("Seated, 2 ready");
    expect(words({ ...seated, signals: [bill], timingBand: "forgotten" })).toBe(
      "Bill requested, Forgotten",
    );
    expect(words({ condition: "needs_clearing" })).toBe("Needs clearing");
    setLocale("es");
    expect(words({ ...seated, readyToServe: 2 })).toBe("Ocupada, 2 listos");
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

  it("takes a merge's fill words from the member that gave the fill and its count from the one that gave the dot, never summed", () => {
    const booked = table({ id: "a", nextReservation: { time: "21:00" } });
    const free = table({ id: "b" });
    const party = table({ id: "c", ...seated, readyToServe: 2, pendingToServe: 5 });
    const sameParty = table({ id: "d", ...seated, readyToServe: 2, pendingToServe: 5 });
    const members = [free, booked];
    expect(statusWords(members, combinedStatus(members.map(standInStatus)))).toBe("Reserved 21:00");
    const merged = [free, party, sameParty];
    const status = combinedStatus(merged.map(standInStatus));
    expect(statusWords(merged, status)).toBe("Seated, 2 ready");
    expect(pinText(merged, status)).toBe("2 ready");
    const noDot = [free, table({ id: "e", ...seated, pendingToServe: 5 })];
    expect(pinText(noDot, combinedStatus(noDot.map(standInStatus)))).toBe("5 to serve");
  });
});

describe("zones and their tables", () => {
  it("calls a zone planned when any of its tables has a today's row", () => {
    expect(isPlannedZone([table(), table({ id: "t2", today: today() })])).toBe(true);
    expect(isPlannedZone([table(), table({ id: "t2" })])).toBe(false);
    expect(isPlannedZone([])).toBe(false);
  });

  it("maps placed tables, leaving out spares and taken-off ones", () => {
    const t1 = table({ id: "t1", label: "1", today: today() });
    const t2 = table({ id: "t2", label: "2", today: today({ placement: null }) });
    const t3 = table({ id: "t3", label: "3", today: today({ takenOff: true }) });
    expect(mapTables([t1, t2, t3])).toEqual([
      {
        id: "t1",
        label: "1",
        placement,
        fill: "free",
        dot: null,
        joinId: null,
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
    const t6 = table({ id: "t6", label: "6", ...seated, today: today() });
    const shared = { fill: "seated", dot: "ready", joinId: "j1", description: "Seated, 2 ready" };
    expect(mapTables([t5, t4, t6])).toEqual([
      { id: "t5", label: "5", placement, ...shared },
      { id: "t4", label: "4", placement, ...shared },
      {
        id: "t6",
        label: "6",
        placement,
        fill: "seated",
        dot: null,
        joinId: null,
        description: "Seated",
      },
    ]);
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

  it("reads a table's seats for today, a merge's for the merge, and the old capacity without a plan", () => {
    expect(seatsFor(table({ today: today({ seats: 6 }) }))).toBe(6);
    expect(seatsFor(table({ today: today({ seats: 6, joinId: "j1", joinSeats: 10 }) }))).toBe(10);
    expect(seatsFor(table({ capacity: 4 }))).toBe(4);
    expect(seatsFor(table({ capacity: 4, today: today({ seats: null }) }))).toBeNull();
  });
});
