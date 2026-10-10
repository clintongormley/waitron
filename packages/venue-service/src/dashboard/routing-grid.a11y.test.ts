import { afterEach, describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
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
      { id: "kitchen", name: "Kitchen", active: true },
      { id: "bar", name: "Bar", active: true },
      { id: "old", name: "Old kitchen", active: false },
    ],
    canMakeDefault: true,
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

const states: Record<
  string,
  {
    model: RoutingView;
    expand?: boolean;
    open?: string;
    refusal?: RoutingGrid["refusal"];
    /** Cells and whether each must carry a period line's not-on-menus mark before the scan. */
    flags?: Record<string, boolean>;
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
    for (const [selector, carries] of Object.entries(state.flags ?? {})) {
      const flag = el.shadowRoot!.querySelector(`${selector} [data-test="period-flag"]`);
      if ((flag !== null) !== carries)
        throw new Error(`${selector}: not-on-menus mark ${carries ? "missing" : "unexpected"}`);
    }
    await expectNoA11yViolations(host);
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
  test.each([
    [
      "the not-on-menus mark",
      'td[data-row="c:drinks"][data-zone="every"]',
      '[data-test="period-flag"]',
    ],
    ["an inherited line", 'td[data-row="p:mojito"][data-zone="every"]', ".line.inherited"],
  ])("keeps %s at 4.5:1 against the hover", async (_, cellSelector, textSelector) => {
    await mountThemed("<div></div>", theme);
    const el = document.createElement("venue-routing-grid");
    Object.assign(el, { model: flaggedLine });
    host.append(el);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="expand-all"]')!.click();
    await el.updateComplete;
    const cell = el.shadowRoot!.querySelector<HTMLButtonElement>(
      `${cellSelector} button[data-test="routing-cell"]`,
    )!;
    const text = cell.querySelector(textSelector)!;
    const atRest = getComputedStyle(cell).backgroundColor;
    await userEvent.hover(cell);
    expect(cell.matches(":hover")).toBe(true);
    const hovered = getComputedStyle(cell).backgroundColor;
    expect(hovered).not.toBe(atRest);
    expect(contrastRatio(getComputedStyle(text).color, hovered)).toBeGreaterThanOrEqual(4.5);
  });
});
