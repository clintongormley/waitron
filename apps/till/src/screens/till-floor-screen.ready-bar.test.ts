import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { setHelpMode, type WtHelpTooltip } from "@waitron/ui";
import {
  cleanupWidgets,
  distance,
  mountWidget,
  oneLine,
  pageAt,
  paintedAt,
  resetPage,
  rgb,
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
    timingBand: "fresh",
    nextReservation: null,
    today: null,
    party: party(),
    signals: [],
    shortName: over.label ?? "Table 2",
    ...over,
  };
}

/** A station's ready food: id, name, count, and optionally its oldest ready time and warning minutes. */
type ReadyStation = [string, string, number, (string | null)?, number?];

const ready = (...byStation: ReadyStation[]): TableSignal => ({
  kind: "ready",
  byStation: byStation.map(
    ([stationId, stationName, count, oldestReadyAt = null, readyWarningAfterMinutes = 3]) => ({
      stationId,
      stationName,
      count,
      oldestReadyAt,
      readyWarningAfterMinutes,
    }),
  ),
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

const table2 = (count = 3) => table({ signals: [ready(["bar", "Bar", count])] });
const table8 = (
  over: Partial<TableState> = {},
  stations: ReadyStation[] = [
    ["bar", "Bar", 1],
    ["kitchen", "Kitchen", 2],
  ],
) =>
  table({
    id: "t8",
    label: "Table 8",
    party: party({ id: "v8", displayName: "Table 8", tableIds: ["t8"] }),
    signals: [ready(...stations)],
    ...over,
  });

async function mountFloor(
  tables: TableState[],
  over: Partial<TillFloorScreen> = {},
): Promise<TillFloorScreen> {
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [zone("z1", "Dining room", 0)],
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
    const el = await mountFloor([table2(), table8()]);
    expect(entries(el)).toEqual(["Table 2 · 3", "Table 8 · 3"]);
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
    const tables = [table2(), table8({ zoneId: "z2" })];
    const one = await mountFloor(tables);
    expect(entries(one)).toEqual(["Table 2 · 3"]);
    cleanupWidgets();
    const both = await mountFloor(tables, {
      zones: [zone("z1", "Dining room", 0), zone("z2", "Terrace", 1)],
    });
    expect(entries(both)).toEqual(["Table 2 · 3", "Table 8 · 3"]);
  });

  it("tapping a table opens it, and Open opens the first", async () => {
    const el = await mountFloor([table2(), table8()]);
    const seen = opened(el);
    el.shadowRoot!.querySelector<HTMLElement>('[data-ready-table="t8"]')!.click();
    expect(seen).toEqual([{ tableId: "t8", seated: true }]);
    seen.length = 0;
    openButton(el).click();
    expect(seen).toEqual([{ tableId: "t2", seated: true }]);
    expect(openButton(el).getAttribute("aria-label")).toBe("Open Table 2");
  });

  it("the bar shows each table's short name, not its full name", async () => {
    const el = await mountFloor([
      table({ label: "Table 2", shortName: "T2", signals: [ready(["bar", "Bar", 3])] }),
    ]);
    expect(entries(el)).toEqual(["T2 · 3"]);
    expect(openButton(el).getAttribute("aria-label")).toBe("Open T2");
  });

  it("draws nothing while nothing is ready", async () => {
    const el = await mountFloor([table()]);
    expect(bar(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-ready-open]")).toBeNull();
  });

  it("a till keeps the summary, titled Ready, and draws no bar", async () => {
    const el = await mountFloor([table2(), table8()], { handheld: false });
    expect(el.shadowRoot!.querySelector("[data-station-summary] h2")!.textContent!.trim()).toBe(
      "Ready",
    );
    expect(bar(el)).toBeNull();
  });

  it("says it in Spanish, one dish or several", async () => {
    setLocale("es");
    const el = await mountFloor([table2(1), table8({}, [["bar", "Bar", 3]])]);
    const section = bar(el)!;
    const title = el.shadowRoot!.getElementById(section.getAttribute("aria-labelledby")!)!;
    expect(title.textContent!.trim()).toBe("Listo");
    expect(entries(el)).toEqual(["Table 2 · 1", "Table 8 · 3"]);
    expect(openButton(el).textContent!.trim()).toBe("Abrir ›");
    expect(openButton(el).getAttribute("aria-label")).toBe("Abrir Table 2");
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

const minute = 60_000;
/** The ISO time `ms` before the file's fixed `now`. */
const ago = (ms: number) => new Date(now - ms).toISOString();
const readyAt = (...stations: ReadyStation[]) => table({ signals: [ready(...stations)] });
const readyAt8 = (...stations: ReadyStation[]) => table8({}, stations);
const title = (el: TillFloorScreen) =>
  el.shadowRoot!.getElementById(bar(el)!.getAttribute("aria-labelledby")!)!.textContent!.trim();
const warningEntries = (el: TillFloorScreen) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-ready-table][data-warning]")].map(
    (entry) => entry.dataset.readyTable,
  );
/** Table 2 calm at 2 minutes, Table 8 at 4 minutes past its station's 3. */
const warningCase = () => [
  readyAt(["bar", "Bar", 1, ago(2 * minute), 3]),
  readyAt8(["grill", "Grill", 2, ago(4 * minute), 3]),
];

describe("till-floor-screen: the Ready bar's warning", () => {
  it("a calm bar reads Ready and lists the longest-waiting table first", async () => {
    const el = await mountFloor([
      readyAt(["bar", "Bar", 1, ago(minute), 3]),
      readyAt8(["bar", "Bar", 2, ago(2 * minute), 3]),
    ]);
    expect(title(el)).toBe("Ready");
    expect(entries(el)).toEqual(["Table 8 · 2", "Table 2 · 1"]);
    expect(el.shadowRoot!.querySelector("[data-warning]")).toBeNull();
    const seen = opened(el);
    openButton(el).click();
    expect(seen).toEqual([{ tableId: "t8", seated: true }]);
    expect(openButton(el).getAttribute("aria-label")).toBe("Open Table 8");
  });

  it("once food has waited its station's minutes, the bar warns and names that table first with its minutes", async () => {
    const el = await mountFloor(warningCase());
    expect(title(el)).toBe("Ready 4 min");
    expect(bar(el)!.hasAttribute("data-warning")).toBe(true);
    expect(entries(el)).toEqual(["Table 8 · 2", "Table 2 · 1"]);
    expect(warningEntries(el)).toEqual(["t8"]);
    const seen = opened(el);
    openButton(el).click();
    expect(seen).toEqual([{ tableId: "t8", seated: true }]);
  });

  it("a salad waiting longer stays calm and comes after the warning table", async () => {
    const el = await mountFloor([
      readyAt(["cold", "Cold", 1, ago(5 * minute), 6]),
      readyAt8(["grill", "Grill", 1, ago(4.5 * minute), 3]),
    ]);
    expect(title(el)).toBe("Ready 4 min");
    expect(entries(el)).toEqual(["Table 8 · 1", "Table 2 · 1"]);
    expect(warningEntries(el)).toEqual(["t8"]);
  });

  it("a re-read with the oldest dish served turns the bar calm", async () => {
    const el = await mountFloor(warningCase());
    expect(title(el)).toBe("Ready 4 min");
    el.tables = [table8({ signals: [] }), readyAt(["bar", "Bar", 1, ago(2 * minute), 3])];
    await el.updateComplete;
    expect(title(el)).toBe("Ready");
    expect(entries(el)).toEqual(["Table 2 · 1"]);
    expect(el.shadowRoot!.querySelector("[data-warning]")).toBeNull();
  });

  it("says it in Spanish", async () => {
    setLocale("es");
    const el = await mountFloor(warningCase());
    expect(title(el)).toBe("Listo 4 min");
    expect(openButton(el).textContent!.trim()).toBe("Abrir ›");
    expect(openButton(el).getAttribute("aria-label")).toBe("Abrir Table 8");
  });

  it("the section is named by its heading, minutes included", async () => {
    const el = await mountFloor(warningCase());
    await expect.element(bar(el)!).toHaveAccessibleName("Ready 4 min");
    expect(bar(el)!.querySelector('[aria-live], [role="status"]')).toBeNull();
  });

  it("a till's summary has no minutes and no warning", async () => {
    const el = await mountFloor(warningCase(), { handheld: false });
    expect(el.shadowRoot!.querySelector("[data-station-summary] h2")!.textContent!.trim()).toBe(
      "Ready",
    );
    expect(el.shadowRoot!.querySelector("[data-warning]")).toBeNull();
  });
});

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateReducedMotion: (reduced: boolean) => Promise<void>;
  }
}

