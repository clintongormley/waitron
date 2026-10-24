import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { TEXT_130_SHEET } from "@waitron/ui/test/venue-theme-fixture.js";
import type { WtFloorMap } from "@waitron/ui";
import type { StationThresholds } from "@waitron/shared";
import { cleanupWidgets, mountWidget, toggleFloorView } from "../widgets/test-helpers.js";
import "./till-floor-screen.js";
import "../widgets/station-queue.js";
import type { TillFloorScreen } from "./till-floor-screen.js";
import type { TillStationQueue } from "../widgets/station-queue.js";
import type { FloorZone, StationQueueGroup, TableState } from "../api/client.js";
import indexHtml from "../../index.html?raw";

// Vitest's own default frame, which every other case runs in.
const DEFAULT_FRAME = [414, 896] as const;

let pageStyle: HTMLStyleElement | undefined;

afterEach(async () => {
  cleanupWidgets();
  pageStyle?.remove();
  pageStyle = undefined;
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
    (sheet) => sheet !== TEXT_130_SHEET,
  );
  await page.viewport(...DEFAULT_FRAME);
});

/** Puts the till at `scale`% text: 130 adopts the real theme sheet at that size, 100 leaves Waitron's. */
async function atScale(scale: number, width: number, height: number): Promise<void> {
  if (scale === 130) document.adoptedStyleSheets = [...document.adoptedStyleSheets, TEXT_130_SHEET];
  await page.viewport(width, height);
  expect(window.innerWidth).toBe(width);
  // The page's own style (apps/till/index.html), whose padding narrows the screen on a phone.
  pageStyle = document.createElement("style");
  pageStyle.textContent = /<style>([\s\S]*?)<\/style>/.exec(indexHtml)![1]!;
  document.head.append(pageStyle);
  await document.fonts.ready;
}

/** Fails unless `text` is drawn at `sizes[scale]`, so a sheet that stopped reaching the screen cannot
 * let a 130% case pass as its 100% twin. */
function expectDrawnAt(text: HTMLElement, scale: number, sizes: Record<number, string>): void {
  expect(
    getComputedStyle(text).fontSize,
    `${text.className || text.getAttribute("part")} at ${scale}%`,
  ).toBe(sizes[scale]);
}

/** The client rects of `node`'s text, which an `overflow: hidden` ancestor does not cut down. */
function textRects(node: Node): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(node);
  return [...range.getClientRects()].filter((rect) => rect.width > 0);
}

/** "inside" when every rect lies within `outer`; otherwise how far it runs past each side. */
function within(rects: DOMRect[], outer: DOMRect): string {
  if (rects.length === 0) return "nothing drawn";
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  const past = {
    left: Math.round(outer.left - left),
    right: Math.round(right - outer.right),
    top: Math.round(outer.top - top),
    bottom: Math.round(bottom - outer.bottom),
  };
  const over = Object.entries(past).filter(([, by]) => by > 0.5);
  return over.length === 0 ? "inside" : over.map(([side, by]) => `${by}px past ${side}`).join(", ");
}

const terrace: FloorZone = {
  id: "z1",
  name: "Terrace",
  displayOrder: 0,
  active: true,
  closesAt: null,
  closed: false,
  hasPlan: false,
  layoutSetName: null,
  layoutDue: null,
  serviceMode: "table_tab",
};

/** Twelve tables, four named as the design's probe names them and the rest by number. */
const LABELS = [
  "Terrace 1",
  "2",
  "3",
  "Terrace 4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "Terrace 10",
  "11",
  "Terrace 12",
];

function floorTable(label: string, index: number, placed: boolean): TableState {
  return {
    id: `t${index + 1}`,
    label,
    zoneId: "z1",
    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: placed
      ? {
          placement: {
            x: (index % 6) * 3,
            y: Math.floor(index / 6) * 3,
            width: 2,
            height: 2,
            shape: "rect",
            rotation: 0,
          },
          seats: 4,
          fixed: false,
          takenOff: false,
          joinId: null,
          joinSeats: null,
          inJoinedTable: null,
          joined: null,
          splitOffFrom: null,
          zoneRevision: 0,
        }
      : null,
    signals: [],
    party: null,
  };
}

async function mountFloor(placed: boolean): Promise<TillFloorScreen> {
  const { el } = await mountWidget<TillFloorScreen>("till-floor-screen", {
    zones: [terrace],
    tables: LABELS.map((label, index) => floorTable(label, index, placed)),
  });
  await document.fonts.ready;
  return el;
}

/** A table card's label size on Waitron's look at each text size. */
const CARD_LABEL_SIZE: Record<number, string> = { 100: "18px", 130: "23px" };

const FLOOR_FRAMES = [
  [1280, 800],
  [390, 844],
] as const;

