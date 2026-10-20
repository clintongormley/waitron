import { describe, expect, it } from "vitest";
import type { TableSignal } from "@waitron/shared";
import type { FloorMapCue, FloorMapFill, FloorMapOutline, FloorMapPulse } from "@waitron/ui";
import type { TableParty, TableState, TableToday } from "../api/client.js";
import { en } from "../i18n/strings.js";
import { PRECEDENCE } from "./table-precedence.js";
import {
  MAP_PRECEDENCE,
  kindWords,
  mapKinds,
  mapLook,
  readyText,
  reminderClock,
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

  it("a table with no state at all is plain", () => {
    expect(look([table({ ...free, state: "open-tab" })])).toEqual({
      fill: "plain",
      outline: null,
      pulse: null,
      cue: null,
    });
  });
});

describe("reminderClock", () => {
  it("changes when a minute to fire changes or a reminder falls due, and not otherwise", () => {
    const tables = [
      table({ id: "a", party: due(4) }),
      table({ id: "b", party: due(null) }),
      table({ id: "c", ...free }),
    ];
    const at = (offsetMs: number) => reminderClock(tables, now + offsetMs);
    expect(at(0)).toBe(at(30_000));
    expect(at(0)).not.toBe(at(61_000));
    expect(at(4 * 60_000)).toBe(at(9 * 60_000));
    expect(at(4 * 60_000 - 1)).not.toBe(at(4 * 60_000));
    expect(reminderClock([table({ id: "c", ...free })], now)).toBe("");
  });
});
