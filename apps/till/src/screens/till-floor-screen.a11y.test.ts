import { page } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import { en, es } from "../i18n/strings.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  mountWidget,
  toggleFloorView,
} from "../widgets/test-helpers.js";
import "./till-floor-screen.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import type { FloorZone, TableState } from "../api/client.js";
import type { WtFloorMap } from "@waitron/ui";

const zones: FloorZone[] = [
  {
    id: "z1",
    name: "Comedor",
    displayOrder: 0,
    active: true,
    closesAt: null,
    closed: false,
    hasPlan: false,
    layoutSetName: null,
    layoutDue: null,
    serviceMode: "table_tab",
  },
  {
    id: "z2",
    name: "Terraza",
    displayOrder: 1,
    active: true,
    closesAt: null,
    closed: false,
    hasPlan: false,
    layoutSetName: null,
    layoutDue: null,
    serviceMode: "table_tab",
  },
];

// A spread of occupancy states + a zoneless table, plus one card for EACH of the three service hints
// (t1, t5, t6), so axe sees every card variant in one mount. All UNPLACED, so the LIST view shows.
const tables: TableState[] = [
  {
    id: "t1",
    label: "1",
    zoneId: "z1",
    state: "open-tab",
    condition: "free",
    hasOpenTab: true,
    tabLineCount: 3,
    tabTotal: "47.50",
    pendingDeliveries: 0,
    // All three counts positive — a dispatched line is still ready + unserved — so en camino wins and
    // its filled-primary chip is what axe scans.
    pendingToServe: 2,
    readyToServe: 1,
    enRoute: 1,
    timingBand: "fresh",
    nextReservation: { time: "20:30" },
    today: null,
    signals: [],
    party: null,
  },
  {
    id: "t2",
    label: "2",
    zoneId: "z1",
    state: "delivery-pending",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 1,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "warm",
    nextReservation: null,
    today: null,
    signals: [],
    party: null,
  },
  {
    id: "t3",
    label: "3",
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
  },
  {
    id: "t9",
    label: "9",
    zoneId: null,
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
  },
  {
    id: "t5",
    label: "5",
    zoneId: "z1",
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
    nextReservation: null,
    today: null,
    signals: [],
    party: null,
  },
  {
    id: "t6",
    label: "6",
    zoneId: "z1",
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
    nextReservation: null,
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
    nextReservation: null,
    condition: "held",
    party: {
      ...party,
      kitchenNote: { scope: { partyId: "v1" }, note: null, revision: 0, ownerRevision: 4 },
      id: "v1",
      state: "open",
      outstanding: "44.00",
    },
  },
  {
    ...tables[0]!,
    id: "t7",
    label: "7",
    hasOpenTab: false,
    tabLineCount: undefined,
    tabTotal: undefined,
    nextReservation: null,
    condition: "held",
    party: {
      ...party,
      kitchenNote: { scope: { partyId: "v2" }, note: null, revision: 0, ownerRevision: 4 },
      id: "v2",
      state: "open",
      outstanding: "0.00",
      tableIds: ["t7"],
    },
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
  inJoinedTable: null,
  joined: null,
  splitOffFrom: null,
  zoneRevision: 0,
});

/** A planned zone: a seated table and a free one on the plan, and a seated one with no place. */
const plannedTables: TableState[] = [
  { ...partyTables[0]!, zoneId: "z1", today: todayRow(2) },
  { ...tables[2]!, today: todayRow(6) },
  { ...partyTables[1]!, id: "t4", label: "4", zoneId: "z1", today: todayRow(0, false) },
];

afterEach(cleanupWidgets);

