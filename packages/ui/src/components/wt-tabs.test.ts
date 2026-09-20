import { afterEach, expect, test, vi } from "vitest";
import { cleanup, host, mountInShadowRoot } from "../test-helpers.js";
import { mountThemed } from "../a11y-helpers.js";
import type { WtTabs } from "./wt-tabs.js";
import "./wt-tabs.js";

afterEach(cleanup);
const markup = `<wt-tabs label="Venue operations"><div slot="status">Ready</div><div slot="menus"><input aria-label="Menu name"></div><div slot="routes">Routing</div></wt-tabs>`;
const items = [
  { key: "status", label: "Status" },
  { key: "menus", label: "Menus" },
  { key: "routes", label: "Preparation routing" },
];
async function setup(nested = false) {
  const el = (await (nested ? mountInShadowRoot(markup) : mountThemed(markup))) as WtTabs;
  el.items = items;
  await el.updateComplete;
  return el;
}
function buttons(el: WtTabs) {
  return [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
}

test("selects one associated panel and removes hidden content from layout", async () => {
  const el = await setup();
  const tabs = buttons(el);
  expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
  expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  expect(el.querySelector("input")!.getBoundingClientRect().height).toBe(0);
  for (const tab of tabs) {
    const panel = el.shadowRoot!.getElementById(tab.getAttribute("aria-controls")!)!;
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
  }
  tabs[1]!.click();
  await el.updateComplete;
  expect(el.value).toBe("menus");
  expect(el.querySelector("input")!.getBoundingClientRect().height).toBeGreaterThan(0);
  const input = el.querySelector("input")!;
  input.value = "Unfinished menu";
  tabs[0]!.click();
  await el.updateComplete;
  tabs[1]!.click();
  await el.updateComplete;
  expect(el.querySelector("input")).toBe(input);
  expect(input.value).toBe("Unfinished menu");
});

test("emits one composed selection event only for a different tab", async () => {
  const el = await setup(true);
  const listener = vi.fn();
  document.addEventListener("wt-change", listener);
  try {
    buttons(el)[1]!.click();
    await el.updateComplete;
    buttons(el)[1]!.click();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0].detail).toEqual({ value: "menus" });
  } finally {
    document.removeEventListener("wt-change", listener);
  }
});