it.each(FLOOR_FRAMES.flatMap(([w, h]) => [100, 130].map((scale) => [w, h, scale] as const)))(
  "on the floor's list at %ix%i and %i%, every table's label lies inside its card",
  async (width, height, scale) => {
    await atScale(scale, width, height);
    const el = await mountFloor(false);
    if (el.shadowRoot!.querySelector(".grid") === null) await toggleFloorView(el);
    const cards = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".grid [data-table]")];
    expect(cards, "table cards drawn").toHaveLength(LABELS.length);
    expectDrawnAt(cards[0]!.querySelector<HTMLElement>(".label")!, scale, CARD_LABEL_SIZE);
    const seen = Object.fromEntries(
      cards.map((card) => {
        const label = card.querySelector<HTMLElement>(".label")!;
        return [label.textContent!.trim(), within(textRects(label), card.getBoundingClientRect())];
      }),
    );
    expect(seen).toEqual(Object.fromEntries(LABELS.map((label) => [label, "inside"])));
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  },
);

/** A map table's name size on Waitron's look at each text size. */
const MAP_NAME_SIZE: Record<number, string> = { 100: "14px", 130: "18px" };

it.each(FLOOR_FRAMES.flatMap(([w, h]) => [100, 130].map((scale) => [w, h, scale] as const)))(
  "on the floor's map at %ix%i and %i%, every table's name stays inside its square",
  async (width, height, scale) => {
    await atScale(scale, width, height);
    const el = await mountFloor(true);
    const map = el.shadowRoot!.querySelector<WtFloorMap>("wt-floor-map")!;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await map.updateComplete;
    const tables = [...map.shadowRoot!.querySelectorAll<HTMLElement>("[part=table]")];
    expect(tables, "tables on the map").toHaveLength(LABELS.length);
    const names = tables.map((each) => each.querySelector<HTMLElement>('[part="name"]')!);
    expectDrawnAt(names[0]!, scale, MAP_NAME_SIZE);
    const inSquare = Object.fromEntries(
      tables.map((each, index) => {
        const name = names[index]!;
        const square = each.querySelector<HTMLElement>('[part="shape"]')!.getBoundingClientRect();
        return [name.textContent!.trim(), within([name.getBoundingClientRect()], square)];
      }),
    );
    expect(inSquare).toEqual(Object.fromEntries(LABELS.map((label) => [label, "inside"])));
    // On a phone a long name may end in an ellipsis: the map's `text-overflow: ellipsis` rule.
    if (width === 1280) {
      const whole = Object.fromEntries(
        names.map((name) => [
          name.textContent!.trim(),
          within(textRects(name), name.getBoundingClientRect()),
        ]),
      );
      expect(whole).toEqual(Object.fromEntries(LABELS.map((label) => [label, "inside"])));
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  },
);

const THRESHOLDS: StationThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};

const DISHES = ["Strawberries and cream", "Mushrooms with garlic", "Elderflower lemonade"];
const STATES = ["queued", "preparing", "ready"] as const;

/** Three orders, one dish each, one in each of the kitchen's columns. */
const queue: StationQueueGroup[] = DISHES.map((name, index) => ({
  kitchenNote: null,
  orderId: `wo-${index + 1}`,
  orderNumber: 41 + index,
  label: `Table ${index + 4}`,
  queuedAt: "2026-08-17T10:00:00.000Z",
  status: "placed",
  thresholds: THRESHOLDS,
  bumpMode: "line",
  items: [
    {
      allergy: null,
      id: `ti-${index + 1}`,
      workingOrderLineId: `wol-${index + 1}`,
      state: STATES[index]!,
      name,
      quantity: "2.000",
      course: null,
      firedAt: "2026-08-17T10:00:00.000Z",
    },
  ],
}));

/** A kitchen line's dish size on Waitron's look at each text size. */
const DISH_SIZE: Record<number, string> = { 100: "14px", 130: "18px" };

it.each(
  (
    [
      [1280, 800],
      [1024, 768],
    ] as const
  ).flatMap(([w, h]) => [100, 130].map((scale) => [w, h, scale] as const)),
)(
  "on a kitchen station's queue at %ix%i and %i%, every dish lies inside its card",
  async (width, height, scale) => {
    await atScale(scale, width, height);
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: queue,
      stationId: "kitchen",
      now: Date.parse("2026-08-17T10:02:00.000Z"),
    });
    await document.fonts.ready;
    const cells = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".cell")];
    expect(cells, "kitchen cards drawn").toHaveLength(DISHES.length);
    const names = cells.map((cell) => cell.querySelector<HTMLElement>(".line-name")!);
    expectDrawnAt(names[0]!, scale, DISH_SIZE);
    const seen = Object.fromEntries(
      cells.map((cell, index) => {
        const name = names[index]!;
        // Its own box first: an ellipsis inside the card still cuts the dish off.
        const own = within(textRects(name), name.getBoundingClientRect());
        return [
          name.textContent!.trim(),
          own === "inside" ? within(textRects(name), cell.getBoundingClientRect()) : own,
        ];
      }),
    );
    expect(seen).toEqual(Object.fromEntries(DISHES.map((dish) => [`2× ${dish}`, "inside"])));
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  },
);
