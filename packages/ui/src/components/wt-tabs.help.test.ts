import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, host } from "../test-helpers.js";
import { mountThemed } from "../a11y-helpers.js";
import { setHelpMode } from "../help-mode.js";
import type { WtHelpTooltip } from "./wt-help-tooltip.js";
import type { TabItem, WtTabs } from "./wt-tabs.js";
import "./wt-tabs.js";

afterEach(() => {
  cleanup();
  setHelpMode(false);
});

const help = { text: "Dishes waiting for the kitchen.", label: "Help: Menus" };
const markup = `<wt-tabs label="Venue operations"><div slot="status">Ready</div><div slot="menus">Menus</div><div slot="routes">Routing</div></wt-tabs>`;

function items(withHelp = true): TabItem[] {
  return [
    { key: "status", label: "Status" },
    { key: "menus", label: "Menus", ...(withHelp ? { help } : {}) },
    { key: "routes", label: "Preparation routing" },
  ];
}

async function setup(list: TabItem[] = items(), width?: string): Promise<WtTabs> {
  const el = (await mountThemed(markup)) as WtTabs;
  if (width) host.style.width = width;
  el.items = list;
  await el.updateComplete;
  return el;
}

function badgeOf(el: WtTabs): WtHelpTooltip {
  return el.shadowRoot!.querySelector<WtHelpTooltip>("wt-help-tooltip")!;
}

function badgeButton(el: WtTabs): HTMLButtonElement {
  return badgeOf(el).shadowRoot!.querySelector("button")!;
}

function stripOf(el: WtTabs): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>('[role="tablist"]')!;
}

