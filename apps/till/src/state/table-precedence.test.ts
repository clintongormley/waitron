import { describe, expect, it } from "vitest";
import type { TableSignal } from "@waitron/shared";
import type { TableParty, TableState } from "../api/client.js";
import {
  PRECEDENCE,
  byPrecedence,
  lateBand,
  tableStates,
  type TableStateKind,
} from "./table-precedence.js";

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

const free = { party: null, state: "free", condition: "free", hasOpenTab: false } as const;
const ready: TableSignal = {
  kind: "ready",
  byStation: [{ stationId: "bar", stationName: "Bar", count: 1 }],
};
const unsent = { billId: "wo-3", billNumber: 3, ownerName: "Alex", lineCount: 1 };

describe("PRECEDENCE", () => {
  it("is A757 §4's order for the states built today", () => {
    expect(PRECEDENCE).toEqual([
      "forgotten",
      "overdue",
      "unavailable",
      "fire",
      "bill",
      "ready",
      "step",
      "not-sent",
      "waiting",
      "clearing",
      "held",
      "nothing-needed",
      "reserved",
      "free",
    ]);
  });
});

describe("tableStates", () => {
  const alone: [string, Partial<TableState>, TableStateKind[]][] = [
    ["forgotten", { timingBand: "forgotten" }, ["forgotten"]],
    ["overdue", { timingBand: "overdue" }, ["overdue"]],
    [
      "unavailable",
      { signals: [{ kind: "held_unavailable", groupId: "g2", lineNames: ["Flan"] }] },
      ["unavailable"],
    ],
    ["fire", { party: party({ reminder: { groupId: "g2", dueAt: inMinutes(-1) } }) }, ["fire"]],
    ["bill", { signals: [{ kind: "bill_requested", requestedAt: inMinutes(-1) }] }, ["bill"]],
    ["ready", { signals: [ready] }, ["ready"]],
    ["step", { signals: [{ kind: "take_order" }] }, ["step"]],
    ["not-sent", { party: party({ unsentDrafts: [unsent] }) }, ["not-sent"]],
    ["waiting", { timingBand: "warm" }, ["waiting"]],
    ["clearing", { party: null, state: "free", condition: "needs_clearing" }, ["clearing"]],
    ["held", { signals: [{ kind: "held", count: 2 }] }, ["held"]],
    ["nothing-needed", {}, ["nothing-needed"]],
    ["reserved", { ...free, nextReservation: { time: "21:00" } }, ["reserved", "free"]],
    ["free", free, ["free"]],
    ["no kind for a counter delivery", { ...free, state: "delivery-pending" }, []],
  ];

  it.each(alone)("puts a table in %s from its own fact alone", (_, over, kinds) => {
    expect(tableStates(table(over), now)).toEqual(kinds);
  });

  it("ready counts a ready signal or count, ignoring retired dispatch", () => {
    expect(tableStates(table({ signals: [ready] }), now)).toEqual(["ready"]);
    expect(tableStates(table({ readyToServe: 2 }), now)).toEqual(["ready"]);
    expect(tableStates(table({ enRoute: 1 }), now)).toEqual(["nothing-needed"]);
  });

  it("held is calm while it counts down and gives way to Time to fire when due", () => {
    const held: TableSignal[] = [{ kind: "held", count: 2 }];
    expect(
      tableStates(
        table({
          signals: held,
          party: party({ reminder: { groupId: "g2", dueAt: inMinutes(4) } }),
        }),
        now,
      ),
    ).toEqual(["held"]);
    expect(
      tableStates(
        table({
          signals: held,
          party: party({ reminder: { groupId: "g2", dueAt: inMinutes(0) } }),
        }),
        now,
      ),
    ).toEqual(["fire"]);
  });

  it("a reminder with no time, or none, is not due", () => {
    expect(
      tableStates(table({ party: party({ reminder: { groupId: "g2", dueAt: null } }) }), now),
    ).toEqual(["nothing-needed"]);
    expect(tableStates(table({ party: party({ reminder: null }) }), now)).toEqual([
      "nothing-needed",
    ]);
  });

  it("lists every state at once in §4's order", () => {
    const busy = table({
      timingBand: "forgotten",
      nextReservation: { time: "21:00" },
      party: party({
        reminder: { groupId: "g2", dueAt: inMinutes(-2) },
        unsentDrafts: [unsent],
      }),
      signals: [
        { kind: "take_order" },
        { kind: "held", count: 2 },
        ready,
        { kind: "bill_requested", requestedAt: inMinutes(-1) },
        { kind: "held_unavailable", groupId: "g2", lineNames: ["Flan"] },
      ],
    });
    expect(tableStates(busy, now)).toEqual([
      "forgotten",
      "unavailable",
      "fire",
      "bill",
      "ready",
      "step",
      "not-sent",
      "reserved",
    ]);
    expect(tableStates(busy, now)[0]).toBe("forgotten");
  });

  it("orders T4 as the owner's Q34 example does", () => {
    const t4 = table({
      signals: [
        ready,
        { kind: "bill_requested", requestedAt: inMinutes(-1) },
        { kind: "take_order" },
      ],
    });
    expect(tableStates(t4, now)).toEqual(["bill", "ready", "step"]);
    expect(tableStates(t4, now)[0]).toBe("bill");
  });

  it("is empty for a table in no state", () => {
    expect(tableStates(table({ ...free, state: "delivery-pending" }), now)).toEqual([]);
  });
});

describe("lateBand", () => {
  it("reads the worse of the two waiting reckonings", () => {
    expect(
      lateBand(table({ timingBand: "fresh", signals: [{ kind: "long_wait", band: "overdue" }] })),
    ).toBe("overdue");
    expect(
      lateBand(table({ timingBand: "forgotten", signals: [{ kind: "long_wait", band: "warm" }] })),
    ).toBe("forgotten");
    expect(lateBand(table())).toBe("fresh");
    expect(tableStates(table({ signals: [{ kind: "long_wait", band: "overdue" }] }), now)).toEqual([
      "overdue",
    ]);
  });
});

describe("byPrecedence", () => {
  it("keeps the order of equal kinds and puts undefined last", () => {
    const items: [string, TableStateKind | undefined][] = [
      ["n to serve", undefined],
      ["reserved", "reserved"],
      ["bar ready", "ready"],
      ["other", undefined],
      ["forgotten", "forgotten"],
      ["kitchen ready", "ready"],
    ];
    expect(byPrecedence(items, ([, kind]) => kind).map(([name]) => name)).toEqual([
      "forgotten",
      "bar ready",
      "kitchen ready",
      "reserved",
      "n to serve",
      "other",
    ]);
    expect(items[0]?.[0]).toBe("n to serve");
  });
});
