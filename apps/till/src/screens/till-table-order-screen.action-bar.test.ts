import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import { beer, menuOf, mount, resized, tap } from "./till-table-order-screen.test-helpers.js";
import {
  current,
  currentGroup,
  row,
} from "./till-table-order-screen.current-orders.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

const dishes = Array.from({ length: 12 }, (_, n) => ({
  ...beer,
  id: `dish-${n}`,
  menuItemId: `offer-dish-${n}`,
  name: `Dish ${n}`,
}));

/** Twenty dishes already sent, in one fired group. */
const longSent = current({
  reminder: null,
  groups: [
    currentGroup(
      "g1",
      1,
      "fired",
      Array.from({ length: 20 }, (_, n) => row(`l-sent-${n}`, `Sent dish ${n}`, "1.000")),
    ),
  ],
  ungrouped: [],
});

/** Mounts the screen in a scroll area shaped like the till shell's body, with `ordered` dishes
 * ordered (every dish unless given). */
async function orderedInWindow(
  width: number,
  height: number,
  over: Partial<TillTableOrderScreen> = {},
  ordered = dishes,
) {
  const { el, host } = await mount({ products: dishes, menus: menuOf(dishes), ...over });
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  host.style.overflowY = "auto";
  await resized(el);
  for (const dish of ordered) await tap(el, dish.name);
  return { el, host };
}

/** Opens the Sent panel so every sent dish is listed above the unsent order. */
async function sentExpanded(el: TillTableOrderScreen): Promise<void> {
  const panel = el.shadowRoot!.querySelector<TillSentOrders>("till-sent-orders")!;
  await panel.updateComplete;
  const toggle = panel.shadowRoot!.querySelector<HTMLElement>("[data-sent-toggle]")!;
  if (toggle.getAttribute("aria-expanded") === "false") await userEvent.click(toggle);
  await panel.updateComplete;
  expect(panel.shadowRoot!.querySelectorAll("[data-fired-line]")).toHaveLength(20);
  await resized(el);
}

async function linesRendered(el: TillTableOrderScreen): Promise<void> {
  for (const basket of el.shadowRoot!.querySelectorAll<
    HTMLElement & { updateComplete: Promise<unknown> }
  >("till-basket"))
    await basket.updateComplete;
  await resized(el);
}

function expectInside(button: Element, host: HTMLElement): void {
  const box = button.getBoundingClientRect();
  const area = host.getBoundingClientRect();
  expect(box.height).toBeGreaterThan(0);
  expect(box.top).toBeGreaterThanOrEqual(area.top);
  expect(box.bottom).toBeLessThanOrEqual(area.bottom);
}

/** Whether `part` or an ancestor that draws a box is translucent: a `display: contents` element's
 * opacity paints nothing. */
function drawnFaded(part: Element): boolean {
  for (let at: Element | null = part; at !== null; at = at.parentElement) {
    const style = getComputedStyle(at);
    if (style.display !== "contents" && Number(style.opacity) < 1) return true;
  }
  return false;
}

describe("till-table-order-screen: the unsent order's action bar stays in the window", () => {
  it("keeps Send all on screen without scrolling at 1024 × 768, with a long order beside the menu", async () => {
    const { el, host } = await orderedInWindow(1024, 768);
    await linesRendered(el);

    expect(host.scrollHeight).toBeGreaterThan(host.clientHeight);
    expect(host.scrollTop).toBe(0);
    expectInside(el.shadowRoot!.querySelector('[data-draft-action="send-all"]')!, host);
  });

  it("keeps Send all on screen without scrolling on the phone's Review view, with a long order", async () => {
    const { el, host } = await orderedInWindow(390, 700);
    el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]")!.click();
    await el.updateComplete;
    await linesRendered(el);
    host.scrollTop = 0;

    expect(host.scrollHeight).toBeGreaterThan(host.clientHeight);
    expectInside(el.shadowRoot!.querySelector('[data-draft-action="send-all"]')!, host);
  });

  it("keeps Send all on screen at 1024 × 768 with twenty sent dishes listed above a short order", async () => {
    const { el, host } = await orderedInWindow(
      1024,
      768,
      { currentOrders: longSent },
      dishes.slice(0, 2),
    );
    await sentExpanded(el);
    await linesRendered(el);
    host.scrollTop = 0;

    expect(host.scrollHeight).toBeGreaterThan(host.clientHeight);
    expectInside(el.shadowRoot!.querySelector('[data-draft-action="send-all"]')!, host);
  });

  it("keeps Send all on screen on the phone's Review view with twenty sent dishes listed above a short order", async () => {
    const { el, host } = await orderedInWindow(
      390,
      700,
      { currentOrders: longSent },
      dishes.slice(0, 2),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]")!.click();
    await el.updateComplete;
    await sentExpanded(el);
    await linesRendered(el);
    host.scrollTop = 0;

    expect(host.scrollHeight).toBeGreaterThan(host.clientHeight);
    expectInside(el.shadowRoot!.querySelector('[data-draft-action="send-all"]')!, host);
  });

  it("shuts and fades the order, the bar included, while a round is being sent", async () => {
    const { el } = await orderedInWindow(
      1024,
      768,
      { currentOrders: longSent },
      dishes.slice(0, 2),
    );
    await linesRendered(el);
    const root = el.shadowRoot!;
    const basket = root.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "[data-round-controls] till-basket",
    )!;
    const remove = () =>
      basket
        .shadowRoot!.querySelector<HTMLElement>("wt-button.remove")!
        .shadowRoot!.querySelector<HTMLElement>("button")!;
    const faded = () =>
      [basket, root.querySelector(".draft-actions")!, root.querySelector("[data-draft-move]")!].map(
        drawnFaded,
      );
    remove().focus();
    expect(remove().getRootNode()).toHaveProperty("activeElement", remove());
    expect(faded()).toEqual([false, false, false]);
    remove().blur();

    el.draftStore!.sending = true;
    await el.updateComplete;
    await basket.updateComplete;
    remove().focus();

    expect(remove().getRootNode()).toHaveProperty("activeElement", null);
    expect(faded()).toEqual([true, true, true]);
  });
});
