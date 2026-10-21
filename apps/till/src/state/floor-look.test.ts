import { afterEach, describe, expect, it } from "vitest";
import type { TableSignal } from "@waitron/shared";
import type { FloorMapCue, FloorMapFill, FloorMapOutline, FloorMapPulse } from "@waitron/ui";
import type { TableParty, TableState, TableToday } from "../api/client.js";
import { en, es } from "../i18n/strings.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { PRECEDENCE } from "./table-precedence.js";
import {
  MAP_PRECEDENCE,
  TAB_KINDS,
  kindWords,
  mapKinds,
  mapLook,
  pinLook,
  readyText,
  reminderClock,
  topTabKind,
} from "./floor-look.js";

const now = Date.parse("2026-09-30T20:00:00.000Z");
const inMinutes = (m: number) => new Date(now + m * 60_000).toISOString();

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
    enRoute: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: null,
    party: party(),
    signals: [],
    ...over,
  };
}

function today(over: Partial<TableToday> = {}): TableToday {
  return {
    placement: null,
    seats: 4,
    fixed: false,
    takenOff: false,
    joinId: null,
    joinSeats: null,
    inJoinedTable: null,
    joined: null,
    splitOffFrom: null,
    zoneRevision: 1,
    ...over,
  };
}

const free = { party: null, state: "free", condition: "free", hasOpenTab: false } as const;
const unsent = { billId: "wo-3", billNumber: 3, ownerName: "Alex", lineCount: 1 };
const wait = (band: "warm" | "overdue" | "forgotten"): TableSignal => ({ kind: "long_wait", band });
const unavailable: TableSignal = { kind: "held_unavailable", groupId: "g1", lineNames: ["Steak"] };
const bill: TableSignal = { kind: "bill_requested", requestedAt: inMinutes(-3) };
const takeOrder: TableSignal = { kind: "take_order" };
const held = (count: number): TableSignal => ({ kind: "held", count });
const due = (m: number | null) =>
  party({ reminder: { groupId: "g2", dueAt: m === null ? null : inMinutes(m) } });

interface Look {
  fill: FloorMapFill;
  outline: FloorMapOutline | null;
  pulse: FloorMapPulse | null;
  cue: FloorMapCue | null;
}

const look = (members: TableState[]): Look => {
  const { fill, outline, pulse, cue } = mapLook(members, now);
  return { fill, outline, pulse, cue };
};

describe("MAP_PRECEDENCE", () => {
  it("is PRECEDENCE with delivery after step and moving after clearing", () => {
    const expected = PRECEDENCE.flatMap((kind) =>
      kind === "step" ? [kind, "delivery"] : kind === "clearing" ? [kind, "moving"] : [kind],
    );
    expect(MAP_PRECEDENCE).toEqual(expected);
  });
});

