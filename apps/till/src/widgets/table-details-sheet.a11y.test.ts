import { afterEach, beforeEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./table-details-sheet.js";
import type { TillTableDetailsSheet } from "./table-details-sheet.js";
import type { TableState } from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("es-ES"));

function table(over: Partial<TableState> = {}): TableState {
  return {
    id: "t1",
    label: "4",
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

const everything = table({
  state: "open-tab",
  condition: "held",
  hasOpenTab: true,
  pendingToServe: 6,
  readyToServe: 3,
  enRoute: 1,
  pendingDeliveries: 2,
  nextReservation: { time: "20:30" },
  signals: [
    { kind: "take_order" },
    { kind: "long_wait", band: "overdue" },
    { kind: "held_unavailable", groupId: "g1", lineNames: ["Croquetas"] },
    { kind: "bill_requested", requestedAt: "2026-10-10T11:00:00Z" },
  ],
  party: {
    id: "p1",
    revision: 1,
    guestCount: 4,
    state: "open",
    name: "Ana",
    displayName: "Ana",
    mainBillId: null,
    outstanding: "47.50",
    billCount: 2,
    tableIds: ["t1"],
    unsentDrafts: [{ ownerName: "Luis", lineCount: 2 }],
    reminder: { groupId: "g1", dueAt: "2026-10-10T11:00:00Z" },
  },
});

describe.each(["light", "dark"] as const)("till-table-details-sheet a11y (%s theme)", (theme) => {
  const cases: [string, TableState][] = [
    ["a free table", table()],
    ["a seated party with everything", everything],
    ["a table needing clearing", table({ condition: "needs_clearing" })],
  ];
  it.each(cases)("has no violations for %s", async (_name, shown) => {
    const { host } = await mountWidget<TillTableDetailsSheet>(
      "till-table-details-sheet",
      { table: shown, heading: "Terraza 4", now: Date.parse("2026-10-10T12:00:00Z") },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
