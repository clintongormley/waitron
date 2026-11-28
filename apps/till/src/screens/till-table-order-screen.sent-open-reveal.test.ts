import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { DraftStore } from "../state/draft-sync.js";
import { setLocale } from "../i18n/t.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import {
  beer,
  mount,
  resized,
  scrollSettled,
  showView,
} from "./till-table-order-screen.test-helpers.js";
import { current, now, row } from "./till-table-order-screen.current-orders.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

const viewport = [innerWidth, innerHeight] as const;
beforeEach(() => setLocale("en"));
afterEach(async () => {
  cleanupWidgets();
  await page.viewport(...viewport);
});

const dishes = Array.from({ length: 16 }, (_, n) =>
  row(`l-${n}`, `Dish ${n}`, "3.000", { lineNo: n + 1 }),
);
const panel = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
const sentRow = (el: TillTableOrderScreen, n: number) =>
  panel(el).shadowRoot!.querySelector<HTMLElement>(`[data-sent-row="l-${n}"]`)!.closest("li")!;
const barTop = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector(".draft-bar")!.getBoundingClientRect().top;

/** A handheld at `width` × `height` on Order, its scroll area the window below `head` pixels, where
 * the app draws its top bar. */
async function onOrder(width: number, height: number, ungrouped = dishes, head = 0) {
  await page.viewport(width, height);
  const draft = new DraftStore();
  draft.loadFrom("draft", [{ product: beer, quantity: "1", place: { kind: "fire" } }]);
  const { el, host } = await mount({
    currentOrders: current({ groups: [], hasGroups: false, reminder: null, ungrouped }),
    groups: [],
    now,
    draftStore: draft,
    handheld: true,
  });
  host.style.width = "100vw";
  host.style.height = `calc(100vh - ${head}px)`;
  host.style.overflowY = "auto";
  if (head > 0) {
    host.style.position = "fixed";
    host.style.top = `${head}px`;
    host.style.left = "0";
  }
  await resized(el);
  await showView(el, "order", { ifShown: true, scripted: true });
  await resized(el);
  await panel(el).updateComplete;
  return { el, host };
}

/** Scrolls the list so sent row `n` ends just above the bar, as the last one showing. */
async function lastShowing(el: TillTableOrderScreen, host: HTMLElement, n: number) {
  // The bar's top moved after a first scroll here, so a second pass measures it again.
  for (let pass = 0; pass < 2; pass++) {
    host.scrollTop += sentRow(el, n).getBoundingClientRect().bottom - barTop(el) + 1;
    await scrollSettled(host);
  }
  expect(sentRow(el, n).getBoundingClientRect().bottom).toBeLessThanOrEqual(barTop(el));
  expect(sentRow(el, n + 1).getBoundingClientRect().top).toBeGreaterThan(barTop(el) - 2);
}

async function open(el: TillTableOrderScreen, host: HTMLElement, n: number) {
  await userEvent.click(
    panel(el).shadowRoot!.querySelector<HTMLElement>(`[data-sent-row="l-${n}"]`)!,
  );
  await panel(el).updateComplete;
  await scrollSettled(host);
}

const gapOf = (el: TillTableOrderScreen, token: "--wt-space-1" | "--wt-space-2") => {
  const gap = Number.parseFloat(getComputedStyle(el).getPropertyValue(token));
  expect(gap).toBeGreaterThan(0);
  return gap;
};

/** The last Serve button's foot stops --wt-space-1 above the bar's top, the dish's own line
 * showing whole below the top of the scroll area; Dish details may sit under the bar. */
function expectAboveBar(el: TillTableOrderScreen, host: HTMLElement, box: HTMLElement) {
  const top = barTop(el);
  const gap = gapOf(el, "--wt-space-1");
  const serves = [...box.querySelectorAll("[data-sent-serve]")];
  expect(serves.length).toBeGreaterThan(0);
  const foot = serves.at(-1)!.getBoundingClientRect().bottom;
  expect(top - foot).toBeGreaterThanOrEqual(gap - 0.5);
  expect(top - foot).toBeLessThanOrEqual(gap + 1.5);
  for (const serve of serves) expect(serve.getBoundingClientRect().bottom).toBeLessThanOrEqual(top);
  const name = box.querySelector(".row-name")!.getBoundingClientRect();
  expect(name.top).toBeGreaterThanOrEqual(host.getBoundingClientRect().top);
  expect(name.bottom).toBeLessThanOrEqual(top);
}