const native = (button: HTMLElement) => button.shadowRoot!.querySelector("button")!;
const entry = (el: TillFloorScreen, id: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-ready-table="${id}"]`)!;

describe("till-floor-screen: the Ready bar warning's look", () => {
  afterEach(() => commands.emulateReducedMotion(false));

  it("a warning bar pulses at the slow pulse token, 2 s by default", async () => {
    await commands.emulateReducedMotion(false);
    const el = await mountFloor(warningCase(), { reducedMotion: false });
    expect(getComputedStyle(bar(el)!).animationName).toBe("ready-warning");
    expect(getComputedStyle(bar(el)!).animationDuration).toBe("2s");
    el.style.setProperty("--wt-duration-pulse-slow", "5000ms");
    expect(getComputedStyle(bar(el)!).animationDuration).toBe("5s");
    cleanupWidgets();
    const calm = await mountFloor([table2()], { reducedMotion: false });
    expect(getComputedStyle(bar(calm)!).animationName).toBe("none");
  });

  it("its edge dims to the amber dim colour half-way", async () => {
    await commands.emulateReducedMotion(false);
    const el = await mountFloor(warningCase(), { reducedMotion: false });
    el.style.setProperty("--wt-color-warning", "rgb(4, 5, 6)");
    el.style.setProperty("--wt-color-warning-pulse-dim", "rgb(7, 8, 9)");
    const section = bar(el)!;
    const [animation] = section.getAnimations();
    animation!.pause();
    animation!.currentTime = 1000;
    expect(getComputedStyle(section).borderTopColor).toBe("rgb(7, 8, 9)");
    expect(getComputedStyle(section).boxShadow).toContain("rgb(7, 8, 9)");
    animation!.currentTime = 0;
    expect(getComputedStyle(section).borderTopColor).toBe("rgb(4, 5, 6)");
    expect(getComputedStyle(section).boxShadow).toContain("rgb(4, 5, 6)");
  });

  it("under reduced motion nothing moves and the amber stays", async () => {
    const still = async (el: TillFloorScreen) => {
      el.style.setProperty("--wt-color-warning", "rgb(4, 5, 6)");
      const section = bar(el)!;
      expect(getComputedStyle(section).animationName).toBe("none");
      expect(getComputedStyle(section).borderTopColor).toBe("rgb(4, 5, 6)");
      expect(getComputedStyle(section.querySelector("h2")!).color).toBe("rgb(4, 5, 6)");
    };
    await commands.emulateReducedMotion(false);
    await still(await mountFloor(warningCase(), { reducedMotion: true }));
    cleanupWidgets();
    await commands.emulateReducedMotion(true);
    await still(await mountFloor(warningCase(), { reducedMotion: undefined }));
    cleanupWidgets();
    // Turned on after the bar was drawn, with no redraw: the stylesheet's own gate stops it.
    await commands.emulateReducedMotion(false);
    const drawn = await mountFloor(warningCase(), { reducedMotion: undefined });
    expect(getComputedStyle(bar(drawn)!).animationName).toBe("ready-warning");
    await commands.emulateReducedMotion(true);
    await still(drawn);
  });

  it("the heading's icon is amber with its words while warning, and the text colour when calm", async () => {
    const iconFill = (el: TillFloorScreen) => {
      const icon = bar(el)!.querySelector("h2 wt-icon")!;
      return getComputedStyle(icon.shadowRoot!.querySelector("svg")!).fill;
    };
    const el = await mountFloor(warningCase());
    el.style.setProperty("--wt-color-warning", "rgb(4, 5, 6)");
    expect(iconFill(el)).toBe("rgb(4, 5, 6)");
    cleanupWidgets();
    const calm = await mountFloor([table2()]);
    calm.style.setProperty("--wt-color-text", "rgb(13, 14, 15)");
    calm.style.setProperty("--wt-color-warning", "rgb(4, 5, 6)");
    expect(iconFill(calm)).toBe("rgb(13, 14, 15)");
  });

  it("the warning entry is amber and keeps a hover cue; the calm entry is unchanged", async () => {
    await commands.emulateReducedMotion(false);
    const calm = await mountFloor([readyAt(["bar", "Bar", 1, ago(2 * minute), 3])]);
    const calmLook = getComputedStyle(native(entry(calm, "t2")));
    const calmColours = [calmLook.color, calmLook.borderTopColor];
    cleanupWidgets();
    const el = await mountFloor(warningCase());
    el.style.setProperty("--wt-color-warning", "rgb(4, 5, 6)");
    el.style.setProperty("--wt-color-primary-text", "rgb(10, 11, 12)");
    const warning = native(entry(el, "t8"));
    expect(getComputedStyle(warning).color).toBe("rgb(4, 5, 6)");
    expect(getComputedStyle(warning).borderTopColor).toBe("rgb(4, 5, 6)");
    await userEvent.hover(warning);
    expect(getComputedStyle(warning).borderTopColor).toBe("rgb(10, 11, 12)");
    el.style.removeProperty("--wt-color-warning");
    el.style.removeProperty("--wt-color-primary-text");
    const other = getComputedStyle(native(entry(el, "t2")));
    expect([other.color, other.borderTopColor]).toEqual(calmColours);
  });
});

/** `n` tables, the first `readyCount` of them with food ready, named Table 1 to Table n. */
const numbered = (n: number, readyCount: number): TableState[] =>
  Array.from({ length: n }, (_, i) =>
    table({
      id: `t${i + 1}`,
      label: `Table ${i + 1}`,
      party: party({ id: `v${i + 1}`, displayName: `Table ${i + 1}`, tableIds: [`t${i + 1}`] }),
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
  Object.assign(floor, { zones: [zone("z1", "Dining room", 0)], tables, now, handheld: true });
  area.append(floor);
  region.append(area, overlay);
  await floor.updateComplete;
  return { floor, area, overlay };
}

const frames: [number, number][] = [
  [390, 844],
  [1024, 768],
];

describe("till-floor-screen: where the Ready bar sits", () => {
  afterEach(async () => {
    setHelpMode(false);
    await resetPage();
  });

  for (const [width, height] of frames) {
    it(`sits at the foot of the scrolling area, with two tables or forty (${width} px)`, async () => {
      await pageAt(width, height);
      for (const tables of [
        [table2(), table8()],
        [table2(), table8(), ...numbered(40, 0).slice(2)],
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
      const strip = section.querySelector<HTMLElement>(".ready-tables")!;
      if (width === 390) expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth);
    });

    it(`the warning does not change the bar's height (${width} px)`, async () => {
      await pageAt(width, height);
      const calm = await inShell([
        readyAt(["bar", "Bar", 1, ago(2 * minute), 3]),
        readyAt8(["grill", "Grill", 2, ago(2 * minute), 3]),
      ]);
      expect(bar(calm.floor)!.hasAttribute("data-warning")).toBe(false);
      const calmHeight = bar(calm.floor)!.getBoundingClientRect().height;
      cleanupWidgets();
      const { floor, area } = await inShell(warningCase());
      expect(bar(floor)!.hasAttribute("data-warning")).toBe(true);
      const warningHeight = bar(floor)!.getBoundingClientRect().height;
      expect(warningHeight).toBe(calmHeight);
      expect(warningHeight).toBeLessThanOrEqual(oneLine(area));
    });

    it(`with help on, the bar's badge shows whole inside the scrolling area (${width} px)`, async () => {
      await pageAt(width, height);
      const { floor, area } = await inShell(numbered(8, 8));
      // The shell's own badge size, which the scrolling area inherits in the app.
      area.parentElement!.style.setProperty("--wt-help-badge-target", "32px");
      area.parentElement!.style.setProperty("--wt-help-badge-size", "24px");
      setHelpMode(true);
      await floor.updateComplete;
      const section = bar(floor)!;
      const badge = section.querySelector<WtHelpTooltip>("wt-help-tooltip")!;
      await badge.updateComplete;
      const at = badge.getBoundingClientRect();
      const inside = area.getBoundingClientRect();
      expect(at.width).toBeGreaterThan(0);
      expect(at.left).toBeGreaterThanOrEqual(inside.left);
      expect(at.right).toBeLessThanOrEqual(inside.right);
      expect(at.top).toBeGreaterThanOrEqual(inside.top);
      expect(at.bottom).toBeLessThanOrEqual(inside.bottom);
      for (const part of [section.querySelector("h2")!, openButton(floor)]) {
        const box = part.getBoundingClientRect();
        expect(box.left).toBeGreaterThanOrEqual(inside.left);
        expect(box.right).toBeLessThanOrEqual(inside.right);
      }
    });

    it(`is drawn under an overlay (${width} px)`, async () => {
      await pageAt(width, height);
      const { floor, area, overlay } = await inShell([
        table2(),
        table8(),
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

describe("till-floor-screen: the Ready bar's warning, on the screen's own clock", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const onOwnClock = (tables: TableState[], over: Partial<TillFloorScreen> = {}) =>
    mountFloor(tables, { now: undefined, ...over });
  const advance = async (el: TillFloorScreen, ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
    await el.updateComplete;
  };

  it("counts the minutes up with no new floor read", async () => {
    const el = await onOwnClock([readyAt(["bar", "Bar", 1, ago(2.5 * minute), 3])]);
    const reads: unknown[] = [];
    el.addEventListener("floor-refresh", (event) => reads.push(event));
    expect(title(el)).toBe("Ready");
    await advance(el, 30_000);
    expect(title(el)).toBe("Ready 3 min");
    expect(bar(el)!.hasAttribute("data-warning")).toBe(true);
    await advance(el, minute);
    expect(title(el)).toBe("Ready 4 min");
    await advance(el, minute);
    expect(title(el)).toBe("Ready 5 min");
    expect(reads).toEqual([]);
  });

  it("turns amber at the crossing, judged per station", async () => {
    const el = await onOwnClock([
      readyAt(["cold", "Cold", 1, ago(4 * minute), 6]),
      readyAt8(["grill", "Grill", 1, ago(2 * minute), 3]),
    ]);
    expect(title(el)).toBe("Ready");
    expect(entries(el)).toEqual(["Table 2 · 1", "Table 8 · 1"]);
    await advance(el, minute);
    expect(title(el)).toBe("Ready 3 min");
    expect(entries(el)).toEqual(["Table 8 · 1", "Table 2 · 1"]);
    expect(warningEntries(el)).toEqual(["t8"]);
    await advance(el, minute);
    expect(title(el)).toBe("Ready 6 min");
    expect(entries(el)).toEqual(["Table 2 · 1", "Table 8 · 1"]);
    expect(warningEntries(el)).toEqual(["t2", "t8"]);
  });

  it("keeps one timer beside a held countdown, however often the floor redraws", async () => {
    const heldTable = table({
      id: "t4",
      label: "4",
      party: party({
        id: "v4",
        displayName: "4",
        tableIds: ["t4"],
        reminder: { groupId: "g2", dueAt: new Date(now + 5 * minute).toISOString() },
      }),
      signals: [{ kind: "held", count: 2 }],
    });
    const el = await onOwnClock([heldTable, readyAt(["bar", "Bar", 1, ago(4 * minute), 3])]);
    expect(title(el)).toBe("Ready 4 min");
    expect(vi.getTimerCount()).toBe(1);
    for (let redraw = 0; redraw < 3; redraw++) {
      el.requestUpdate();
      await el.updateComplete;
    }
    expect(vi.getTimerCount()).toBe(1);
  });

  it("keeps no timer for ready food with no time, nor on a till", async () => {
    const untimed = await onOwnClock([readyAt(["bar", "Bar", 1, null, 3])]);
    const till = await onOwnClock([readyAt(["bar", "Bar", 1, ago(2.5 * minute), 3])], {
      handheld: false,
    });
    expect(vi.getTimerCount()).toBe(0);
    const redraws = [vi.spyOn(untimed, "requestUpdate"), vi.spyOn(till, "requestUpdate")];
    await vi.advanceTimersByTimeAsync(5 * minute);
    for (const redraw of redraws) expect(redraw).not.toHaveBeenCalled();
  });

  it("reads the minutes now on coming back to the page", async () => {
    const el = await onOwnClock([readyAt(["bar", "Bar", 1, ago(4.5 * minute), 3])]);
    expect(title(el)).toBe("Ready 4 min");
    const parent = el.parentElement!;
    el.remove();
    await vi.advanceTimersByTimeAsync(3 * minute);
    parent.append(el);
    await advance(el, 0);
    expect(title(el)).toBe("Ready 7 min");
  });
});
