import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { RetiredFallbackRoutingView as RoutingView } from "../../test/retired-routing-fixture-types.js";
import type { RoutingGrid } from "./routing-grid.js";
import "./routing-grid.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

function routing(overrides: Partial<RoutingView> = {}): RoutingView {
  return {
    stationTimes: [
      {
        stationId: "old",
        status: { open: false, why: "switched_off" },

        fallbackStationId: "kitchen",
        today: null,
        closedSendsTo: "kitchen",
      },
    ],
    periods: [],
    todayEnds: null,
    clockReadable: true,
    zones: [
      { id: "terrace", name: "Terrace", departmentId: null },
      { id: "inside", name: "Inside", departmentId: null },
    ],
    categories: [
      { id: "drinks", name: "Drinks", parentId: null },
      { id: "cocktails", name: "Cocktails", parentId: "drinks" },
    ],
    products: [
      { id: "mojito", name: "Mojito", categoryId: "cocktails" },
      { id: "bread", name: "Bread", categoryId: null },
    ],
    cells: [
      {
        row: { kind: "category", categoryId: "drinks" },
        zoneId: null,
        target: { kind: "station", stationId: "bar" },
      },
      { row: { kind: "all" }, zoneId: "terrace", target: { kind: "no_preparation" } },
    ],
    defaultStationId: "kitchen",
    stations: [
      { id: "kitchen", name: "Kitchen", active: true, colour: "orange" },
      { id: "bar", name: "Bar", active: true, colour: "blue" },
      { id: "old", name: "Old kitchen", active: false, colour: "brown" },
    ],
    canMakeDefault: true,
    printMovedSlips: true,
    ...overrides,
  };
}

const disabledTarget = routing({
  cells: [
    {
      row: { kind: "category", categoryId: "drinks" },
      zoneId: "inside",
      target: { kind: "station", stationId: "old" },
    },
  ],
});

const storedOnlyNoCategory = routing({
  products: [{ id: "mojito", name: "Mojito", categoryId: "cocktails" }],
  cells: [
    ...routing().cells,
    {
      row: { kind: "no_category" },
      zoneId: "inside",
      target: { kind: "station", stationId: "bar" },
    },
  ],
});

/** Drinks × Every zone stores a Lunch line Lunch's menus no longer offer; Mojito inherits it. */
const flaggedLine = routing({
  periods: [
    {
      id: "lunch",
      departmentId: "dining",
      departmentName: "Dining",
      name: "Lunch",
      colour: "blue",
      productIds: [],
    },
  ],
  cells: [
    {
      row: { kind: "category", categoryId: "drinks" },
      zoneId: null,
      target: { kind: "station", stationId: "bar" },
      periods: [
        { periodId: "lunch", target: { kind: "station", stationId: "kitchen" }, notOffered: true },
      ],
    },
  ],
});

/**
 * Option A's tree: Mojito has its own routing under closed Drinks and Cocktails; Drinks' Terrace
 * cell is blank, Cocktails' Inside cell differs, and Drinks' Every zone carries a line.
 */
const mockupTree = routing({
  periods: flaggedLine.periods,
  cells: [
    {
      row: { kind: "category", categoryId: "drinks" },
      zoneId: null,
      target: { kind: "station", stationId: "bar" },
      periods: [{ periodId: "lunch", target: { kind: "station", stationId: "kitchen" } }],
    },
    {
      row: { kind: "product", productId: "mojito" },
      zoneId: null,
      target: { kind: "station", stationId: "kitchen" },
    },
    { row: { kind: "all" }, zoneId: "terrace", target: { kind: "no_preparation" } },
    {
      row: { kind: "category", categoryId: "drinks" },
      zoneId: "inside",
      target: { kind: "station", stationId: "kitchen" },
    },
  ],
});

const COLOURS = [
  "red",
  "orange",
  "amber",
  "lime",
  "green",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "purple",
  "pink",
  "brown",
] as const;

