import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { DraftStore } from "../state/draft-sync.js";
import { setLocale } from "../i18n/t.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { beer, mount, resized, showView } from "./till-table-order-screen.test-helpers.js";
import { current, now, row } from "./till-table-order-screen.current-orders.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

const viewport = [innerWidth, innerHeight] as const;
beforeEach(() => setLocale("en"));
afterEach(async () => {
  cleanupWidgets();
  await page.viewport(...viewport);
});

const dishes = Array.from({ length: 8 }, (_, n) =>
  row(`l-${n}`, `Dish ${n}`, "3.000", { lineNo: n + 1 }),
);
const panel = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
const sentRow = (el: TillTableOrderScreen, n: number) =>
  panel(el).shadowRoot!.querySelector<HTMLElement>(`[data-sent-row="l-${n}"]`)!.closest("li")!;
const barTop = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector(".draft-bar")!.getBoundingClientRect().top;

/** Waits until the scroll area has stopped moving, so a smooth reveal has finished. */
async function scrollSettled(host: HTMLElement): Promise<void> {
  let still = 0;
  let last = host.scrollTop;
  for (let frame = 0; frame < 300 && still < 10; frame++) {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    still = host.scrollTop === last ? still + 1 : 0;
    last = host.scrollTop;
  }
}

it("on a handheld turned sideways, a sent row opened low in the list brings its Serve buttons above the bar", async () => {
  await page.viewport(844, 390);
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
  const n = 4;
  // The row ends just above the bar, as the last sent row showing.
  for (let pass = 0; pass < 2; pass++) {
    host.scrollTop += sentRow(el, n).getBoundingClientRect().bottom - barTop(el) + 1;
    await scrollSettled(host);
  }
  expect(sentRow(el, n).getBoundingClientRect().bottom).toBeLessThanOrEqual(barTop(el));
  const before = host.scrollTop;
  await userEvent.click(
    panel(el).shadowRoot!.querySelector<HTMLElement>(`[data-sent-row="l-${n}"]`)!,
  );
  await panel(el).updateComplete;
  await scrollSettled(host);
  const box = sentRow(el, n);
  expect(box.hasAttribute("data-open")).toBe(true);
  expect(host.scrollTop).toBeGreaterThan(before);
  const top = barTop(el);
  const gap = Number.parseFloat(getComputedStyle(el).getPropertyValue("--wt-space-2"));
  expect(gap).toBeGreaterThan(0);
  const foot = box.getBoundingClientRect().bottom;
  expect(top - foot).toBeGreaterThanOrEqual(gap - 0.5);
  expect(top - foot).toBeLessThanOrEqual(gap + 1.5);
  for (const serve of box.querySelectorAll("[data-sent-serve]"))
    expect(serve.getBoundingClientRect().bottom).toBeLessThanOrEqual(top);
});