it("on a handheld turned sideways, a sent row opened low in the list brings its Serve buttons above the bar", async () => {
  const { el, host } = await onOrder(844, 390);
  const n = 4;
  await lastShowing(el, host, n);
  const before = host.scrollTop;
  await open(el, host, n);
  expect(sentRow(el, n).hasAttribute("data-open")).toBe(true);
  expect(host.scrollTop).toBeGreaterThan(before);
  expectAboveBar(el, host, sentRow(el, n));
});

it("a sent row opened upright is brought back above the bar when the handheld turns sideways", async () => {
  const { el, host } = await onOrder(390, 844);
  const n = 8;
  await lastShowing(el, host, n);
  await open(el, host, n);
  expectAboveBar(el, host, sentRow(el, n));
  await page.viewport(844, 390);
  await resized(el);
  await resized(el);
  await scrollSettled(host);
  expect(sentRow(el, n).hasAttribute("data-open")).toBe(true);
  expectAboveBar(el, host, sentRow(el, n));
});

it("a sent row with nothing to serve, opened low, brings its box's foot above the bar", async () => {
  const { el, host } = await onOrder(
    844,
    390,
    dishes.map((dish) => ({ ...dish, released: false })),
  );
  const n = 4;
  await lastShowing(el, host, n);
  await open(el, host, n);
  const box = sentRow(el, n);
  expect(box.hasAttribute("data-open")).toBe(true);
  expect(box.querySelector("[data-sent-serve]")).toBeNull();
  const gap = (top: number) => top - box.getBoundingClientRect().bottom;
  expect(gap(barTop(el))).toBeGreaterThanOrEqual(gapOf(el, "--wt-space-2") - 0.5);
  expect(gap(barTop(el))).toBeLessThanOrEqual(gapOf(el, "--wt-space-2") + 1.5);
});

describe("on a handheld turned sideways, with the strip the app leaves above the bar", () => {
  // In the app at 844 × 390 the order shows about 118 px between the top bar and the draft bar;
  // this screen alone draws no total under its bar, so its scroll area starts lower to match.
  const head = 141;
  const noted = dishes.map((dish, n) =>
    n === 4 ? { ...dish, note: "no onions, sauce on the side, well done please" } : dish,
  );
  const visibleTop = (host: HTMLElement) => host.getBoundingClientRect().top + host.clientTop;

  it("a sent dish whose line runs to two lines, opened low, keeps its line in view, its Serve buttons giving way", async () => {
    const { el, host } = await onOrder(844, 390, noted, head);
    const n = 4;
    await lastShowing(el, host, n);
    const strip = barTop(el) - visibleTop(host);
    expect(strip).toBeGreaterThan(110);
    expect(strip).toBeLessThan(130);
    const before = host.scrollTop;
    await open(el, host, n);
    const box = sentRow(el, n);
    expect(box.hasAttribute("data-open")).toBe(true);
    const line = box.querySelector("[data-sent-row] .row-text")!.getBoundingClientRect();
    const name = box.querySelector(".row-name")!.getBoundingClientRect();
    const more = box.querySelector(".row-more")!.getBoundingClientRect();
    expect(more.top).toBeGreaterThanOrEqual(name.bottom - 0.5);
    const serve = [...box.querySelectorAll("[data-sent-serve]")].at(-1)!.getBoundingClientRect();
    // Line and buttons cannot both show between the scroll area's top and the bar.
    expect(serve.bottom - line.top + gapOf(el, "--wt-space-1")).toBeGreaterThan(
      barTop(el) - visibleTop(host),
    );
    expect(host.scrollTop).toBeGreaterThan(before);
    expect(line.top).toBeGreaterThanOrEqual(visibleTop(host) - 0.5);
    expect(line.top).toBeLessThanOrEqual(visibleTop(host) + 1.5);
    expect(name.top).toBeGreaterThanOrEqual(visibleTop(host));
  });

  it("a one-line sent dish, opened low, still brings its Serve buttons above the bar", async () => {
    const { el, host } = await onOrder(844, 390, dishes, head);
    const n = 4;
    await lastShowing(el, host, n);
    const before = host.scrollTop;
    await open(el, host, n);
    expect(sentRow(el, n).hasAttribute("data-open")).toBe(true);
    expect(host.scrollTop).toBeGreaterThan(before);
    expectAboveBar(el, host, sentRow(el, n));
  });
});