describe("mapLook", () => {
  it.each<[string, Partial<TableState>, Look]>([
    [
      "forgotten",
      { timingBand: "forgotten" },
      {
        fill: "danger",
        outline: null,
        pulse: "forgotten",
        cue: { icon: "floor-timer", text: en["floor.forgotten"] },
      },
    ],
    [
      "overdue",
      { signals: [wait("overdue")] },
      {
        fill: "calm",
        outline: "overdue",
        pulse: "overdue",
        cue: { icon: "floor-timer", text: en["signal.wait_overdue"] },
      },
    ],
    [
      "unavailable",
      { signals: [unavailable] },
      {
        fill: "warning",
        outline: null,
        pulse: null,
        cue: { icon: "floor-out", text: en["floor.cue_out"] },
      },
    ],
    [
      "fire",
      { party: due(-1) },
      {
        fill: "warning",
        outline: null,
        pulse: "fire",
        cue: { icon: "floor-fire", text: en["floor.cue_fire"] },
      },
    ],
    [
      "bill",
      { signals: [bill] },
      {
        fill: "bill",
        outline: null,
        pulse: null,
        cue: { icon: "floor-bill", text: en["floor.cue_bill"] },
      },
    ],
    [
      "ready",
      { readyToServe: 2 },
      { fill: "ready", outline: null, pulse: null, cue: { icon: "floor-ready", text: "2" } },
    ],
    [
      "step",
      { signals: [takeOrder] },
      {
        fill: "seated",
        outline: null,
        pulse: null,
        cue: { icon: "floor-step", text: en["signal.take_order"] },
      },
    ],
    [
      "delivery",
      { ...free, state: "delivery-pending", pendingDeliveries: 2 },
      {
        fill: "seated",
        outline: null,
        pulse: null,
        cue: { icon: "floor-step", text: `2 ${en["floor.pending_delivery"]}` },
      },
    ],
    [
      "not-sent",
      { party: party({ unsentDrafts: [unsent] }) },
      {
        fill: "seated",
        outline: null,
        pulse: null,
        cue: { icon: "floor-unsent", text: en["floor.unsent_mark"] },
      },
    ],
    [
      "waiting",
      { signals: [wait("warm")] },
      {
        fill: "calm",
        outline: "waiting",
        pulse: null,
        cue: { icon: "floor-timer", text: en["signal.wait_warm"] },
      },
    ],
    [
      "clearing",
      { ...free, condition: "needs_clearing" },
      {
        fill: "plain",
        outline: "clearing",
        pulse: null,
        cue: { icon: "floor-clear", text: en["floor.cue_clear"] },
      },
    ],
    [
      "moving",
      { ...free, today: today({ needsMoving: true }) },
      {
        fill: "free",
        outline: "clearing",
        pulse: null,
        cue: { icon: "floor-move", text: en["floor.cue_move"] },
      },
    ],
    [
      "held, due in 4 minutes",
      { party: due(4), signals: [held(2)] },
      {
        fill: "calm",
        outline: null,
        pulse: null,
        cue: { icon: "floor-held", text: en["floor.cue_minutes"].replace("{m}", "4") },
      },
    ],
    [
      "held, no time",
      { signals: [held(2)] },
      {
        fill: "calm",
        outline: null,
        pulse: null,
        cue: { icon: "floor-held", text: en["floor.held"].replace("{n}", "2") },
      },
    ],
    [
      "nothing-needed",
      {},
      { fill: "calm", outline: null, pulse: null, cue: { icon: "floor-check", text: "" } },
    ],
    [
      "reserved",
      { ...free, nextReservation: { time: "21:00" } },
      { fill: "reserved", outline: null, pulse: null, cue: { icon: null, text: "21:00" } },
    ],
    ["free", { ...free }, { fill: "free", outline: null, pulse: null, cue: null }],
  ])("draws %s as Decision 4's row says", (_, over, expected) => {
    expect(look([table(over)])).toEqual(expected);
  });

  it("names the top kind and every kind", () => {
    const { top, kinds } = mapLook([table({ signals: [bill, wait("warm")] })], now);
    expect(top).toBe("bill");
    expect(kinds).toEqual(["bill", "waiting"]);
    expect(mapLook([], now).top).toBeUndefined();
  });

  it.each<[string, Partial<TableState>, FloorMapFill, FloorMapCue]>([
    [
      "unavailable",
      { signals: [wait("warm"), unavailable] },
      "warning",
      { icon: "floor-out", text: en["floor.cue_out"] },
    ],
    [
      "bill",
      { signals: [wait("warm"), bill] },
      "bill",
      { icon: "floor-bill", text: en["floor.cue_bill"] },
    ],
    [
      "ready",
      { signals: [wait("warm")], readyToServe: 1 },
      "ready",
      { icon: "floor-ready", text: "1" },
    ],
    [
      "step",
      { signals: [wait("warm"), takeOrder] },
      "seated",
      { icon: "floor-step", text: en["signal.take_order"] },
    ],
    [
      "not-sent",
      { signals: [wait("warm")], party: party({ unsentDrafts: [unsent] }) },
      "seated",
      { icon: "floor-unsent", text: en["floor.unsent_mark"] },
    ],
  ])("keeps the waiting outline under a state that draws none: %s", (_, over, fill, cue) => {
    expect(look([table(over)])).toEqual({ fill, outline: "waiting", pulse: null, cue });
  });

  it("Time to fire over a wait draws its own pulse and no waiting outline", () => {
    expect(look([table({ signals: [wait("warm")], party: due(-1) })])).toMatchObject({
      fill: "warning",
      outline: null,
      pulse: "fire",
    });
  });

  it("a forgotten wait draws no waiting outline either", () => {
    expect(
      look([table({ timingBand: "forgotten" }), table({ signals: [wait("warm")] })]),
    ).toMatchObject({
      fill: "danger",
      outline: null,
      pulse: "forgotten",
    });
  });

  it("an overdue table with a bill request is purple with the red outline", () => {
    expect(look([table({ signals: [wait("overdue"), bill] })])).toEqual({
      fill: "bill",
      outline: "overdue",
      pulse: "overdue",
      cue: { icon: "floor-timer", text: en["signal.wait_overdue"] },
    });
  });

  it("a forgotten wait beats ready, and a bill beats ready", () => {
    expect(look([table({ timingBand: "forgotten", readyToServe: 2 })]).fill).toBe("danger");
    expect(look([table({ signals: [bill], readyToServe: 2 })]).fill).toBe("bill");
  });

  it("a merge takes its most urgent member, counts read from one member", () => {
    const calm = table({ id: "a" });
    const forgotten = table({ id: "b", timingBand: "forgotten" });
    expect(look([calm, forgotten])).toMatchObject({ fill: "danger", pulse: "forgotten" });
    expect(mapLook([calm, forgotten], now).description).toBe(
      `${en["floor.status_seated"]}, ${en["floor.forgotten"]}`,
    );
    const both = [table({ id: "a", readyToServe: 2 }), table({ id: "b", readyToServe: 2 })];
    const merged = mapLook(both, now);
    expect(merged.cue).toEqual({ icon: "floor-ready", text: "2" });
    expect(merged.description).toBe(`${en["floor.status_seated"]}, ${readyText(2)}`);
  });

  it("a merge reads the largest ready count, the soonest held countdown and the dishes from one member", () => {
    const members = [
      table({ id: "a", readyToServe: 1, party: due(9), signals: [held(1)] }),
      table({ id: "b", readyToServe: 3, party: due(4), signals: [held(2), unavailable] }),
    ];
    expect(kindWords("ready", members, now)).toBe(readyText(3));
    expect(kindWords("held", members, now)).toBe(
      en["floor.held_fire_in"].replace("{n}", "2").replace("{m}", "4"),
    );
    expect(kindWords("held", [...members].reverse(), now)).toBe(
      en["floor.held_fire_in"].replace("{n}", "2").replace("{m}", "4"),
    );
    expect(kindWords("unavailable", members, now)).toBe(
      en["signal.unavailable"].replace("{items}", "Steak"),
    );
    const heldOnly = [
      table({ id: "a", party: due(9), signals: [held(1)] }),
      table({ id: "b", party: due(4), signals: [held(2)] }),
    ];
    expect(mapLook(heldOnly, now).cue).toEqual({
      icon: "floor-held",
      text: en["floor.cue_minutes"].replace("{m}", "4"),
    });
    const untimed = [
      table({ id: "a", signals: [held(1)] }),
      table({ id: "b", party: due(6), signals: [held(3)] }),
    ];
    expect(mapLook(untimed, now).cue!.text).toBe(en["floor.cue_minutes"].replace("{m}", "6"));
    expect(mapLook([table({ signals: [held(1)] })], now).cue!.text).toBe(en["floor.held_one"]);
  });

  it("reads each count from the member that has it, past signals and members that do not", () => {
    const station: TableSignal = {
      kind: "ready",
      byStation: [{ stationId: "bar", stationName: "Bar", count: 2 }],
    };
    expect(mapLook([table({ signals: [wait("warm"), station] })], now).cue).toEqual({
      icon: "floor-ready",
      text: "2",
    });
    const heldAfterBill = [
      table({ id: "a", ...free }),
      table({ id: "b", party: due(4), signals: [bill, held(2)] }),
    ];
    expect(kindWords("held", heldAfterBill, now)).toBe(
      en["floor.held_fire_in"].replace("{n}", "2").replace("{m}", "4"),
    );
    const untimedHeld = [table({ id: "a" }), table({ id: "b", signals: [bill, held(2)] })];
    expect(mapLook(untimedHeld, now).kinds).toEqual(["bill", "held"]);
    expect(kindWords("held", untimedHeld, now)).toBe(en["floor.held"].replace("{n}", "2"));
    const oneBooked = [
      table({ id: "a", ...free }),
      table({ id: "b", ...free, nextReservation: { time: "21:00" } }),
    ];
    expect(mapLook(oneBooked, now).cue).toEqual({ icon: null, text: "21:00" });
  });

  it("counts ready dishes from the stations, else the dishes on their way", () => {
    const ready: TableSignal = {
      kind: "ready",
      byStation: [
        { stationId: "bar", stationName: "Bar", count: 1 },
        { stationId: "grill", stationName: "Grill", count: 2 },
      ],
    };
    expect(mapLook([table({ signals: [ready] })], now).cue!.text).toBe("3");
    expect(mapLook([table({ enRoute: 4 })], now).cue!.text).toBe("4");
  });

  it("says the table's state in words, Seated first", () => {
    const seated = en["floor.status_seated"];
    expect(mapLook([table({ signals: [bill, wait("warm")] })], now).description).toBe(
      `${seated}, ${en["signal.bill_requested"]}, ${en["signal.wait_warm"]}`,
    );
    expect(mapLook([table(free)], now).description).toBe(en["floor.free"]);
    expect(mapLook([table({ ...free, nextReservation: { time: "21:00" } })], now).description).toBe(
      `${en["floor.reserved"]} 21:00`,
    );
    expect(mapLook([table({ readyToServe: 1 })], now).description).toBe(
      `${seated}, ${readyText(1)}`,
    );
    expect(mapLook([table()], now).description).toBe(`${seated}, ${en["floor.nothing_needed"]}`);
  });

  it("says every kind's words as the card does", () => {
    const words = (kind: Parameters<typeof kindWords>[0], over: Partial<TableState> = {}) =>
      kindWords(kind, [table(over)], now);
    expect(words("forgotten")).toBe(en["floor.forgotten"]);
    expect(words("overdue")).toBe(en["signal.wait_overdue"]);
    expect(words("fire")).toBe(en["floor.fire_due"]);
    expect(words("step")).toBe(en["signal.take_order"]);
    expect(words("delivery", { pendingDeliveries: 2 })).toBe(`2 ${en["floor.pending_delivery"]}`);
    expect(words("not-sent")).toBe(en["floor.unsent_mark"]);
    expect(words("waiting")).toBe(en["signal.wait_warm"]);
    expect(words("clearing")).toBe(en["floor.needs_clearing"]);
    expect(words("moving")).toBe(en["floor.needs_moving"]);
    expect(words("held", { signals: [held(2)] })).toBe(en["floor.held"].replace("{n}", "2"));
    expect(words("nothing-needed")).toBe(en["floor.nothing_needed"]);
    expect(words("free")).toBe(en["floor.free"]);
  });

  it("a seated table with a booking to come keeps its own fill", () => {
    const booked = { nextReservation: { time: "22:00" } };
    const overdue = mapLook([table({ ...booked, signals: [wait("overdue")] })], now);
    expect(overdue).toMatchObject({ fill: "calm", outline: "overdue" });
    expect(overdue.description).toBe(
      `${en["floor.status_seated"]}, ${en["signal.wait_overdue"]}, ${en["floor.reserved"]} 22:00`,
    );
    expect(look([table({ ...booked, signals: [wait("warm")] })])).toMatchObject({
      fill: "calm",
      outline: "waiting",
    });
    expect(look([table({ ...free, ...booked })]).fill).toBe("reserved");
  });

  it("a merge's booking says its soonest time", () => {
    const members = [
      table({ id: "a", ...free, nextReservation: { time: "22:00" } }),
      table({ id: "b", ...free, nextReservation: { time: "21:30" } }),
    ];
    expect(mapLook(members, now).cue).toEqual({ icon: null, text: "21:30" });
  });

  it("a table that needs moving is dashed and says Move, and Needs clearing's words win", () => {
    const moving = table({ ...free, today: today({ needsMoving: true }) });
    const movingLook = mapLook([moving], now);
    expect(movingLook).toMatchObject({
      fill: "free",
      outline: "clearing",
      cue: { icon: "floor-move", text: en["floor.cue_move"] },
      description: en["floor.needs_moving"],
    });
    const clearingToo = table({
      ...free,
      condition: "needs_clearing",
      today: today({ needsMoving: true }),
    });
    expect(mapKinds(clearingToo, now)).toEqual(["clearing"]);
    const merged = mapLook([moving, table({ id: "c", ...free, condition: "needs_clearing" })], now);
    expect(merged.kinds).toEqual(["clearing", "free"]);
    expect(merged.description).toBe(en["floor.needs_clearing"]);
    expect(merged.cue).toEqual({ icon: "floor-clear", text: en["floor.cue_clear"] });
  });

  it("a seated table that needs moving is not also Nothing needed", () => {
    const seatedMoving = table({ today: today({ needsMoving: true }) });
    expect(mapKinds(seatedMoving, now)).toEqual(["moving"]);
    expect(mapLook([seatedMoving], now)).toMatchObject({
      fill: "calm",
      outline: "clearing",
      description: `${en["floor.status_seated"]}, ${en["floor.needs_moving"]}`,
    });
    const merged = mapLook([table({ id: "a" }), table({ id: "b", signals: [bill] })], now);
    expect(merged.kinds).toEqual(["bill"]);
  });

  it("a counter delivery at a table no party holds is seated blue with the bell", () => {
    const delivery = table({ ...free, state: "delivery-pending", pendingDeliveries: 2 });
    expect(mapKinds(delivery, now)).toEqual(["delivery"]);
    expect(mapLook([delivery], now)).toMatchObject({
      fill: "seated",
      cue: { icon: "floor-step", text: "2 to deliver" },
      description: "2 to deliver",
    });
  });

  it("a merge's counter deliveries add up: each table counts only its own", () => {
    const merged = [
      table({ id: "a", ...free, state: "delivery-pending", pendingDeliveries: 2 }),
      table({ id: "b", ...free, state: "delivery-pending", pendingDeliveries: 1 }),
    ];
    const words = `3 ${en["floor.pending_delivery"]}`;
    expect(mapLook(merged, now)).toMatchObject({
      cue: { icon: "floor-step", text: words },
      description: words,
    });
  });

  it("a table with no state at all is plain", () => {
    expect(look([table({ ...free, state: "open-tab" })])).toEqual({
      fill: "plain",
      outline: null,
      pulse: null,
      cue: null,
    });
  });
});

