import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import indexHtml from "../../index.html?raw";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { PHONE_WIDTH } from "../widgets/chooser-styles.js";
import type { TillApi } from "../api/client.js";
import type { TableState } from "../api/floor-api.js";
import { mount as mountTableOrder } from "./till-table-order-screen.test-helpers.js";
import "./till-floor-screen.js";
import "./till-pass-screen.js";
import "./till-station-screen.js";
import "./till-counter-screen.js";
import "./till-schedule-screen.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import type { TillPassScreen } from "./till-pass-screen.js";
import type { TillStationScreen } from "./till-station-screen.js";
import type { TillCounterScreen } from "./till-counter-screen.js";
import type { TillScheduleScreen } from "./till-schedule-screen.js";
import { WorkingOrderStore } from "../state/working-order.js";

const DEFAULT_FRAME = [414, 896] as const;

const pageStyleText = /<style>([\s\S]*?)<\/style>/.exec(indexHtml)![1]!;
let pageStyle: HTMLStyleElement | undefined;

afterEach(async () => {
  cleanupWidgets();
  pageStyle?.remove();
  pageStyle = undefined;
  document.documentElement.removeAttribute("data-wt-theme-root");
  await page.viewport(...DEFAULT_FRAME);
});

/** An api whose every call stays pending, so a screen renders its frame and nothing it fetches. */
const pendingApi = new Proxy(
  {},
  { get: (_target, key) => (key === "then" ? undefined : () => new Promise(() => {})) },
) as TillApi;

async function onPage(width: number, height = 900): Promise<void> {
  await page.viewport(width, height);
  expect(window.innerWidth).toBe(width);
  pageStyle = document.createElement("style");
  pageStyle.textContent = pageStyleText;
  document.head.append(pageStyle);
  applyTokens(document.documentElement);
}

/** Where the screen's content starts and how wide it is, after every padding around it. */
function contentBox(el: HTMLElement, selector: string): { left: number; width: number } {
  const box = el.shadowRoot!.querySelector<HTMLElement>(selector)!;
  const rect = box.getBoundingClientRect();
  const style = getComputedStyle(box);
  const left = parseFloat(style.paddingLeft);
  const right = parseFloat(style.paddingRight);
  return { left: rect.left + left, width: rect.width - left - right };
}

const TILL_SPACING = { left: 40, width: 1200 };
/** A screen drawn as one card: the page's 24px, then the card's 1px border and 16px padding. */
const CARD_SPACING = { left: 41, width: 1198 };

const screens: [string, () => Promise<HTMLElement>, string, { left: number; width: number }][] = [
  [
    "floor",
    async () =>
      (
        await mountWidget<TillFloorScreen>("till-floor-screen", {
          zones: [],
          tables: [],
        })
      ).el,
    ".screen",
    TILL_SPACING,
  ],
  [
    "table order",
    async () => (await mountTableOrder({ embedded: true })).el,
    ".screen",
    TILL_SPACING,
  ],
  [
    "expo",
    async () =>
      (await mountWidget<TillPassScreen>("till-pass-screen", { embedded: true, api: pendingApi }))
        .el,
    ".screen",
    TILL_SPACING,
  ],
  [
    "station",
    async () =>
      (await mountWidget<TillStationScreen>("till-station-screen", { api: pendingApi })).el,
    ".screen",
    TILL_SPACING,
  ],
  [
    "counter",
    async () =>
      (
        await mountWidget<TillCounterScreen>("till-counter-screen", {
          store: new WorkingOrderStore(),
        })
      ).el,
    ".body.grid-body",
    TILL_SPACING,
  ],
  [
    "schedule",
    async () =>
      (await mountWidget<TillScheduleScreen>("till-schedule-screen", { api: pendingApi })).el,
    ".head",
    CARD_SPACING,
  ],
];