/**
 * Twelve stations, one per colour: category `c<i>` sends Every zone to station `s<i>` with a Lunch
 * line to the next station, and its product inherits both. One cell carries a refusal and another a
 * disabled station.
 */
const everyColour = routing({
  periods: flaggedLine.periods.map((period) => ({ ...period, productIds: ["p0"] })),
  categories: COLOURS.map((_, i) => ({ id: `c${i}`, name: `Category ${i}`, parentId: null })),
  products: COLOURS.map((_, i) => ({ id: `p${i}`, name: `Product ${i}`, categoryId: `c${i}` })),
  defaultStationId: "s0",
  stations: [
    ...COLOURS.map((colour, i) => ({
      id: `s${i}`,
      name: `Station ${colour}`,
      active: true,
      colour,
    })),
    { id: "old", name: "Old kitchen", active: false, colour: "brown" as const },
  ],
  stationTimes: [{ ...routing().stationTimes[0]!, fallbackStationId: "s0", closedSendsTo: "s0" }],
  cells: [
    ...COLOURS.map((_, i) => ({
      row: { kind: "category" as const, categoryId: `c${i}` },
      zoneId: null,
      target: { kind: "station" as const, stationId: `s${i}` },
      periods: [
        { periodId: "lunch", target: { kind: "station" as const, stationId: `s${(i + 1) % 12}` } },
      ],
    })),
    {
      row: { kind: "category", categoryId: "c3" },
      zoneId: "inside",
      target: { kind: "station", stationId: "old" },
    },
  ],
});

const states: Record<
  string,
  {
    model: RoutingView;
    expand?: boolean;
    /** Typed into the search field before the scan, with the number of marks it must draw. */
    search?: { query: string; marks: number };
    open?: string;
    refusal?: RoutingGrid["refusal"];
    /** Cells and whether each must carry a period line's not-on-menus mark before the scan. */
    flags?: Record<string, boolean>;
    /** Cells and the look each must be drawn in before the scan. */
    styles?: Record<string, string>;
    /** How many different station colours the cells must be painted in before the scan. */
    painted?: number;
    /** Chosen in the Period field before the scan; no period line may then be drawn. */
    period?: string;
  }
> = {
  "flagged period line": {
    model: flaggedLine,
    expand: true,
    flags: {
      'td[data-row="c:drinks"][data-zone="every"]': true,
      'td[data-row="p:mojito"][data-zone="every"]': false,
    },
  },
  "mockup tree": {
    model: mockupTree,
    styles: {
      'td[data-row="c:drinks"][data-zone="every"]': "set",
      'td[data-row="p:mojito"][data-zone="every"]': "set",
      'td[data-row="c:drinks"][data-zone="terrace"]': "blank",
      'td[data-row="c:cocktails"][data-zone="inside"]': "differs",
      'td[data-row="p:mojito"][data-zone="inside"]': "blank",
      'td[data-row="c:cocktails"][data-zone="every"]': "inherited",
    },
  },
  collapsed: { model: routing() },
  expanded: { model: routing(), expand: true },
  "editor open": { model: routing(), open: 'td[data-row="all"][data-zone="every"]' },
  "no category editor open": {
    model: routing(),
    open: 'td[data-row="no_category"][data-zone="every"]',
  },
  "saved no category cell, no uncategorised product": { model: storedOnlyNoCategory },
  "saved no category cell, no uncategorised product, editor open": {
    model: storedOnlyNoCategory,
    open: 'td[data-row="no_category"][data-zone="inside"]',
  },
  "read-only default": { model: routing({ canMakeDefault: false }) },
  repair: { model: routing({ defaultStationId: null }) },
  "repair, read-only": { model: routing({ defaultStationId: null, canMakeDefault: false }) },
  "disabled target": { model: disabledTarget },
  "disabled target, editor open": {
    model: disabledTarget,
    open: 'td[data-row="c:drinks"][data-zone="inside"]',
  },
  "search with matches": { model: mockupTree, search: { query: "mo", marks: 1 } },
  "search matching an uncategorised product": {
    model: routing(),
    search: { query: "bread", marks: 1 },
  },
  "search, no matches": { model: routing(), search: { query: "zzz", marks: 0 } },
  "every colour": {
    model: everyColour,
    expand: true,
    painted: 12,
    refusal: {
      address: { row: { kind: "category", categoryId: "c5" }, zoneId: null },
      message: "This station was disabled. Choose another.",
    },
  },
  "one period chosen": {
    model: everyColour,
    expand: true,
    period: "lunch",
    painted: 12,
    styles: {
      'td[data-row="c:c3"][data-zone="every"]': "set",
      'td[data-row="p:p3"][data-zone="every"]': "inherited",
      'td[data-row="c:c4"][data-zone="terrace"]': "differs",
      'td[data-row="c:c3"][data-zone="inside"]': "set",
    },
    refusal: {
      address: { row: { kind: "category", categoryId: "c5" }, zoneId: null },
      message: "This station was disabled. Choose another.",
    },
  },
  refusal: {
    model: routing(),
    refusal: {
      address: { row: { kind: "category", categoryId: "drinks" }, zoneId: null },
      message: "This station was disabled. Choose another.",
    },
  },
};

