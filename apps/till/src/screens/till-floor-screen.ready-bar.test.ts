import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import {
  cleanupWidgets,
  mountWidget,
  pageAt,
  resetPage,
  type Theme,
} from "../widgets/test-helpers.js";
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

/** `n` tables, the first `readyCount` of them with food ready, named Mesa 1 to Mesa n. */
const numbered = (n: number, readyCount: number): TableState[] =>
  Array.from({ length: n }, (_, i) =>
    table({
      id: `t${i + 1}`,
      label: `Mesa ${i + 1}`,
      party: party({ id: `v${i + 1}`, displayName: `Mesa ${i + 1}`, tableIds: [`t${i + 1}`] }),
      signals: i < readyCount ? [ready(["bar", "Bar", 2])] : [],
    }),
  );

interface InShell {
  floor: TillFloorScreen;
  area: HTMLElement;
  overlay: HTMLElement;
}

/**
 * The floor inside a copy of the shell's region (`till-shell.ts` `.region`, `.body`, `.drill`): a
 * positioned column of a fixed height whose scrolling area holds the floor, and an overlay over it,
 * hidden until a case opens it.
 */
async function inShell(tables: TableState[], theme: Theme = "light"): Promise<InShell> {
  const { el: region } = await mountWidget<HTMLDivElement>("div", {}, theme);
  region.style.cssText = "position: relative; display: flex; flex-direction: column; height: 600px";
  const area = document.createElement("div");
  area.style.cssText = "flex: 1; min-height: 0; overflow: auto";
  const overlay = document.createElement("div");
  overlay.hidden = true;
  // A colour nothing in the bar is painted with, so the painted check cannot pass by accident.
  overlay.style.cssText =
    "position: absolute; inset: 0; overflow: auto; background: var(--wt-color-warning)";
  const floor = document.createElement("till-floor-screen") as TillFloorScreen;
  Object.assign(floor, { zones: [zone("z1", "Comedor", 0)], tables, now, handheld: true });
  area.append(floor);
  region.append(area, overlay);
  await floor.updateComplete;
  return { floor, area, overlay };
}

const rgb = (colour: string) => colour.match(/\d+/g)!.slice(0, 3).map(Number);
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));

/** The colour painted at page point (x, y), read from a real screenshot of `within`. */
async function paintedAt(within: HTMLElement, x: number, y: number): Promise<number[]> {
  // With `save: false` the screenshot comes back as the base64 string itself.
  const shot: unknown = await page.screenshot({ element: within, base64: true, save: false });
  const image = new Image();
  image.src = `data:image/png;base64,${shot as string}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  const box = within.getBoundingClientRect();
  const k = image.width / box.width;
  return [
    ...context
      .getImageData(Math.round((x - box.left) * k), Math.round((y - box.top) * k), 1, 1)
      .data.slice(0, 3),
  ];
}

/** `calc(var(--wt-tap-min) + 2 * var(--wt-space-3))` in px, read from the tokens in force. */
function oneLine(inside: HTMLElement): number {
  const probe = document.createElement("div");
  probe.style.height = "calc(var(--wt-tap-min) + 2 * var(--wt-space-3))";
  inside.append(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height;
}

const frames: [number, number][] = [
  [390, 844],
  [1024, 768],
];

describe("till-floor-screen: where the Ready bar sits", () => {
  afterEach(resetPage);

  for (const [width, height] of frames) {
    it(`sits at the foot of the scrolling area, with two tables or forty (${width} px)`, async () => {
      await pageAt(width, height);
      for (const tables of [
        [mesa2(), mesa8()],
        [mesa2(), mesa8(), ...numbered(40, 0).slice(2)],
      ]) {
        const { floor, area } = await inShell(tables);
        const foot = area.getBoundingClientRect().bottom;
        expect(Math.abs(bar(floor)!.getBoundingClientRect().bottom - foot)).toBeLessThanOrEqual(1);
        area.scrollTop = area.scrollHeight;
        const cards = floor.shadowRoot!.querySelectorAll<HTMLElement>(".grid [data-table]");
        expect(cards).toHaveLength(tables.length);
        const barBox = bar(floor)!.getBoundingClientRect();
        expect(Math.abs(barBox.bottom - foot)).toBeLessThanOrEqual(1);
        expect(cards[cards.length - 1]!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
          barBox.top,
        );
        cleanupWidgets();
      }
    });

    it(`fits one line (${width} px)`, async () => {
      await pageAt(width, height);
      const { floor, area } = await inShell(numbered(8, 8));
      const section = bar(floor)!;
      expect(section.querySelectorAll("[data-ready-table]")).toHaveLength(8);
      expect(section.getBoundingClientRect().height).toBeLessThanOrEqual(oneLine(area));
      const inside = area.getBoundingClientRect();
      for (const part of [section.querySelector("h2")!, openButton(floor)]) {
        const box = part.getBoundingClientRect();
        expect(box.left).toBeGreaterThanOrEqual(inside.left);
        expect(box.right).toBeLessThanOrEqual(inside.right);
      }
      const tops = [...section.querySelectorAll("[data-ready-table]")].map(
        (entry) => entry.getBoundingClientRect().top,
      );
      expect(new Set(tops).size).toBe(1);
      // Eight fit side by side at 1024 px; on a phone they do not, and the strip scrolls instead.
      const strip = section.querySelector<HTMLElement>(".ready-tables")!;
      if (width === 390) expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth);
    });

    it(`is drawn under an overlay (${width} px)`, async () => {
      await pageAt(width, height);
      const { floor, area, overlay } = await inShell([
        mesa2(),
        mesa8(),
        ...numbered(40, 0).slice(2),
      ]);
      overlay.hidden = false;
      const box = bar(floor)!.getBoundingClientRect();
      const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      // The point read must be on screen, inside the region, or the screenshot has no pixel there.
      expect(centre.y).toBeLessThan(area.getBoundingClientRect().bottom);
      const painted = await paintedAt(area.parentElement!, centre.x, centre.y);
      expect(distance(painted, rgb(getComputedStyle(overlay).backgroundColor))).toBeLessThan(4);
      expect(getComputedStyle(floor).isolation).toBe("isolate");
    });
  }
});
