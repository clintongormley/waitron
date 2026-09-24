import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-floor-screen.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import type { FloorZone, TableState } from "../api/client.js";

const zones: FloorZone[] = [
  { id: "z1", name: "Comedor", displayOrder: 0, active: true },
  { id: "z2", name: "Terraza", displayOrder: 1, active: true },
];

// A spread of occupancy states + a zoneless table, plus one card for EACH of the three service hints
// (t1, t5, t6), so axe sees every card variant in one mount. All UNPLACED, so the LIST view shows.
const tables: TableState[] = [
  {
    id: "t1",
    label: "1",
    zoneId: "z1",
    capacity: 4,
    state: "open-tab",
    hasOpenTab: true,
    tabId: "wo-1",
    tabLineCount: 3,
    tabTotal: "47.50",
    pendingDeliveries: 0,
    // All three counts positive — a dispatched line is still ready + unserved — so en camino wins and
    // its filled-primary chip is what axe scans (alongside the status swatch on this card).
    pendingToServe: 2,
    readyToServe: 1,
    enRoute: 1,
    timingBand: "fresh",
    status: { id: "s1", label: "Reservada", color: "#8b5cf6" },
    nextReservation: { time: "20:30" },
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
  },
  {
    id: "t2",
    label: "2",
    zoneId: "z1",
    capacity: 2,
    state: "delivery-pending",
    hasOpenTab: false,
    pendingDeliveries: 1,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "warm",
    status: null,
    nextReservation: null,
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
  },
  {
    id: "t3",
    label: "3",
    zoneId: "z1",
    capacity: 6,
    state: "free",
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
  },
  {
    id: "t9",
    label: "9",
    zoneId: null,
    capacity: null,
    state: "free",
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
  },
  {
    id: "t5",
    label: "5",
    zoneId: "z1",
    capacity: 4,
    state: "open-tab",
    hasOpenTab: true,
    tabId: "wo-5",
    tabLineCount: 2,
    tabTotal: "18.00",
    pendingDeliveries: 0,
    pendingToServe: 2,
    readyToServe: 2,
    enRoute: 0,
    timingBand: "overdue",
    status: null,
    nextReservation: null,
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
  },
  {
    id: "t6",
    label: "6",
    zoneId: "z1",
    capacity: 2,
    state: "open-tab",
    hasOpenTab: true,
    tabId: "wo-6",
    tabLineCount: 3,
    tabTotal: "25.00",
    pendingDeliveries: 0,
    pendingToServe: 3,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "forgotten",
    status: null,
    nextReservation: null,
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
  },
];

// One PLACED table (on the canvas) and one UNPLACED (the tray).
const placedTables: TableState[] = [
  {
    id: "t1",
    label: "1",
    zoneId: "z1",
    capacity: 4,
    state: "open-tab",
    hasOpenTab: true,
    tabId: "wo-1",
    tabLineCount: 3,
    tabTotal: "47.50",
    pendingDeliveries: 0,
    pendingToServe: 2,
    readyToServe: 1,
    enRoute: 0,
    timingBand: "fresh",
    status: { id: "s1", label: "Reservada", color: "#8b5cf6" },
    nextReservation: { time: "20:30" },
    posX: 250,
    posY: 400,
    shape: "round",
    rotation: 0,
  },
  {
    id: "t4",
    label: "4",
    zoneId: "z1",
    capacity: 2,
    state: "free",
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
  },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-floor-screen a11y (%s theme)", (theme) => {
  it("has no violations rendering the LIST view (occupancy cards grouped by zone)", async () => {
    const { host } = await mountWidget<TillFloorScreen>(
      "till-floor-screen",
      { zones, tables },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations rendering the MAP view with the tray + Editar plano + the Spanish edit inspector", async () => {
    const { el, host } = await mountWidget<TillFloorScreen>(
      "till-floor-screen",
      { zones, tables: placedTables, canEdit: true },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-edit-toggle]")!.click();
    await el.updateComplete;
    // SELECT a table on the canvas so its edit inspector is in the tree for axe; the inspector needs the
    // canvas's own `selectedId`, which its `#onTap` sets.
    const canvas = el.shadowRoot!.querySelector("wt-floor-canvas") as HTMLElement & {
      shadowRoot: ShadowRoot;
      updateComplete: Promise<unknown>;
    };
    canvas.shadowRoot.querySelector<HTMLElement>("[data-table]")!.click();
    await canvas.updateComplete;
    await el.updateComplete;
    expect(canvas.shadowRoot.querySelector(".inspector")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
