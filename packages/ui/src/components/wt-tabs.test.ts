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
