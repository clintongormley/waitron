import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./till-floor-screen.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import type { FloorZone, TableParty, TableState } from "../api/client.js";
import type { TableSignal } from "@waitron/shared";

const now = Date.parse("2026-09-30T20:00:00.000Z");

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
    displayName: "Mesa 2",
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
    label: "Mesa 2",
    zoneId: "z1",
    state: "open-tab",
    condition: "held",
    hasOpenTab: true,
    tabLineCount: 2,
    tabTotal: "20.00",
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: null,
    party: party(),
    signals: [],
    ...over,
  };
}

const ready = (...byStation: [string, string, number][]): TableSignal => ({
  kind: "ready",
  byStation: byStation.map(([stationId, stationName, count]) => ({
    stationId,
    stationName,
    count,
  })),
});

const zone = (id: string, name: string, displayOrder: number): FloorZone => ({
  id,
  name,
  displayOrder,
  active: true,
  closesAt: null,
  closed: false,
  hasPlan: false,
  layoutSetName: null,
  layoutDue: null,
  serviceMode: "table_tab",
});

const mesa2 = (count = 3) => table({ signals: [ready(["bar", "Bar", count])] });
const mesa8 = (
  over: Partial<TableState> = {},
  stations: [string, string, number][] = [
    ["bar", "Bar", 1],
    ["kitchen", "Kitchen", 2],
  ],
) =>
  table({
    id: "t8",
    label: "Mesa 8",
    party: party({ id: "v8", displayName: "Mesa 8", tableIds: ["t8"] }),
    signals: [ready(...stations)],
    ...over,
  });

async function mountFloor(
  tables: TableState[],
  over: Partial<TillFloorScreen> = {},
): Promise<TillFloorScreen> {
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [zone("z1", "Comedor", 0)],
    tables,
    now,
    handheld: true,
    ...over,
  });
  return el;
}

const bar = (el: TillFloorScreen) => el.shadowRoot!.querySelector<HTMLElement>("[data-ready-bar]");
const entries = (el: TillFloorScreen) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-ready-table]")].map((entry) =>
    entry.textContent!.replace(/\s+/g, " ").trim(),
  );
const openButton = (el: TillFloorScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-ready-open]")!;
const opened = (el: TillFloorScreen) => {
  const seen: unknown[] = [];
  el.addEventListener("open-table", (event) => seen.push((event as CustomEvent).detail));
  return seen;
};
/** A button's accessible name: its `aria-label`, else its text. */
const nameOf = (button: HTMLElement) =>
  button.getAttribute("aria-label") ?? button.textContent!.replace(/\s+/g, " ").trim();

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe("till-floor-screen: the Ready bar", () => {
  it("a handheld lists the tables with food ready, in place of the summary", async () => {
    const el = await mountFloor([mesa2(), mesa8()]);
    expect(entries(el)).toEqual(["Mesa 2 · 3", "Mesa 8 · 3"]);
    expect(openButton(el).textContent!.trim()).toBe("Open ›");
    expect(el.shadowRoot!.querySelector("[data-station-summary]")).toBeNull();
    const section = bar(el)!;
    expect(section.tagName).toBe("SECTION");
    const title = el.shadowRoot!.getElementById(section.getAttribute("aria-labelledby")!)!;
    expect(title.textContent!.trim()).toBe("Ready");
    expect(section.querySelector('wt-icon[name="floor-ready"]')).not.toBeNull();
    expect(section.querySelector("wt-help-tooltip")).not.toBeNull();
  });

  it("the bar lists only the zones the Floor shows", async () => {
    const tables = [mesa2(), mesa8({ zoneId: "z2" })];
    const one = await mountFloor(tables);
    expect(entries(one)).toEqual(["Mesa 2 · 3"]);
    cleanupWidgets();
    const both = await mountFloor(tables, {
      zones: [zone("z1", "Comedor", 0), zone("z2", "Terraza", 1)],
    });
    expect(entries(both)).toEqual(["Mesa 2 · 3", "Mesa 8 · 3"]);
  });

  it("tapping a table opens it, and Open opens the first", async () => {
    const el = await mountFloor([mesa2(), mesa8()]);
    const seen = opened(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-ready-table="t8"]')!.click();
    expect(seen).toEqual([{ tableId: "t8", seated: true }]);
    seen.length = 0;
    openButton(el).click();
    expect(seen).toEqual([{ tableId: "t2", seated: true }]);
    expect(openButton(el).getAttribute("aria-label")).toBe("Open Mesa 2");
  });

  it("draws nothing while nothing is ready", async () => {
    const el = await mountFloor([table()]);
    expect(bar(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-ready-open]")).toBeNull();
  });

  it("a till keeps the summary, titled Ready, and draws no bar", async () => {
    const el = await mountFloor([mesa2(), mesa8()], { handheld: false });
    expect(el.shadowRoot!.querySelector("[data-station-summary] h2")!.textContent!.trim()).toBe(
      "Ready",
    );
    expect(bar(el)).toBeNull();
  });

  it("says it in Spanish, one dish or several", async () => {
    setLocale("es");
    const el = await mountFloor([mesa2(1), mesa8({}, [["bar", "Barra", 3]])]);
    const section = bar(el)!;
    const title = el.shadowRoot!.getElementById(section.getAttribute("aria-labelledby")!)!;
    expect(title.textContent!.trim()).toBe("Listo");
    expect(entries(el)).toEqual(["Mesa 2 · 1", "Mesa 8 · 3"]);
    expect(openButton(el).textContent!.trim()).toBe("Abrir ›");
    expect(openButton(el).getAttribute("aria-label")).toBe("Abrir Mesa 2");
    const tableButtons = [...section.querySelectorAll<HTMLElement>("[data-ready-table]")];
    for (const button of tableButtons) {
      expect(button.hasAttribute("aria-label")).toBe(false);
      expect(nameOf(button)).toBe(button.textContent!.replace(/\s+/g, " ").trim());
    }
    for (const button of [...tableButtons, openButton(el)]) {
      expect(nameOf(button)).not.toMatch(/listos/i);
    }
  });
});
