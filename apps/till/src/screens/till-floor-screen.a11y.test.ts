import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-floor-screen.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import type { FloorZone, TableState } from "../api/client.js";

const zones: FloorZone[] = [
  { id: "z1", name: "Comedor", displayOrder: 0, active: true },
  { id: "z2", name: "Terraza", displayOrder: 1, active: true },
];

// A spread of occupancy states + a zoneless table, plus one card for EACH of the three floor service
// hints — en camino (t1), listos (t5), por servir (t6) — so axe sees every card variant, all three
// hint-badge styles (the floor renders only the most-advanced per card, KDS-3 §3c) and the manual-status
// swatch in the one mount. All UNPLACED, so the screen defaults to the LIST view here (the map view is
// exercised by its own suite below).
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
    status: { id: "s1", label: "Reservada", color: "#8b5cf6" },
    // Carries a reservation too, so the list card's "Reservada HH:MM" chip is axe-scanned in both themes.
    nextReservation: { time: "20:30", partySize: 4, contactName: "Ana" },
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
    status: null,
    nextReservation: null,
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
  },
  {
    // Nothing dispatched → listos wins (the success-bordered chip).
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
    status: null,
    nextReservation: null,
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
  },
  {
    // Nothing ready or dispatched → por servir (the neutral chip).
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
    status: null,
    nextReservation: null,
    posX: null,
    posY: null,
    shape: null,
    rotation: null,
  },
];

// The MAP view (FP-2): the first zone's table is PLACED (drawn on the shared canvas), a second is
// UNPLACED (the tray). Mounted with `canEdit` so the manager-only "Editar plano" toggle also renders,
// and `editing` is entered by the suite so axe sees the canvas's edit inspector chrome too.
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
    status: { id: "s1", label: "Reservada", color: "#8b5cf6" },
    // Carries a reservation too, so the map token's "Reservada HH:MM" chip is axe-scanned in both themes.
    nextReservation: { time: "20:30", partySize: 4, contactName: "Ana" },
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
    // Enter edit mode so the canvas is `.editable`…
    el.shadowRoot!.querySelector<HTMLElement>("[data-edit-toggle]")!.click();
    await el.updateComplete;
    // …then SELECT a table on the canvas so its edit inspector (shape palette / zone / rotate / remove),
    // rendered with the till's SPANISH copy, is in the tree for axe. The inspector needs the canvas's
    // own `selectedId`, which its `#onTap` sets — so click a `[data-table]` inside the canvas's shadow
    // root (mirrors wt-floor-canvas.a11y.test.ts's edit-mode case).
    const canvas = el.shadowRoot!.querySelector("wt-floor-canvas") as HTMLElement & {
      shadowRoot: ShadowRoot;
      updateComplete: Promise<unknown>;
    };
    canvas.shadowRoot.querySelector<HTMLElement>("[data-table]")!.click();
    await canvas.updateComplete;
    await el.updateComplete;
    // The inspector is present (so axe is scanning the real Spanish chrome, not an empty canvas).
    expect(canvas.shadowRoot.querySelector(".inspector")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
