import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import {
  cleanupWidgets,
  distance,
  mountWidget,
  pageAt,
  paintedAt,
  resetPage,
  rgb,
} from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { DraftStore } from "../state/draft-sync.js";
import type { TillSentOrders } from "../widgets/sent-orders.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import {
  beer,
  menuOf,
  mount,
  resized,
  showView,
  tap,
} from "./till-table-order-screen.test-helpers.js";
import {
  footerBalance,
  footerBill,
  footerParty,
} from "./till-table-order-screen.panel-footer.test-helpers.js";
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

  it("keeps Send all on screen without scrolling on the phone's Order view, with a long order", async () => {
    const { el, host } = await orderedInWindow(390, 700);
    el.shadowRoot!.querySelector<HTMLElement>("[data-view=order]")!.click();
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

  it("keeps Send all on screen on the phone's Order view with twenty sent dishes listed above a short order", async () => {
    const { el, host } = await orderedInWindow(
      390,
      700,
      { currentOrders: longSent },
      dishes.slice(0, 2),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-view=order]")!.click();
    await el.updateComplete;
    await sentExpanded(el);
    await linesRendered(el);
    host.scrollTop = 0;

    expect(host.scrollHeight).toBeGreaterThan(host.clientHeight);
    expectInside(el.shadowRoot!.querySelector('[data-draft-action="send-all"]')!, host);
  });

  it("shuts and fades the menu and the order, the bar included, while a round is being sent", async () => {
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
      [
        root.querySelector("till-menu-browser")!,
        basket,
        root.querySelector(".draft-actions")!,
        root.querySelector("[data-draft-move]")!,
      ].map(drawnFaded);
    remove().focus();
    expect(remove().getRootNode()).toHaveProperty("activeElement", remove());
    expect(faded()).toEqual([false, false, false, false]);
    remove().blur();

    el.draftStore!.sending = true;
    await el.updateComplete;
    await basket.updateComplete;
    remove().focus();

    expect(remove().getRootNode()).toHaveProperty("activeElement", null);
    expect(faded()).toEqual([true, true, true, true]);
  });
});

/**
 * The screen inside a copy of the shell's region (`till-shell.ts` `.region`, `.body`, `.drill`): a
 * positioned column of the page's height whose scrolling area holds the screen, and an overlay over
 * it, hidden until a case opens it.
 */
async function inShell(height: number) {
  const { el: region } = await mountWidget<HTMLDivElement>("div", {}, "light");
  region.style.cssText = `position: relative; display: flex; flex-direction: column; height: ${height}px`;
  const area = document.createElement("div");
  area.style.cssText = "flex: 1; min-height: 0; overflow: auto";
  const overlay = document.createElement("div");
  overlay.hidden = true;
  // A colour nothing in the bar is painted with, so the painted check cannot pass by accident.
  overlay.style.cssText =
    "position: absolute; inset: 0; overflow: auto; background: var(--wt-color-warning)";
  const screen = document.createElement("till-table-order-screen") as TillTableOrderScreen;
  Object.assign(screen, {
    products: dishes,
    menus: menuOf(dishes),
    lines: [],
    orderId: "wo-4",
    draftStore: new DraftStore(),
  });
  area.append(screen);
  region.append(area, overlay);
  await resized(screen);
  for (const dish of dishes) await tap(screen, dish.name);
  await linesRendered(screen);
  return { screen, area, overlay };
}

describe("till-table-order-screen: the unsent order's action bar under the shell's overlay", () => {
  afterEach(resetPage);

  for (const [width, height] of [
    [1024, 768],
    [390, 844],
  ] as const) {
    it(`is drawn under an overlay (${width} px)`, async () => {
      await pageAt(width, height);
      const { screen, area, overlay } = await inShell(height);
      if (width === 390) {
        screen.shadowRoot!.querySelector<HTMLElement>("[data-view=order]")!.click();
        await screen.updateComplete;
        await linesRendered(screen);
      }
      const sendAll = screen.shadowRoot!.querySelector<HTMLElement>(
        '[data-draft-action="send-all"]',
      )!;
      const box = sendAll.getBoundingClientRect();
      // Inside the button's padding, clear of its words.
      const point = { x: box.left + 4, y: box.top + box.height / 2 };
      // The point read must be on screen, inside the region, or the screenshot has no pixel there.
      expect(box.height).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(area.getBoundingClientRect().bottom);
      const face = rgb(
        getComputedStyle(sendAll.shadowRoot!.querySelector("button")!).backgroundColor,
      );
      const warning = rgb(getComputedStyle(overlay).backgroundColor);
      expect(distance(face, warning)).toBeGreaterThan(40);
      expect(distance(await paintedAt(area.parentElement!, point.x, point.y), face)).toBeLessThan(
        4,
      );

      overlay.hidden = false;
      expect(
        distance(await paintedAt(area.parentElement!, point.x, point.y), warning),
      ).toBeLessThan(4);
      expect(getComputedStyle(screen).isolation).toBe("isolate");
    });
  }
});

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

