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
    condition: "free",
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
    party: null,
  },
  {
    id: "t2",
    label: "2",
    zoneId: "z1",
    capacity: 2,
    state: "delivery-pending",
    condition: "free",
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
    party: null,
  },
  {
    id: "t3",
    label: "3",
    zoneId: "z1",
    capacity: 6,
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
    party: null,
  },
  {
    id: "t9",
    label: "9",
    zoneId: null,
    capacity: null,
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
    party: null,
  },
  {
    id: "t5",
    label: "5",
    zoneId: "z1",
    capacity: 4,
    state: "open-tab",
    condition: "free",
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
    party: null,
  },
  {
    id: "t6",
    label: "6",
    zoneId: "z1",
    capacity: 2,
    state: "open-tab",
    condition: "free",
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
    party: null,
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
    condition: "free",
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
    party: null,
  },
  {
    id: "t4",
    label: "4",
    zoneId: "z1",
    capacity: 2,
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
    party: null,
  },
];

const party = {
  revision: 4,
  guestCount: 3,
  billCount: 2,
  tableIds: ["t5", "t6"],
  unsentDrafts: [],
  reminder: null,
};

/** A party still owing, a paid party, and two tables a finished party left needing clearing. */
const partyTables: TableState[] = [
  {
    ...tables[0]!,
    id: "t5",
    label: "5",
    status: null,
    nextReservation: null,
    condition: "held",
    party: { ...party, id: "v1", state: "open", outstanding: "44.00" },
  },
  {
    ...tables[0]!,
    id: "t7",
    label: "7",
    hasOpenTab: false,
    tabLineCount: undefined,
    tabTotal: undefined,
    status: null,
    nextReservation: null,
    condition: "held",
    party: { ...party, id: "v2", state: "open", outstanding: "0.00", tableIds: ["t7"] },
  },
  ...["t8", "t9"].map((id): TableState => ({
    ...tables[0]!,
    id,
    label: id.slice(1),
    hasOpenTab: false,
    tabId: undefined,
    tabLineCount: undefined,
    tabTotal: undefined,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    status: null,
    nextReservation: null,
    state: "free",
    condition: "needs_clearing",
    party: null,
  })),
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

  it("has no violations rendering seated parties (owing, paid) and tables needing clearing", async () => {
    const { host } = await mountWidget<TillFloorScreen>(
      "till-floor-screen",
      { zones, tables: partyTables },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with unsent orders marked, on the list and on the map", async () => {
    const withUnsent = (table: TableState): TableState =>
      table.party === null
        ? table
        : {
            ...table,
            party: {
              ...table.party,
              unsentDrafts: [
                { ownerName: "Alex", lineCount: 2 },
                { ownerName: "", lineCount: 1 },
              ],
            },
          };
    const marked = partyTables.map(withUnsent);
    const list = await mountWidget<TillFloorScreen>(
      "till-floor-screen",
      { zones, tables: marked },
      theme,
    );
    expect(list.el.shadowRoot!.querySelectorAll("[data-unsent]").length).toBeGreaterThan(0);
    await expectNoA11yViolations(list.host);
    cleanupWidgets();

    const onMap = marked.map((table, index) => ({
      ...table,
      posX: 100 + index * 200,
      posY: 300,
      shape: "round" as const,
      rotation: 0,
    }));
    const map = await mountWidget<TillFloorScreen>(
      "till-floor-screen",
      { zones, tables: onMap },
      theme,
    );
    const canvas = map.el.shadowRoot!.querySelector("wt-floor-canvas")!;
    await canvas.updateComplete;
    const token = canvas.shadowRoot!.querySelector<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("wt-table-token")!;
    await token.updateComplete;
    expect(token.shadowRoot!.querySelector("[data-unsent]")).not.toBeNull();
    await expectNoA11yViolations(map.host);
  });

  it("has no violations with the seat dialog open", async () => {
    const { el, host } = await mountWidget<TillFloorScreen>(
      "till-floor-screen",
      { zones, tables },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>('[data-table="t3"]')!.click();
    await el.updateComplete;
    await el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "till-seat-dialog",
    )!.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations with the map's Mark cleared dialog open", async () => {
    const onMap = partyTables.map((table, index) => ({
      ...table,
      posX: 100 + index * 200,
      posY: 300,
      shape: "round" as const,
      rotation: 0,
    }));
    const { el, host } = await mountWidget<TillFloorScreen>(
      "till-floor-screen",
      { zones, tables: onMap },
      theme,
    );
    el.shadowRoot!.querySelector("wt-floor-canvas")!.dispatchEvent(
      new CustomEvent("wt-open-table", {
        detail: { tableId: "t8" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
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