describe("device screens at phone width", () => {
  it("index.html narrows its body at the till's own phone width", () => {
    expect(pageStyleText).toContain(`@media ${PHONE_WIDTH}`);
  });

  for (const [name, mount, selector, wide] of screens) {
    it(`the ${name} screen's content starts 8px from the edge of a 411px phone`, async () => {
      await onPage(411);
      const el = await mount();
      expect(contentBox(el, selector)).toEqual({ left: 8, width: 395 });
    });

    it(`the ${name} screen keeps its 1280px till spacing`, async () => {
      await onPage(1280);
      const el = await mount();
      expect(contentBox(el, selector)).toEqual(wide);
    });
  }

  it.each([
    [390, 844, 44],
    [844, 390, 44],
    [1280, 844, 30.77],
  ])("fits the Downstairs bar stools at %i × %i px", async (width, height, size) => {
    await onPage(width, height);
    const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
      canChangeToday: true,
      zones: [
        {
          id: "z1",
          name: "Downstairs bar",
          displayOrder: 0,
          active: true,
          closesAt: null,
          closed: false,
          hasPlan: true,
          layoutSetName: null,
          layoutDue: null,
          serviceMode: "table_tab",
        },
      ],
      tables: [17, 53, 89].map((x, i) => ({
        ...plannedTable,
        id: `b${i + 1}`,
        label: `B${i + 1}`,
        shortName: `B${i + 1}`,
        today: {
          ...plannedTable.today!,
          fixed: true,
          placement: { x, y: 59, width: 2, height: 2, shape: "round", rotation: 0 },
        },
      })),
    });
    const map = el.shadowRoot!.querySelector("wt-floor-map")!;
    await vi.waitFor(() => {
      const mapBox = map.getBoundingClientRect();
      const shapes = [...map.shadowRoot!.querySelectorAll('[part="shape"]')];
      expect(shapes).toHaveLength(3);
      let previousRight = mapBox.left;
      for (const shape of shapes) {
        const rect = shape.getBoundingClientRect();
        expect(rect.width).toBeCloseTo(size, 1);
        expect(rect.height).toBeCloseTo(size, 1);
        expect(rect.left).toBeGreaterThanOrEqual(previousRight);
        expect(rect.right).toBeLessThanOrEqual(mapBox.right);
        expect(rect.top).toBeGreaterThanOrEqual(mapBox.top);
        expect(rect.bottom).toBeLessThanOrEqual(mapBox.bottom);
        previousRight = rect.right;
      }
      expect(
        [...map.shadowRoot!.querySelectorAll('[part="name"]')].map((name) => name.textContent),
      ).toEqual(["B1", "B2", "B3"]);
    });
    await page.getByRole("button", { name: /^B2,/ }).click({ position: { x: 22, y: 5 } });
    await vi.waitFor(() => {
      expect(el.shadowRoot!.querySelector("till-seat-dialog")?.tableLabel).toBe("B2");
    });
  });

  // The map draws inside .screen, so .screen's padding alone cannot show where the map sits.
  for (const [width, left, right] of [
    [411, 8, 403],
    [1280, 40, 1240],
  ] as const) {
    it(`a planned zone's map fits its shape within the floor screen's content box at ${width}px`, async () => {
      await onPage(width);
      const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
        zones: [
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
        ],
        tables: [plannedTable],
      });
      const rect = el.shadowRoot!.querySelector("wt-floor-map")!.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(left);
      expect(rect.right).toBeLessThanOrEqual(right);
      expect(rect.width).toBeCloseTo(rect.height, 2);
      expect(rect.left + rect.width / 2).toBe((left + right) / 2);
      if (width < 600) expect({ left: rect.left, right: rect.right }).toEqual({ left, right });
    });
  }
});

const plannedTable: TableState = {
  id: "t1",
  label: "1",
  shortName: "1",
  zoneId: "z1",
  state: "free",
  condition: "free",
  hasOpenTab: false,
  pendingDeliveries: 0,
  pendingToServe: 0,
  readyToServe: 0,
  timingBand: "fresh",
  nextReservation: null,
  today: {
    placement: { x: 2, y: 3, width: 2, height: 2, shape: "round", rotation: 0 },
    seats: 4,
    fixed: false,
    takenOff: false,
    joinId: null,
    joinSeats: null,
    zoneRevision: 0,
  },
  signals: [],
  party: null,
};