/** The basket row of the line added last. */
function newestEntry(el: TillTableOrderScreen): HTMLElement {
  const store = el.draftStore!;
  const index = store.lines.indexOf(store.lastAdded!);
  for (const basket of el.shadowRoot!.querySelectorAll("till-basket")) {
    const entry = basket
      .shadowRoot!.querySelector(`[data-line-detail="${index}"]`)
      ?.closest<HTMLElement>(".entry");
    if (entry) return entry;
  }
  throw new Error(`No row for line ${index}`);
}

function expectClearOfBar(el: TillTableOrderScreen, host: HTMLElement): void {
  const line = newestEntry(el).getBoundingClientRect();
  const sendAll = el.shadowRoot!.querySelector('[data-draft-action="send-all"]')!;
  const bar = el.shadowRoot!.querySelector(".draft-bar")!.getBoundingClientRect();
  const area = host.getBoundingClientRect();
  expect(line.height).toBeGreaterThan(0);
  expect(line.top).toBeGreaterThanOrEqual(area.top);
  expect(line.bottom).toBeLessThanOrEqual(sendAll.getBoundingClientRect().top);
  expect(line.bottom).toBeLessThanOrEqual(bar.top);
}

describe("till-table-order-screen: a newly added line is not hidden behind the action bar", () => {
  it("shows the newest line above the bar at 1024 × 768 when it is added below the window's foot", async () => {
    const { el, host } = await orderedInWindow(1024, 768);
    await linesRendered(el);
    await scrollSettled(host);

    expect(host.scrollTop).toBeGreaterThan(0);
    expectClearOfBar(el, host);
  });

  it("shows the newest line above the bar after the bar grows while drawn", async () => {
    const { el, host } = await orderedInWindow(1024, 768, {}, dishes.slice(0, -1));
    const bar = el.shadowRoot!.querySelector(".draft-bar")!;
    const before = bar.getBoundingClientRect().height;
    // Stands in for the bar's buttons wrapping onto another row: the bar's padding reads this.
    host.style.setProperty("--wt-space-2", "40px");
    await resized(el);
    expect(bar.getBoundingClientRect().height).toBeGreaterThan(before + 50);

    await tap(el, dishes.at(-1)!.name);
    await linesRendered(el);
    await scrollSettled(host);

    expect(host.scrollTop).toBeGreaterThan(0);
    expectClearOfBar(el, host);
  });
});

/** Twenty sent dishes listed and two unsent, on a part-paid bill with Full invoice, two receipt
 * languages and a saved full-invoice customer, on Order, scrolled to the top. */
async function longBill(over: Partial<TillTableOrderScreen>) {
  const { el, host } = await orderedInWindow(
    390,
    700,
    {
      currentOrders: longSent,
      fullInvoices: true,
      receiptLanguages: ["es-ES", "en-GB"],
      party: footerParty,
      bills: [
        {
          ...footerBill,
          outstanding: "8.00",
          hasPayments: true,
          invoiceType: "F1",
          recipient: {
            taxId: "B12345674",
            legalName: "Cliente SL",
            address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
            countryCode: "ES",
          },
        },
      ],
      billBalance: footerBalance,
      ...over,
    },
    dishes.slice(0, 2),
  );
  await showView(el, "order");
  await sentExpanded(el);
  await linesRendered(el);
  host.scrollTop = 0;
  await resized(el);
  expect(host.scrollHeight).toBeGreaterThan(host.clientHeight);
  return { el, host };
}