test("arrow keys wrap, Home/End select extremes, and unrelated keys remain untouched", async () => {
  const el = await setup();
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(buttons(el)[0]);
  for (const [key, expected] of [
    ["ArrowLeft", 2],
    ["ArrowRight", 0],
    ["End", 2],
    ["Home", 0],
    ["ArrowRight", 1],
  ] as const) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    (el.shadowRoot!.activeElement as HTMLElement).dispatchEvent(event);
    await el.updateComplete;
    expect(event.defaultPrevented).toBe(true);
    expect(el.shadowRoot!.activeElement).toBe(buttons(el)[expected]);
    expect(el.value).toBe(items[expected]!.key);
  }
  const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  buttons(el)[1]!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

test("accepts a restored selection and falls back when its item disappears", async () => {
  const el = await setup();
  el.value = "routes";
  await el.updateComplete;
  expect(buttons(el)[2]!.getAttribute("aria-selected")).toBe("true");
  el.items = items.slice(0, 2);
  await el.updateComplete;
  expect(buttons(el)[0]!.getAttribute("aria-selected")).toBe("true");
  el.items = [];
  await el.updateComplete;
  expect(buttons(el)).toEqual([]);
  expect(el.shadowRoot!.querySelector('[role="tablist"]')).toBeNull();
});

test("uses theme tokens, touch targets and scrolls within a narrow container", async () => {
  const el = await setup();
  host.style.width = "220px";
  host.style.setProperty("--wt-color-primary", "rgb(10, 20, 30)");
  expect(getComputedStyle(buttons(el)[0]!).borderBottomColor).toBe("rgb(10, 20, 30)");
  expect(buttons(el)[0]!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  expect(buttons(el)[0]!.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
  const bar = el.shadowRoot!.querySelector<HTMLElement>('[role="tablist"]')!;
  expect(bar.scrollWidth).toBeGreaterThan(bar.clientWidth);
  expect(el.getBoundingClientRect().width).toBeLessThanOrEqual(220);
});

test("renders nothing until it is given tabs", async () => {
  const el = (await mountThemed('<wt-tabs label="Venue operations"></wt-tabs>')) as WtTabs;
  expect(el.shadowRoot!.querySelector('[role="tablist"]')).toBeNull();
  expect(buttons(el)).toEqual([]);
  expect(el.shadowRoot!.querySelectorAll('[role="tabpanel"]')).toHaveLength(0);
});

test("reports no selection of its own until a tab is chosen", async () => {
  const el = await setup();
  expect(el.value).toBe("");
  buttons(el)[1]!.click();
  await el.updateComplete;
  expect(el.value).toBe("menus");
});

test("labels the tab bar with the label it was given, and leaves it unlabelled otherwise", async () => {
  const labelled = await setup();
  expect(labelled.shadowRoot!.querySelector('[role="tablist"]')!.getAttribute("aria-label")).toBe(
    "Venue operations",
  );

  const unlabelled = (await mountThemed("<wt-tabs></wt-tabs>")) as WtTabs;
  unlabelled.items = items;
  await unlabelled.updateComplete;
  expect(unlabelled.shadowRoot!.querySelector('[role="tablist"]')!.getAttribute("aria-label")).toBe(
    "",
  );
});

test("names each tab and panel id after the component and its position", async () => {
  const el = await setup();
  const tabs = buttons(el);
  // The "-N" instance counter is what keeps two wt-tabs on one page apart, so the prefix before
  // it has to be there too: an id of "-1-tab-0" would still pair up with its own panel.
  expect(tabs[0]!.id).toMatch(/^wt-tabs-\d+-tab-0$/);
  expect(tabs[2]!.id).toMatch(/^wt-tabs-\d+-tab-2$/);
  const panel = el.shadowRoot!.getElementById(tabs[2]!.getAttribute("aria-controls")!)!;
  expect(panel.id).toMatch(/^wt-tabs-\d+-panel-2$/);
});

test("keyboard navigation scrolls the tab bar sideways and leaves the page where it was", async () => {
  const el = await setup();
  host.style.width = "220px";
  const above = document.createElement("div");
  above.style.height = "200px";
  host.prepend(above);
  const below = document.createElement("div");
  below.style.height = "2000px";
  host.append(below);
  window.scrollTo(0, 0);
  try {
    const bar = el.shadowRoot!.querySelector<HTMLElement>('[role="tablist"]')!;
    expect(bar.scrollLeft).toBe(0);
    // Focus the first tab itself: with the bar narrow enough to scroll, el.focus() lands on the
    // scrolling tablist rather than delegating into a tab.
    buttons(el)[0]!.focus();
    const event = new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true });
    buttons(el)[0]!.dispatchEvent(event);
    await el.updateComplete;
    expect(el.shadowRoot!.activeElement).toBe(buttons(el)[2]);
    expect(bar.scrollLeft).toBeGreaterThan(0);
    expect(window.scrollY).toBe(0);
  } finally {
    window.scrollTo(0, 0);
  }
});

test("carries each tab's own elements along when the tabs are reordered", async () => {
  // The elements follow the tab key rather than the position, so whatever a browser attaches to a
  // node — focus, a scroll offset, a running transition — stays with the tab the reader chose.
  const el = await setup();
  const [status, , routes] = buttons(el);
  const statusPanel = el.shadowRoot!.getElementById(status!.getAttribute("aria-controls")!)!;

  el.items = [items[2]!, items[0]!, items[1]!];
  await el.updateComplete;

  const reordered = buttons(el);
  expect(reordered.map((tab) => tab.dataset.key)).toEqual(["routes", "status", "menus"]);
  expect(reordered[0]).toBe(routes);
  expect(reordered[1]).toBe(status);
  expect(el.shadowRoot!.getElementById(reordered[1]!.getAttribute("aria-controls")!)).toBe(
    statusPanel,
  );
});

test("a click from a tab that has since been removed still reports that tab", async () => {
  // Nothing is selected once the items are gone, so the chosen key is a change like any other —
  // asking an empty list for its current tab must not be an error.
  const el = await setup();
  const menus = buttons(el)[1]!;
  const listener = vi.fn();
  el.addEventListener("wt-change", listener);

  el.items = [];
  await el.updateComplete;
  menus.click();

  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener.mock.calls[0]![0].detail).toEqual({ value: "menus" });
  expect(el.value).toBe("menus");
});