describe("mapLook's description", () => {
  const startLocale = currentLocale();
  afterEach(() => setLocale(startLocale));
  const words = (members: TableState[]) => mapLook(members, now).description;
  const seated = en["floor.status_seated"];
  const moving = today({ needsMoving: true });

  it("says the status in words", () => {
    expect(words([table(free)])).toBe(en["floor.free"]);
    expect(words([table({ ...free, nextReservation: { time: "20:30" } })])).toBe(
      `${en["floor.reserved"]} 20:30`,
    );
    expect(words([table({ readyToServe: 2 })])).toBe(`${seated}, ${readyText(2)}`);
    expect(words([table({ signals: [bill], timingBand: "forgotten" })])).toBe(
      `${seated}, ${en["floor.forgotten"]}, ${en["signal.bill_requested"]}`,
    );
    expect(words([table({ ...free, condition: "needs_clearing" })])).toBe(
      en["floor.needs_clearing"],
    );
    setLocale("es");
    expect(words([table({ readyToServe: 2 })])).toBe(
      `${es["floor.status_seated"]}, ${es["table.flash_ready"].replace("{n}", "2")}`,
    );
  });

  it("says one ready dish in the singular", () => {
    expect(words([table({ readyToServe: 1 })])).toBe(`${seated}, ${en["table.flash_ready_one"]}`);
    setLocale("es");
    expect(words([table({ readyToServe: 1 })])).toBe(
      `${es["floor.status_seated"]}, ${es["table.flash_ready_one"]}`,
    );
  });

  it("takes a merge's words from the member that has them, its count never summed", () => {
    const booked = table({ id: "a", ...free, nextReservation: { time: "21:00" } });
    const freeTable = table({ id: "b", ...free });
    expect(words([freeTable, booked])).toBe(`${en["floor.reserved"]} 21:00`);
    const sameParty = [
      table({ id: "c", readyToServe: 2, pendingToServe: 5 }),
      table({ id: "d", readyToServe: 2, pendingToServe: 5 }),
    ];
    expect(words([freeTable, ...sameParty])).toBe(`${seated}, ${readyText(2)}`);
  });

  it("reads Needs moving, with a booking's words too", () => {
    expect(words([table({ ...free, today: moving })])).toBe(en["floor.needs_moving"]);
    const booked = table({ ...free, today: moving, nextReservation: { time: "20:30" } });
    expect(words([booked])).toBe(`${en["floor.needs_moving"]}, ${en["floor.reserved"]} 20:30`);
    setLocale("es");
    expect(words([table({ ...free, today: moving })])).toBe(es["floor.needs_moving"]);
  });

  it("reads Needs clearing while it also needs moving, alone or in a merge", () => {
    const both = table({ ...free, condition: "needs_clearing", today: moving });
    expect(words([both])).toBe(en["floor.needs_clearing"]);
    const movingTable = table({ id: "a", ...free, today: moving });
    const clearing = table({ id: "c", ...free, condition: "needs_clearing" });
    expect(words([movingTable, clearing])).toBe(en["floor.needs_clearing"]);
    expect(words([clearing, movingTable])).toBe(en["floor.needs_clearing"]);
  });
});