describe("till-table-order-screen: the fixed foot on a handheld", () => {
  it("a handheld's Order foot: only Total, Still to pay and Pay stay in the window over a long Order", async () => {
    const { el, host } = await longBill({ handheld: true });
    const root = el.shadowRoot!;
    const foot = root.querySelector<HTMLElement>("[data-order-foot]")!;
    const box = foot.getBoundingClientRect();
    const area = host.getBoundingClientRect();

    expect(box.top).toBeGreaterThanOrEqual(area.top);
    expect(Math.abs(box.bottom - area.bottom)).toBeLessThanOrEqual(1);
    for (const kept of ["[data-order-total]", "[data-party-outstanding]", "[data-pay-sheet]"])
      expect(foot.querySelector(kept)).not.toBeNull();
    for (const before of [
      "[data-choose-bill-invoice]",
      "[data-choose-bill-language]",
      "[data-invoice-choice]",
      "[data-bill-payments] > .amount",
      "[data-bill-received]",
      "[data-bill-actions] h2",
    ]) {
      const part = root.querySelector(before)!;
      expect(part, before).not.toBeNull();
      expect(foot.contains(part), before).toBe(false);
      expect(part.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("a handheld's Order foot: Send all rides just above the foot", async () => {
    const { el } = await longBill({ handheld: true });
    const foot = el.shadowRoot!.querySelector("[data-order-foot]")!.getBoundingClientRect();
    const bar = el.shadowRoot!.querySelector(".draft-bar")!.getBoundingClientRect();

    expect(bar.height).toBeGreaterThan(0);
    expect(Math.abs(bar.bottom - foot.top)).toBeLessThanOrEqual(1);
  });

  it("a handheld's Order foot: the quiet sentence shows inside the foot", async () => {
    const { el, host } = await longBill({ handheld: true });
    const root = el.shadowRoot!;
    await userEvent.click(root.querySelector<HTMLElement>("[data-pay-sheet]")!);
    const alert = await vi.waitFor(() => root.querySelector("[data-pay-unsent]")!);
    await resized(el);

    expect(root.querySelector("[data-order-foot]")!.contains(alert)).toBe(true);
    expectInside(alert, host);
  });

  it("a handheld's Order foot: a till below 720 px, and a handheld drawing the whole tender, keep today's foot", async () => {
    // Not part-paid, so the till draws the tender rather than Pay the rest.
    const bills = [footerBill];
    for (const over of [
      { handheld: false, bills },
      {
        handheld: true,
        bills,
        paymentConfirmation: {
          tender: { method: "cash" as const, amount: "10.00" },
          outstanding: "10.00",
          guestCount: 3,
        },
      },
    ]) {
      const { el } = await longBill(over);
      const root = el.shadowRoot!;

      expect(
        root.querySelector("[data-bill-actions] till-tender-pay"),
        JSON.stringify(over),
      ).not.toBeNull();
      expect(root.querySelector("[data-order-foot]"), JSON.stringify(over)).toBeNull();
      cleanupWidgets();
    }
  });

  it("Send all goes when the New order is empty, and a till keeps it", async () => {
    const { el } = await longBill({ handheld: true });
    const root = el.shadowRoot!;
    expect(root.querySelector("[data-draft-action]")).not.toBeNull();
    el.draftStore!.clear();
    await resized(el);

    expect(root.querySelector("[data-draft-action]")).toBeNull();
    expect(root.querySelector("[data-order-foot]")).not.toBeNull();
    cleanupWidgets();

    const till = (await longBill({ handheld: false })).el;
    till.draftStore!.clear();
    await resized(till);
    const actions = [...till.shadowRoot!.querySelectorAll("[data-draft-action]")];
    expect(actions).toHaveLength(2);
    for (const action of actions) expect(action.hasAttribute("disabled")).toBe(true);
  });

  it("the newest line is not hidden behind the bar or the foot", async () => {
    const { el, host } = await orderedInWindow(390, 700, { handheld: true }, dishes.slice(0, -1));
    await showView(el, "order");
    await linesRendered(el);
    host.scrollTop = 0;
    await resized(el);
    expect(el.shadowRoot!.querySelector("[data-order-foot]")).not.toBeNull();

    await tap(el, dishes.at(-1)!.name);
    await linesRendered(el);
    await scrollSettled(host);

    expect(host.scrollTop).toBeGreaterThan(0);
    expectClearOfBar(el, host);
  });
});
