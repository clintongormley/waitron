import { afterEach, beforeEach, expect, it } from "vitest";
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

/** A handheld at `width` × `height` on Order, its scroll area the window. */
async function onOrder(width: number, height: number) {
  await page.viewport(width, height);
  const draft = new DraftStore();
  draft.loadFrom("draft", [{ product: beer, quantity: "1", place: { kind: "fire" } }]);
  const { el, host } = await mount({
    currentOrders: current({ groups: [], hasGroups: false, reminder: null, ungrouped: dishes }),
    groups: [],
    now,
    draftStore: draft,
    handheld: true,
  });
  host.style.width = "100vw";
  host.style.height = "100vh";
  host.style.overflowY = "auto";
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

/** The box's foot stops --wt-space-2 above the bar's top, and so do its Serve buttons. */
function expectAboveBar(el: TillTableOrderScreen, box: HTMLElement) {
  const top = barTop(el);
  const gap = Number.parseFloat(getComputedStyle(el).getPropertyValue("--wt-space-2"));
  expect(gap).toBeGreaterThan(0);
  const foot = box.getBoundingClientRect().bottom;
  expect(top - foot).toBeGreaterThanOrEqual(gap - 0.5);
  expect(top - foot).toBeLessThanOrEqual(gap + 1.5);
  const serves = [...box.querySelectorAll("[data-sent-serve]")];
  expect(serves.length).toBeGreaterThan(0);
  for (const serve of serves) expect(serve.getBoundingClientRect().bottom).toBeLessThanOrEqual(top);
}

it("on a handheld turned sideways, a sent row opened low in the list brings its Serve buttons above the bar", async () => {
  const { el, host } = await onOrder(844, 390);
  const n = 4;
  await lastShowing(el, host, n);
  const before = host.scrollTop;
  await open(el, host, n);
  expect(sentRow(el, n).hasAttribute("data-open")).toBe(true);
  expect(host.scrollTop).toBeGreaterThan(before);
  expectAboveBar(el, sentRow(el, n));
});

it("a sent row opened upright is brought back above the bar when the handheld turns sideways", async () => {
  const { el, host } = await onOrder(390, 844);
  const n = 8;
  await lastShowing(el, host, n);
  await open(el, host, n);
  expectAboveBar(el, sentRow(el, n));
  await page.viewport(844, 390);
  await resized(el);
  await resized(el);
  await scrollSettled(host);
  expect(sentRow(el, n).hasAttribute("data-open")).toBe(true);
  expectAboveBar(el, sentRow(el, n));
});