describe("pinLook", () => {
  const startLocale = currentLocale();
  afterEach(() => setLocale(startLocale));
  const pin = (members: TableState[]) => pinLook(members, now);
  const moving = today({ needsMoving: true });

  it("the pin says the top state, with its icon and the map's fill", () => {
    expect(pin([table({ signals: [bill], readyToServe: 2 })])).toEqual({
      fill: "bill",
      icon: "floor-bill",
      text: en["signal.bill_requested"],
    });
    expect(pin([table({ pendingToServe: 3 })])).toEqual({
      fill: "calm",
      icon: "floor-check",
      text: en["floor.nothing_needed"],
    });
    expect(pin([table({ party: due(4), signals: [held(2)] })])).toEqual({
      fill: "calm",
      icon: "floor-held",
      text: en["floor.held"].replace("{n}", "2"),
    });
  });

  it("draws the fill the map draws, for every member order", () => {
    const members = [
      table({ id: "a", signals: [wait("overdue")] }),
      table({ id: "b", signals: [bill] }),
      table({ id: "c", ...free, nextReservation: { time: "22:00" } }),
    ];
    for (const order of [members, [...members].reverse()]) {
      expect(pin(order).fill).toBe(mapLook(order, now).fill);
      expect(pin(order)).toEqual({
        fill: "bill",
        icon: "floor-timer",
        text: en["signal.wait_overdue"],
      });
    }
  });

  it("a free table is free, a booked free one reserved", () => {
    expect(pin([table(free)])).toEqual({ fill: "free", icon: null, text: en["floor.free"] });
    expect(pin([table({ ...free, nextReservation: { time: "20:30" } })])).toEqual({
      fill: "reserved",
      icon: null,
      text: `${en["floor.reserved"]} 20:30`,
    });
  });

  it("a table with no state says nothing", () => {
    expect(pin([table({ ...free, state: "open-tab" })])).toEqual({
      fill: "plain",
      icon: null,
      text: "",
    });
  });

  it("a party is Nothing needed and a delivery seated, even when booked", () => {
    expect(pin([table({ nextReservation: { time: "20:30" } })])).toEqual({
      fill: "calm",
      icon: "floor-check",
      text: en["floor.nothing_needed"],
    });
    expect(pin([table({ ...free, state: "delivery-pending", pendingDeliveries: 2 })])).toEqual({
      fill: "seated",
      icon: "floor-step",
      text: `2 ${en["floor.pending_delivery"]}`,
    });
  });

  it("a bill beats seated, and beats needs clearing", () => {
    expect(pin([table({ signals: [bill] })]).text).toBe(en["signal.bill_requested"]);
    expect(pin([table({ condition: "needs_clearing", signals: [bill] })])).toEqual({
      fill: "bill",
      icon: "floor-bill",
      text: en["signal.bill_requested"],
    });
  });

  it("a forgotten wait beats ready, and an overdue one is said too", () => {
    expect(pin([table({ readyToServe: 2 })])).toEqual({
      fill: "ready",
      icon: "floor-ready",
      text: readyText(2),
    });
    expect(pin([table({ readyToServe: 2, timingBand: "forgotten" })])).toEqual({
      fill: "danger",
      icon: "floor-timer",
      text: en["floor.forgotten"],
    });
    expect(pin([table({ signals: [wait("forgotten")], readyToServe: 2 })]).text).toBe(
      en["floor.forgotten"],
    );
    expect(pin([table({ timingBand: "overdue" })])).toEqual({
      fill: "calm",
      icon: "floor-timer",
      text: en["signal.wait_overdue"],
    });
  });

  it("a merge shows its most urgent member", () => {
    expect(pin([table({ id: "a", readyToServe: 2 }), table({ id: "b", ...free })]).fill).toBe(
      "ready",
    );
    expect(
      pin([table({ id: "a", signals: [bill] }), table({ id: "b", timingBand: "forgotten" })]),
    ).toEqual({ fill: "danger", icon: "floor-timer", text: en["floor.forgotten"] });
  });

  it("says one ready dish in the singular", () => {
    expect(pin([table({ readyToServe: 1 })]).text).toBe(en["table.flash_ready_one"]);
    setLocale("es");
    expect(pin([table({ readyToServe: 1 })]).text).toBe(es["table.flash_ready_one"]);
    expect(pin([table({ readyToServe: 2 })]).text).toBe(
      es["table.flash_ready"].replace("{n}", "2"),
    );
  });

  it("says Nothing needed, not the dishes to serve, and the bill before them", () => {
    expect(pin([table({ readyToServe: 2, pendingToServe: 3 })]).text).toBe(readyText(2));
    expect(pin([table({ pendingToServe: 3 })]).text).toBe(en["floor.nothing_needed"]);
    expect(pin([table()]).text).toBe(en["floor.nothing_needed"]);
    expect(pin([table({ ...free, signals: [bill], pendingToServe: 3 })]).text).toBe(
      en["signal.bill_requested"],
    );
  });

  it("reads a merge's count from one member, never summed, in either order", () => {
    const freeTable = table({ id: "b", ...free });
    const sameParty = [
      table({ id: "c", readyToServe: 2, pendingToServe: 5 }),
      table({ id: "d", readyToServe: 2, pendingToServe: 5 }),
    ];
    expect(pin([freeTable, ...sameParty]).text).toBe(readyText(2));
    expect(pin([...sameParty, freeTable]).text).toBe(readyText(2));
    const fewer = table({ id: "e", readyToServe: 1 });
    expect(pin([fewer, ...sameParty]).text).toBe(readyText(2));
    expect(pin([...sameParty, fewer]).text).toBe(readyText(2));
    expect(pin([freeTable, table({ id: "f", pendingToServe: 5 })]).text).toBe(
      en["floor.nothing_needed"],
    );
  });

  it("a table that needs moving says Move's words over the next fill, and a bill beats it", () => {
    expect(pin([table({ ...free, today: moving })])).toEqual({
      fill: "free",
      icon: "floor-move",
      text: en["floor.needs_moving"],
    });
    expect(pin([table({ ...free, today: moving, nextReservation: { time: "20:30" } })])).toEqual({
      fill: "reserved",
      icon: "floor-move",
      text: en["floor.needs_moving"],
    });
    expect(pin([table({ ...free, condition: "needs_clearing", today: moving })])).toEqual({
      fill: "plain",
      icon: "floor-clear",
      text: en["floor.needs_clearing"],
    });
    const billed = table({ id: "b", signals: [bill] });
    expect(pin([billed, table({ id: "a", ...free, today: moving })])).toEqual({
      fill: "bill",
      icon: "floor-bill",
      text: en["signal.bill_requested"],
    });
  });
});

