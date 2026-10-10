import { page } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-floor-screen.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import type { FloorZone, TableState } from "../api/client.js";

const zones: FloorZone[] = [
  { id: "z1", name: "Comedor", displayOrder: 0, active: true, closesAt: null, closed: false },
  { id: "z2", name: "Terraza", displayOrder: 1, active: true, closesAt: null, closed: false },
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
    today: null,
    signals: [],
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
    today: null,
    signals: [],
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
    today: null,
    signals: [],
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
    today: null,
    signals: [],
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
    today: null,
    signals: [],
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
    today: null,
    signals: [],
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
    today: null,
    signals: [],
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
    today: null,
    signals: [],
    party: null,
  },
];

const party = {
  revision: 4,
  guestCount: 3,
  name: null,
  displayName: "5, 6",
  mainBillId: null,
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

const todayRow = (x: number, placed = true) => ({
  placement: placed ? { x, y: 3, width: 2, height: 2, shape: "round" as const, rotation: 0 } : null,
  seats: 4,
  fixed: false,
  takenOff: false,
  joinId: null,
  joinSeats: null,
});

/** A planned zone: a seated table and a free one on the plan, and a seated one with no place. */
const plannedTables: TableState[] = [
  { ...partyTables[0]!, zoneId: "z1", today: todayRow(2) },
  { ...tables[2]!, today: todayRow(6) },
  { ...partyTables[1]!, id: "t4", label: "4", zoneId: "z1", today: todayRow(0, false) },
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

  it("has no violations with a party's reminder due, on the list and on the map", async () => {
    const now = Date.parse("2026-09-29T20:00:00.000Z");
    const due = partyTables.map((table) =>
      table.party === null
        ? table
        : {
            ...table,
            party: {
              ...table.party,
              reminder: { groupId: "g2", dueAt: new Date(now).toISOString() },
            },
          },
    );
    const list = await mountWidget<TillFloorScreen>(
      "till-floor-screen",
      { zones, tables: due, now },
      theme,
    );
    expect(list.el.shadowRoot!.querySelectorAll("[data-fire-due]").length).toBeGreaterThan(0);
    await expectNoA11yViolations(list.host);
    cleanupWidgets();

    const onMap = due.map((table, index) => ({
      ...table,
      posX: 100 + index * 200,
      posY: 300,
      shape: "round" as const,
      rotation: 0,
    }));
    const map = await mountWidget<TillFloorScreen>(
      "till-floor-screen",
      { zones, tables: onMap, now },
      theme,
    );
    const canvas = map.el.shadowRoot!.querySelector("wt-floor-canvas")!;
    await canvas.updateComplete;
    const token = canvas.shadowRoot!.querySelector<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("wt-table-token")!;
    await token.updateComplete;
    expect(token.shadowRoot!.querySelector("[data-fire-due]")).not.toBeNull();
    await expectNoA11yViolations(map.host);
  });

  it("has no violations with signals side by side and the stations' summary, on the list and on the map", async () => {
    const signalled = partyTables.map((table): TableState =>
      table.party === null
        ? table
        : {
            ...table,
            readyToServe: 1,
            signals: [
              { kind: "take_order" },
              {
                kind: "ready",
                byStation: [
                  { stationId: "bar", stationName: "Bar", count: 3 },
                  { stationId: "kitchen", stationName: "Kitchen", count: 1 },
                ],
              },
              { kind: "long_wait", band: "warm" },
              { kind: "long_wait", band: "overdue" },
              { kind: "held_unavailable", groupId: "g2", lineNames: ["Steak"] },
              { kind: "bill_requested", requestedAt: "2026-09-29T20:00:00.000Z" },
            ],
          },
    );
    const list = await mountWidget<TillFloorScreen>(
      "till-floor-screen",
      { zones, tables: signalled, canOpenStation: true },
      theme,
    );
    expect(list.el.shadowRoot!.querySelectorAll("[data-chip]").length).toBeGreaterThan(5);
    expect(list.el.shadowRoot!.querySelector("[data-open-station]")).not.toBeNull();
    await expectNoA11yViolations(list.host);
    cleanupWidgets();

    const onMap = signalled.map((table, index) => ({
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
    expect(token.shadowRoot!.querySelectorAll("[data-chip]").length).toBeGreaterThan(5);
    expect(map.el.shadowRoot!.querySelector("[data-station-summary]")).not.toBeNull();
    await expectNoA11yViolations(map.host);
  });

  it("has no violations rendering a planned zone's map", async () => {
    const { el, host } = await mountWidget<TillFloorScreen>(
      "till-floor-screen",
      { zones, tables: plannedTables },
      theme,
    );
    const map = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "wt-floor-map",
    )!;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await map.updateComplete;
    expect(map.shadowRoot!.querySelectorAll("[part=table]").length).toBe(2);
    expect(el.shadowRoot!.querySelector("[data-tray-table]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations rendering a planned zone's list", async () => {
    const { el, host } = await mountWidget<TillFloorScreen>(
      "till-floor-screen",
      { zones, tables: plannedTables },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-view-toggle]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll("[data-table]").length).toBe(3);
    await expectNoA11yViolations(host);
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

for (const locale of ["en-GB", "es-ES"]) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      for (const view of ["list", "map"]) {
        it(`closed floor zone ${view} is readable in ${locale}/${theme}/${width}`, async () => {
          const previous = currentLocale();
          try {
            setLocale(locale);
            await page.viewport(width, 900);
            expect(window.innerWidth).toBe(width);
            const { el, host } = await mountWidget<TillFloorScreen>(
              "till-floor-screen",
              {
                zones: [
                  { ...zones[0]!, name: locale === "en-GB" ? "Terrace" : "Terraza", closed: true },
                  zones[1]!,
                ],
                tables: [
                  {
                    ...tables[2]!,
                    ...(view === "map"
                      ? { posX: 250, posY: 400, shape: "round", rotation: 0 }
                      : {}),
                  },
                ],
              },
              theme,
            );
            if (view === "map") {
              el.shadowRoot!.querySelector("wt-floor-canvas")!.dispatchEvent(
                new CustomEvent("wt-open-table", {
                  detail: { tableId: "t3" },
                  bubbles: true,
                  composed: true,
                }),
              );
            } else {
              el.shadowRoot!.querySelector<HTMLElement>("[data-table]")!.click();
            }
            await el.updateComplete;
            const notice = el.shadowRoot!.querySelector<HTMLElement>("[data-zone-closed]");
            expect(notice?.textContent).toContain(
              locale === "en-GB" ? "Terrace is closed" : "Terraza está cerrada",
            );
            expect(notice!.getBoundingClientRect().right).toBeLessThanOrEqual(width);
            expect(el.shadowRoot!.querySelector("till-seat-dialog")).toBeNull();
            await expectNoA11yViolations(host);
            await page.screenshot({
              path: `../__screenshots__/a366-floor-closed/${view}-${locale}-${theme}-${width}.png`,
            });
          } finally {
            setLocale(previous);
            await page.viewport(1280, 768);
          }
        });
      }
    }
  }
}