for (const locale of ["en", "es"]) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      it(`A669 floor allergy mark ${locale}/${theme}/${width}`, async () => {
        const previous = currentLocale();
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        try {
          setLocale(locale);
          await page.viewport(width, 900);
          expect(window.innerWidth).toBe(width);
          const { el, host } = await mountWidget<TillFloorScreen>(
            "till-floor-screen",
            {
              zones,
              tables: [
                { ...tables[0]!, hasAllergy: true, today: todayRow(2) },
                { ...tables[2]!, today: todayRow(12) },
              ],
            },
            theme,
          );
          const map = el.shadowRoot!.querySelector<WtFloorMap>("wt-floor-map")!;
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          await map.updateComplete;
          const mark = map.shadowRoot!.querySelector<HTMLElement>('[part="allergy"]')!;
          expect(mark.textContent).toBe("!");
          expect(mark.closest("button")!.getAttribute("aria-label")).toContain(
            (locale === "es" ? es : en)["floor.allergy"],
          );
          const marker = mark.getBoundingClientRect();
          const bounds = map.getBoundingClientRect();
          expect(marker.width).toBeGreaterThan(0);
          expect(marker.left).toBeGreaterThanOrEqual(bounds.left);
          expect(marker.right).toBeLessThanOrEqual(bounds.right);
          expect(marker.top).toBeGreaterThanOrEqual(bounds.top);
          expect(marker.bottom).toBeLessThanOrEqual(bounds.bottom);
          const dot = map.shadowRoot!.querySelector('[part="dot"]')!.getBoundingClientRect();
          expect(marker.right).toBeLessThanOrEqual(dot.left);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
          await expectNoA11yViolations(host);
          await page.screenshot({
            path: `../__screenshots__/a669-floor/${locale}-${theme}-${width}.png`,
          });
        } finally {
          setLocale(previous);
          await page.viewport(viewport.width, viewport.height);
        }
      });
    }
  }
}

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

  it("has no violations with unsent orders marked, on the list", async () => {
    const withUnsent = (table: TableState): TableState =>
      table.party === null
        ? table
        : {
            ...table,
            party: {
              ...table.party,
              unsentDrafts: [
                { billId: "bill-1", billNumber: 1, ownerName: "Alex", lineCount: 2 },
                { billId: "bill-2", billNumber: 2, ownerName: "", lineCount: 1 },
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
  });

  it("has no violations with a party's reminder due, on the list", async () => {
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
  });

  it("has no violations with held dishes counting down and a reminder due, on the list", async () => {
    const now = Date.parse("2026-09-29T20:00:00.000Z");
    const marked = partyTables.map((table, index): TableState =>
      table.party === null
        ? table
        : {
            ...table,
            signals: [{ kind: "held", count: 2 }],
            party: {
              ...table.party,
              reminder: {
                groupId: "g2",
                dueAt: new Date(index === 0 ? now + 240_000 : now).toISOString(),
              },
            },
          },
    );
    const list = await mountWidget<TillFloorScreen>(
      "till-floor-screen",
      { zones, tables: marked, now },
      theme,
    );
    expect(list.el.shadowRoot!.querySelector('[data-chip="held"]')).not.toBeNull();
    expect(list.el.shadowRoot!.querySelector("[data-fire-due] wt-icon[name=fire]")).not.toBeNull();
    await expectNoA11yViolations(list.host);
  });

  it("has no violations with signals side by side and the stations' summary, on the list", async () => {
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

  it("has no violations with a refusal said on the floor", async () => {
    const merged = { ...todayRow(2), joinId: "j1" };
    const { el, host } = await mountWidget<TillFloorScreen>(
      "till-floor-screen",
      {
        zones,
        tables: [
          { ...tables[2]!, id: "t1", label: "1", today: merged },
          { ...tables[2]!, today: { ...merged, placement: { ...merged.placement!, x: 4 } } },
          { ...tables[2]!, id: "t4", label: "4", today: todayRow(10) },
        ],
      },
      theme,
    );
    el.shadowRoot!.querySelector("wt-floor-map")!.dispatchEvent(
      new CustomEvent("wt-table-drag-end", {
        detail: { tableId: "t1", x: 9, y: 3, targetId: "t4" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-floor-refusal]")?.textContent).toContain(
      "Drag the other table onto it",
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations rendering a planned zone's list", async () => {
    const { el, host } = await mountWidget<TillFloorScreen>(
      "till-floor-screen",
      { zones, tables: plannedTables },
      theme,
    );
    await toggleFloorView(el);
    expect(el.shadowRoot!.querySelectorAll("[data-table]").length).toBe(3);
    await expectNoA11yViolations(host);
  });

  it.each(["map", "list"] as const)(
    "has no violations with the layout banner over a planned zone's %s",
    async (view) => {
      const offered: FloorZone = {
        ...zones[0]!,
        hasPlan: true,
        layoutSetName: "Lunch",
        layoutDue: { setId: "set-dinner", revision: 3, periodName: "Dinner" },
      };
      const { el, host } = await mountWidget<TillFloorScreen>(
        "till-floor-screen",
        { zones: [offered, zones[1]!], tables: plannedTables, canChangeToday: true },
        theme,
      );
      if (view === "list") {
        await toggleFloorView(el);
      }
      expect(el.shadowRoot!.querySelector("[data-layout-due] [data-update-layout]")).not.toBeNull();
      await expectNoA11yViolations(host);
    },
  );

  it("has no violations with the needs-moving question open", async () => {
    const needing: TableState[] = [{ ...tables[2]!, today: { ...todayRow(6), needsMoving: true } }];
    const { el, host } = await mountWidget<TillFloorScreen>(
      "till-floor-screen",
      { zones, tables: needing, canChangeToday: true },
      theme,
    );
    el.shadowRoot!.querySelector("wt-floor-map")!.dispatchEvent(
      new CustomEvent("wt-table-tap", {
        detail: { tableId: needing[0]!.id },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "[data-move-dialog]",
    )!;
    await dialog.updateComplete;
    expect(dialog.querySelector("[data-leave-here]")).not.toBeNull();
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
                    ...(view === "map" ? { today: todayRow(2) } : {}),
                  },
                ],
              },
              theme,
            );
            if (view === "map") {
              el.shadowRoot!.querySelector("wt-floor-map")!.dispatchEvent(
                new CustomEvent("wt-table-tap", {
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

for (const locale of ["en-GB", "es-ES"]) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      for (const view of ["list", "map"]) {
        it(`no-seating floor zone ${view} is readable in ${locale}/${theme}/${width}`, async () => {
          const previous = currentLocale();
          try {
            setLocale(locale);
            await page.viewport(width, 900);
            expect(window.innerWidth).toBe(width);
            const { el, host } = await mountWidget<TillFloorScreen>(
              "till-floor-screen",
              {
                zones: [
                  {
                    ...zones[0]!,
                    name: locale === "en-GB" ? "Bar" : "Barra",
                    serviceMode: "prepay",
                  },
                  zones[1]!,
                ],
                tables: [
                  {
                    ...tables[2]!,
                    ...(view === "map" ? { today: todayRow(2) } : {}),
                  },
                ],
              },
              theme,
            );
            if (view === "map") {
              el.shadowRoot!.querySelector("wt-floor-map")!.dispatchEvent(
                new CustomEvent("wt-table-tap", {
                  detail: { tableId: "t3" },
                  bubbles: true,
                  composed: true,
                }),
              );
            } else {
              el.shadowRoot!.querySelector<HTMLElement>("[data-table]")!.click();
            }
            await el.updateComplete;
            const notice = el.shadowRoot!.querySelector<HTMLElement>("[data-zone-no-seating]");
            expect(notice?.textContent).toContain(
              locale === "en-GB"
                ? "That table is in an area that does not seat guests. Choose another table"
                : "Esa mesa está en una zona sin servicio de mesa. Elige otra mesa",
            );
            expect(notice!.getBoundingClientRect().right).toBeLessThanOrEqual(width);
            expect(el.shadowRoot!.querySelector("till-seat-dialog")).toBeNull();
            await expectNoA11yViolations(host);
            await page.screenshot({
              path: `../__screenshots__/a667-floor-no-seating/${view}-${locale}-${theme}-${width}.png`,
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

for (const theme of ["light", "dark"] as const) {
  for (const width of [390, 1280]) {
    for (const canChangeToday of [true, false]) {
      it(`has no violations with the zone menu open in ${theme}/${width}, ${canChangeToday ? "able" : "unable"} to change today's plan`, async () => {
        try {
          await page.viewport(width, 844);
          expect(window.innerWidth).toBe(width);
          const { el, host } = await mountWidget<TillFloorScreen>(
            "till-floor-screen",
            {
              zones: [{ ...zones[0]!, hasPlan: true, layoutSetName: "Cena" }, zones[1]!],
              tables: plannedTables,
              canChangeToday,
            },
            theme,
          );
          const zoneMenu = el.shadowRoot!.querySelector("till-floor-zone-menu");
          if (width === 1280 && !canChangeToday) {
            expect(zoneMenu).toBeNull();
            await expectNoA11yViolations(host);
            return;
          }
          await zoneMenu!.updateComplete;
          const menu =
            zoneMenu!.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
              "wt-row-actions",
            )!;
          menu.show();
          await menu.updateComplete;
          expect(menu.querySelector("[data-menu-heading]") !== null).toBe(
            width === 390 && canChangeToday,
          );
          await expectNoA11yViolations(host);
        } finally {
          await page.viewport(1280, 768);
        }
      });
    }
  }
}