describe("reminderClock", () => {
  it("changes when a minute to fire changes or a reminder falls due, and not otherwise", () => {
    // Due 20 s past a wall-clock minute, so the countdown's minutes and the clock's change apart.
    const dueAt = now + 4 * 60_000 + 20_000;
    const tables = [
      table({
        id: "a",
        party: party({ reminder: { groupId: "g2", dueAt: new Date(dueAt).toISOString() } }),
      }),
      table({ id: "b", party: due(null) }),
      table({ id: "c", ...free }),
    ];
    const at = (ms: number) => reminderClock(tables, ms);
    const countdownMinute = dueAt - 60_000;
    expect(at(countdownMinute - 1)).not.toBe(at(countdownMinute));
    expect(at(now - 10_000)).toBe(at(now + 10_000));
    expect(at(dueAt - 1)).not.toBe(at(dueAt));
    expect(at(dueAt)).toBe(at(dueAt + 5 * 60_000));
    expect(reminderClock([table({ id: "c", ...free })], now)).toBe("");
  });
});

describe("topTabKind", () => {
  const tabKindOf = (tables: TableState[]) =>
    topTabKind(new Set(tables.flatMap((tbl) => mapKinds(tbl, now))));
  const forgotten = table({ id: "f", timingBand: "forgotten" });
  const overdue = table({ id: "o", signals: [wait("overdue")] });
  const out = table({ id: "u", signals: [unavailable] });
  const fire = table({ id: "x", party: due(-1) });
  const billed = table({ id: "b", signals: [bill] });
  const ready = table({ id: "r", readyToServe: 2 });
  const step = table({ id: "s", signals: [takeOrder] });
  const delivery = table({ id: "d", ...free, state: "delivery-pending", pendingDeliveries: 2 });
  const notSent = table({ id: "n", party: party({ unsentDrafts: [unsent] }) });
  const waiting = table({ id: "w", signals: [wait("warm")] });
  const clearing = table({ id: "c", ...free, condition: "needs_clearing" });
  const moving = table({ id: "m", ...free, today: today({ needsMoving: true }) });
  const heldTable = table({ id: "h", signals: [held(2)], party: due(10) });
  const calm = table({ id: "q" });
  const reserved = table({ id: "v", ...free, nextReservation: { time: "21:30" } });
  const freeTable = table({ id: "e", ...free });

  // Each kind, then every kind after it, so the first wins over all the rest in either order.
  const ranked = [
    forgotten,
    overdue,
    out,
    fire,
    billed,
    ready,
    step,
    delivery,
    notSent,
    waiting,
    clearing,
    moving,
  ];

  it("lists the kinds above Held, which a tab shows", () => {
    expect([...TAB_KINDS]).toEqual([
      "forgotten",
      "overdue",
      "unavailable",
      "fire",
      "bill",
      "ready",
      "step",
      "delivery",
      "not-sent",
      "waiting",
      "clearing",
      "moving",
    ]);
  });

  it.each(ranked.map((tbl, i) => [mapKinds(tbl, now)[0]!, i] as const))(
    "takes %s over every kind below it, across the zone's tables",
    (kind, i) => {
      const rest = [...ranked.slice(i + 1), heldTable, calm, reserved, freeTable];
      expect(tabKindOf([...rest, ranked[i]!])).toBe(kind);
      expect(tabKindOf([ranked[i]!, ...rest])).toBe(kind);
    },
  );

  it("is null for a zone whose best is held, calm, reserved or free, and for no tables", () => {
    expect(tabKindOf([heldTable, calm, reserved, freeTable])).toBeNull();
    expect(tabKindOf([freeTable])).toBeNull();
    expect(topTabKind(new Set())).toBeNull();
  });
});