function tabs(el: WtTabs): HTMLButtonElement[] {
  return [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
}

async function turnHelp(on: boolean, el: WtTabs): Promise<void> {
  setHelpMode(on);
  await badgeOf(el)?.updateComplete;
  await el.updateComplete;
}

function frame(): Promise<number> {
  return new Promise(requestAnimationFrame);
}

function centreOf(element: Element): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

function layout(el: WtTabs) {
  return {
    tabs: tabs(el).map((tab) => {
      const { left, top, width, height } = tab.getBoundingClientRect();
      return { left, top, width, height };
    }),
    row: el.shadowRoot!.querySelector(".tab-row")!.getBoundingClientRect().height,
  };
}

test("a tab with help hangs a badge over its label's top trailing corner while help is on", async () => {
  const el = await setup();
  await turnHelp(true, el);
  const label = el.shadowRoot!.querySelector(".tab-label")!.getBoundingClientRect();
  const centre = centreOf(badgeButton(el));
  expect(Math.abs(centre.x - label.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(centre.y - label.top)).toBeLessThanOrEqual(1);
});

test("the badge is outside the tablist", async () => {
  const el = await setup();
  await turnHelp(true, el);
  expect(badgeOf(el)).not.toBeNull();
  expect(badgeOf(el).closest('[role="tablist"]')).toBeNull();
});

test("it moves nothing", async () => {
  const plain = await setup(items(false));
  expect(plain.shadowRoot!.querySelector(".tab-label")).toBeNull();
  expect(plain.shadowRoot!.querySelector("wt-help-tooltip")).toBeNull();
  const before = layout(plain);
  cleanup();

  const el = await setup();
  for (const on of [false, true]) {
    await turnHelp(on, el);
    expect(layout(el)).toEqual(before);
  }
});

test("it follows its tab when the strip scrolls", async () => {
  const el = await setup(items(), "220px");
  await turnHelp(true, el);
  await frame();
  await frame();
  const strip = stripOf(el);
  expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth + 40);
  const start = strip.scrollLeft;
  const before = centreOf(badgeButton(el));
  strip.scrollLeft += 40;
  await vi.waitFor(() => expect(strip.scrollLeft).toBe(start + 40));
  await frame();
  await frame();
  const after = centreOf(badgeButton(el));
  expect(Math.abs(before.x - after.x - 40)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(1);
});

test("a badge whose tab is scrolled out of view is hidden and cannot be focused", async () => {
  const el = await setup(
    [
      { key: "status", label: "Status" },
      { key: "menus", label: "Menus" },
      { key: "routes", label: "Preparation routing", help },
    ],
    "200px",
  );
  await turnHelp(true, el);
  const badge = badgeOf(el);
  expect(getComputedStyle(badge).visibility).toBe("hidden");
  badgeButton(el).focus();
  expect(badge.shadowRoot!.activeElement).toBeNull();
  expect(el.shadowRoot!.activeElement).toBeNull();
});

test("a strip drawn with help already on starts with an out-of-view badge hidden", async () => {
  setHelpMode(true);
  const errors: string[] = [];
  const onError = (event: ErrorEvent) => errors.push(event.message);
  window.addEventListener("error", onError);
  try {
    const el = await setup(
      [
        { key: "status", label: "Status" },
        { key: "menus", label: "Menus" },
        { key: "routes", label: "Preparation routing", help },
      ],
      "200px",
    );
    await badgeOf(el).updateComplete;
    await frame();
    expect(badgeOf(el).hasAttribute("data-out-of-view")).toBe(true);
    expect(getComputedStyle(badgeOf(el)).visibility).toBe("hidden");
    expect(errors).toEqual([]);
  } finally {
    window.removeEventListener("error", onError);
  }
});

test("an open badge scrolled out of view closes its box and hands focus to the selected tab", async () => {
  const el = await setup(
    [
      { key: "status", label: "Status", help: { ...help, label: "Help: Status" } },
      { key: "menus", label: "Menus" },
      { key: "routes", label: "Preparation routing" },
    ],
    "220px",
  );
  await turnHelp(true, el);
  await frame();
  const badge = badgeOf(el);
  const popup = badge.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  await userEvent.click(page.elementLocator(badgeButton(el)));
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
  await badge.updateComplete;
  expect(badgeButton(el).getAttribute("aria-expanded")).toBe("true");
  expect(badge.shadowRoot!.activeElement).toBe(badgeButton(el));

  const strip = stripOf(el);
  strip.scrollLeft = strip.scrollWidth;
  await vi.waitFor(() => expect(badge.hasAttribute("data-out-of-view")).toBe(true));
  expect(popup.matches(":popover-open")).toBe(false);
  await vi.waitFor(() => expect(badgeButton(el).getAttribute("aria-expanded")).toBe("false"));
  expect(badge.shadowRoot!.activeElement).toBeNull();
  expect(el.shadowRoot!.activeElement).toBe(tabs(el)[0]);
  expect(strip.scrollLeft).toBeGreaterThan(0);

  strip.scrollLeft = 0;
  await vi.waitFor(() => expect(badge.hasAttribute("data-out-of-view")).toBe(false));
  await frame();
  await frame();
  await badge.updateComplete;
  expect(popup.matches(":popover-open")).toBe(false);
  expect(badgeButton(el).getAttribute("aria-expanded")).toBe("false");
});

test("tapping the badge opens its box and does not select the tab", async () => {
  const el = await setup();
  await turnHelp(true, el);
  const listener = vi.fn();
  el.addEventListener("wt-tab-change", listener);
  await userEvent.click(page.elementLocator(badgeButton(el)));
  const popup = badgeOf(el).shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
  await el.updateComplete;
  expect(listener).not.toHaveBeenCalled();
  expect(el.value).toBe("");
  expect(tabs(el)[0]!.getAttribute("aria-selected")).toBe("true");
});

test("in a right-to-left page it hangs over the label's top left corner", async () => {
  const el = await setup();
  el.setAttribute("dir", "rtl");
  await turnHelp(true, el);
  await frame();
  const label = el.shadowRoot!.querySelector(".tab-label")!.getBoundingClientRect();
  const centre = centreOf(badgeButton(el));
  expect(Math.abs(centre.x - label.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(centre.y - label.top)).toBeLessThanOrEqual(1);
});

test("while help is off it cannot be reached; with help on, Tab goes from the selected tab to the badges", async () => {
  const el = await setup();
  const badge = badgeOf(el);
  expect(badge.checkVisibility()).toBe(false);
  badgeButton(el).focus();
  expect(badge.shadowRoot!.activeElement).toBeNull();

  tabs(el)[0]!.focus();
  await userEvent.tab();
  expect(badge.shadowRoot!.activeElement).toBeNull();

  await turnHelp(true, el);
  tabs(el)[0]!.focus();
  await userEvent.tab();
  expect(el.shadowRoot!.activeElement).toBe(badge);
  expect(badge.shadowRoot!.activeElement).toBe(badgeButton(el));
});

test("the badge takes its name from help.label, and the tab's own name is unchanged", async () => {
  const el = await setup();
  await turnHelp(true, el);
  await expect.element(page.elementLocator(badgeButton(el))).toHaveAccessibleName("Help: Menus");
  await expect.element(page.elementLocator(tabs(el)[1]!)).toHaveAccessibleName("Menus");
});
