import { afterEach, describe, test, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { RoutingView } from "../routing.js";
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
        nextTransition: null,
        hours: [],
        fallbackStationId: "kitchen",
        today: null,
        closedSendsTo: "kitchen",
      },
    ],
    periods: [],
    todayEnds: null,
    clockReadable: true,
    zones: [
      { id: "terrace", name: "Terrace" },
      { id: "inside", name: "Inside" },
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

/** Bread × Every zone falls through to the default; Bread × Terrace inherits No preparation;
 * Mojito × Every zone names the default station itself. */
const extrasNotes = routing({
  cells: [
    ...routing().cells,
    {
      row: { kind: "product", productId: "mojito" },
      zoneId: null,
      target: { kind: "station", stationId: "kitchen" },
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
    /** Cells and whether each must carry the extras note before the scan. */
    notes?: Record<string, boolean>;
  }
> = {
  "extras notes": {
    model: extrasNotes,
    expand: true,
    notes: {
      'td[data-row="p:bread"][data-zone="every"]': true,
      'td[data-row="all"][data-zone="every"]': true,
      'td[data-row="p:bread"][data-zone="terrace"]': true,
      'td[data-row="p:mojito"][data-zone="every"]': false,
    },
  },
  "extras notes, read-only default": {
    model: routing({ canMakeDefault: false }),
    notes: { 'td[data-row="all"][data-zone="every"]': true },
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
      const box = el.shadowRoot!.querySelector(`${state.open} wt-combobox[name="routing-target"]`)!;
      const popup = box.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
      box.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!.click();
      await vi.waitFor(() => {
        if (!popup.matches(":popover-open")) throw new Error("the editor did not open");
      });
    }
    for (const [selector, carries] of Object.entries(state.notes ?? {})) {
      const note = el.shadowRoot!.querySelector(`${selector} [data-test="extra-note"]`);
      if ((note !== null) !== carries)
        throw new Error(`${selector}: extras note ${carries ? "missing" : "unexpected"}`);
    }
    await expectNoA11yViolations(host);
  });
});