describe.each(["light", "dark"] as const)("routing grid accessibility (%s)", (theme) => {
  test.each(Object.keys(states))("%s", async (name) => {
    const state = states[name]!;
    await mountThemed("<div></div>", theme);
    const el = document.createElement("venue-routing-grid");
    Object.assign(el, { model: state.model, refusal: state.refusal ?? null });
    host.append(el);
    await el.updateComplete;
    if (state.expand) {
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="expand-all"]')!.click();
      await el.updateComplete;
    }
    if (state.search) {
      const field = el.shadowRoot!.querySelector<HTMLElement>('wt-input[name="search"]')!;
      await userEvent.fill(field.shadowRoot!.querySelector("input")!, state.search.query);
      await el.updateComplete;
      const marks = el.shadowRoot!.querySelectorAll("tbody mark").length;
      if (marks !== state.search.marks) throw new Error(`search drew ${marks} marks`);
    }
    if (state.open) {
      el.shadowRoot!.querySelector<HTMLButtonElement>(
        `${state.open} button[data-test="routing-cell"]`,
      )!.click();
      await vi.waitFor(() => {
        if (!el.shadowRoot!.querySelector("routing-cell-editor")?.open)
          throw new Error("the editor did not open");
      });
      await el.shadowRoot!.querySelector("routing-cell-editor")!.updateComplete;
    }
    if (state.period !== undefined) {
      el.shadowRoot!.querySelector('wt-combobox[name="period"]')!.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: state.period },
          bubbles: true,
          composed: true,
        }),
      );
      await el.updateComplete;
      const lines = el.shadowRoot!.querySelectorAll(".line").length;
      if (lines !== 0) throw new Error(`drew ${lines} period lines`);
    }
    for (const [selector, carries] of Object.entries(state.flags ?? {})) {
      const flag = el.shadowRoot!.querySelector(`${selector} [data-test="period-flag"]`);
      if ((flag !== null) !== carries)
        throw new Error(`${selector}: not-on-menus mark ${carries ? "missing" : "unexpected"}`);
    }
    for (const [selector, style] of Object.entries(state.styles ?? {})) {
      const drawn = el.shadowRoot!.querySelector<HTMLElement>(
        `${selector} button[data-test="routing-cell"]`,
      )?.dataset.style;
      if (drawn !== style) throw new Error(`${selector}: drawn ${drawn}, not ${style}`);
    }
    if (state.painted !== undefined) {
      const colours = new Set(
        [...el.shadowRoot!.querySelectorAll<HTMLElement>("td[data-station-colour]")].map(
          (cell) => cell.dataset.stationColour,
        ),
      );
      if (colours.size !== state.painted) throw new Error(`painted ${colours.size} colours`);
    }
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)("a highlighted match (%s)", (theme) => {
  test("keeps its text at 4.5:1 against the highlight", async () => {
    await mountThemed("<div></div>", theme);
    const el = document.createElement("venue-routing-grid");
    Object.assign(el, { model: routing() });
    host.append(el);
    await el.updateComplete;
    const field = el.shadowRoot!.querySelector<HTMLElement>('wt-input[name="search"]')!;
    await userEvent.fill(field.shadowRoot!.querySelector("input")!, "coc");
    await el.updateComplete;
    const mark = el.shadowRoot!.querySelector("tbody mark")!;
    const style = getComputedStyle(mark);
    const probe = document.createElement("div");
    probe.style.background = "var(--wt-color-highlight)";
    host.append(probe);
    expect(style.backgroundColor).toBe(getComputedStyle(probe).backgroundColor);
    expect(contrastRatio(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5);
  });
});

// axe is not asked about a hovered cell, so its small coloured text is measured here.
function contrastRatio(a: string, b: string): number {
  const luminance = (rgb: string) => {
    expect(rgb).toMatch(/^rgba?\(/);
    const [r, g, bl] = rgb
      .match(/\d+(\.\d+)?/g)!
      .slice(0, 3)
      .map((part) => Number(part) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

describe.each(["light", "dark"] as const)("a hovered routing cell (%s)", (theme) => {
  /** The grid with every row open, and the cell's `td`, its button and the text inside it. */
  async function hoverable(model: RoutingView, cellSelector: string, textSelector: string) {
    await mountThemed("<div></div>", theme);
    const el = document.createElement("venue-routing-grid");
    Object.assign(el, { model });
    host.append(el);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="expand-all"]')!.click();
    await el.updateComplete;
    const td = el.shadowRoot!.querySelector<HTMLElement>(cellSelector)!;
    const cell = td.querySelector<HTMLButtonElement>('button[data-test="routing-cell"]')!;
    return { td, cell, text: cell.querySelector(textSelector)! };
  }

  test.each([
    [
      "the not-on-menus mark",
      flaggedLine,
      'td[data-row="c:drinks"][data-zone="every"]',
      '[data-test="period-flag"]',
    ],
    [
      "an inherited line",
      flaggedLine,
      'td[data-row="p:mojito"][data-zone="every"]',
      ".line.inherited",
    ],
    ["a set-here station", routing(), 'td[data-row="c:drinks"][data-zone="every"]', ".station"],
  ])(
    "keeps %s at 4.5:1 on its station's fill, which a hover keeps",
    async (_, model, cellSelector, textSelector) => {
      const { td, cell, text } = await hoverable(model, cellSelector, textSelector);
      expect(td.dataset.stationColour).toBeDefined();
      const fill = getComputedStyle(td).backgroundColor;
      const atRest = getComputedStyle(cell).backgroundColor;
      expect(atRest).toBe("rgba(0, 0, 0, 0)");
      await userEvent.hover(cell);
      expect(cell.matches(":hover")).toBe(true);
      const hovered = getComputedStyle(cell);
      expect(hovered.backgroundColor).toBe(atRest);
      expect(getComputedStyle(td).backgroundColor).toBe(fill);
      expect(hovered.outlineStyle).toBe("solid");
      expect(contrastRatio(getComputedStyle(text).color, fill)).toBeGreaterThanOrEqual(4.5);
    },
  );

  test.each([
    [
      "a differing inherited station",
      routing(),
      'td[data-row="p:bread"][data-zone="terrace"]',
      ".station.differs",
    ],
    [
      "the disabled-station warning",
      disabledTarget,
      'td[data-row="c:drinks"][data-zone="inside"]',
      '[data-test="disabled-target"]',
    ],
    [
      "the repair note",
      routing({ defaultStationId: null }),
      'td[data-row="all"][data-zone="every"]',
      '[data-test="default-repair"]',
    ],
  ])("keeps %s at 4.5:1 against the hover", async (_, model, cellSelector, textSelector) => {
    const { td, cell, text } = await hoverable(model, cellSelector, textSelector);
    expect(td.dataset.stationColour).toBeUndefined();
    const atRest = getComputedStyle(cell).backgroundColor;
    await userEvent.hover(cell);
    expect(cell.matches(":hover")).toBe(true);
    const hovered = getComputedStyle(cell).backgroundColor;
    expect(hovered).not.toBe(atRest);
    expect(contrastRatio(getComputedStyle(text).color, hovered)).toBeGreaterThanOrEqual(4.5);
  });

  test("outlines a cell carrying a refusal untinted, keeping the refusal at 4.5:1", async () => {
    await mountThemed("<div></div>", theme);
    const el = document.createElement("venue-routing-grid");
    Object.assign(el, {
      model: routing(),
      refusal: {
        address: { row: { kind: "category", categoryId: "drinks" }, zoneId: null },
        message: "This station was disabled. Choose another.",
      },
    });
    host.append(el);
    await el.updateComplete;
    const cell = el.shadowRoot!.querySelector<HTMLButtonElement>(
      'td[data-row="c:drinks"][data-zone="every"] button[data-test="routing-cell"]',
    )!;
    const refusal = cell.querySelector('[data-test="cell-error"]')!;
    await userEvent.hover(cell);
    expect(cell.matches(":hover")).toBe(true);
    const hovered = getComputedStyle(cell);
    expect(hovered.outlineStyle).toBe("solid");
    expect(hovered.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    const behind = getComputedStyle(cell.parentElement!).backgroundColor;
    expect(contrastRatio(getComputedStyle(refusal).color, behind)).toBeGreaterThanOrEqual(4.5);
  });

  // Its colour against the twelve fills is held in `packages/ui-core/src/tokens/colors.test.ts`;
  // here, that a station cell keeps its fill and draws the ring in that colour.
  test("outlines a hovered station cell in the focus colour, which stands 3:1 on its fill", async () => {
    await mountThemed("<div></div>", theme);
    const el = document.createElement("venue-routing-grid");
    Object.assign(el, { model: routing() });
    host.append(el);
    await el.updateComplete;
    const td = el.shadowRoot!.querySelector<HTMLElement>(
      'td[data-row="c:drinks"][data-zone="every"]',
    )!;
    const probe = document.createElement("div");
    probe.style.background = "var(--wt-color-station-blue)";
    host.append(probe);
    const blue = getComputedStyle(probe).backgroundColor;
    expect(getComputedStyle(td).backgroundColor).toBe(blue);
    const cell = td.querySelector<HTMLButtonElement>('button[data-test="routing-cell"]')!;
    await userEvent.hover(cell);
    expect(cell.matches(":hover")).toBe(true);
    const hovered = getComputedStyle(cell);
    expect(getComputedStyle(td).backgroundColor).toBe(blue);
    expect(hovered.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(hovered.outlineStyle).toBe("solid");
    expect(contrastRatio(hovered.outlineColor, blue)).toBeGreaterThanOrEqual(3);
  });
});

describe("the toolbar", () => {
  afterEach(async () => {
    await page.viewport(1280, 800);
  });

  test.each([390, 1280])(
    "at %i px the search and the Period field fit without overflow",
    async (width) => {
      await page.viewport(width, 800);
      await mountThemed("<div></div>", "light");
      const el = document.createElement("venue-routing-grid");
      Object.assign(el, { model: everyColour });
      host.append(el);
      await el.updateComplete;
      const toolbar = el.shadowRoot!.querySelector<HTMLElement>(".toolbar")!;
      const bounds = toolbar.getBoundingClientRect();
      for (const selector of ['wt-input[name="search"]', 'wt-combobox[name="period"]']) {
        const box = el.shadowRoot!.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        expect(box.width, selector).toBeGreaterThan(0);
        expect(box.left, selector).toBeGreaterThanOrEqual(bounds.left);
        expect(box.right, selector).toBeLessThanOrEqual(bounds.right);
      }
      expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
    },
  );
});
