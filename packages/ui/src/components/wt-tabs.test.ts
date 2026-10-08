import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { page } from "vitest/browser";
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
  document.addEventListener("wt-tab-change", listener);
  try {
    buttons(el)[1]!.click();
    await el.updateComplete;
    buttons(el)[1]!.click();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0].detail).toEqual({ value: "menus" });
  } finally {
    document.removeEventListener("wt-tab-change", listener);
  }
});

test("a control inside a panel announces its change under a name the strip does not use", async () => {
  const el = await setup(true);
  const dispatch = vi.spyOn(el, "dispatchEvent");
  buttons(el)[1]!.click();
  await el.updateComplete;
  const stripEvent = dispatch.mock.calls[0]![0].type;
  dispatch.mockRestore();
  const listener = vi.fn();
  el.addEventListener(stripEvent, listener);
  el.querySelector("input")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "routes" }, bubbles: true, composed: true }),
  );
  expect(listener).not.toHaveBeenCalled();
});

test("choosing a tab emits wt-tab-change, bubbling and composed, and stops the click", async () => {
  const el = await setup(true);
  const listener = vi.fn();
  const clicks = vi.fn();
  document.addEventListener("wt-tab-change", listener);
  document.addEventListener("click", clicks);
  try {
    buttons(el)[2]!.click();
    await el.updateComplete;
    expect(clicks).not.toHaveBeenCalled();
    buttons(el)[2]!.click();
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ value: "routes" });
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  } finally {
    document.removeEventListener("wt-tab-change", listener);
    document.removeEventListener("click", clicks);
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

test("each keyboard selection emits one wt-tab-change naming the newly selected tab", async () => {
  const el = await setup();
  const listener = vi.fn();
  el.addEventListener("wt-tab-change", listener);
  try {
    el.focus();
    for (const [key, expected] of [
      ["ArrowLeft", 2],
      ["ArrowRight", 0],
      ["End", 2],
      ["Home", 0],
      ["ArrowRight", 1],
    ] as const) {
      listener.mockClear();
      (el.shadowRoot!.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
      await el.updateComplete;
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]![0].detail).toEqual({ value: items[expected]!.key });
    }
    listener.mockClear();
    buttons(el)[2]!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );
    await el.updateComplete;
    expect(listener).not.toHaveBeenCalled();
  } finally {
    el.removeEventListener("wt-tab-change", listener);
  }
});

test("a strip nested in another's panel reaches the outer listener, which the target check ignores", async () => {
  const outer = (await mountThemed(
    `<wt-tabs label="Outer"><div slot="first"><wt-tabs label="Inner"><div slot="left">Left</div><div slot="right">Right</div></wt-tabs></div><div slot="second">Second</div></wt-tabs>`,
  )) as WtTabs;
  outer.items = [
    { key: "first", label: "First" },
    { key: "second", label: "Second" },
  ];
  const inner = outer.querySelector<WtTabs>("wt-tabs")!;
  inner.items = [
    { key: "left", label: "Left" },
    { key: "right", label: "Right" },
  ];
  await outer.updateComplete;
  await inner.updateComplete;
  const plain = vi.fn();
  const handled = vi.fn();
  const guarded = (event: Event) => {
    if (event.target !== event.currentTarget) return;
    handled(event);
  };
  outer.addEventListener("wt-tab-change", plain);
  outer.addEventListener("wt-tab-change", guarded);
  try {
    buttons(inner)[1]!.click();
    await inner.updateComplete;
    expect(plain).toHaveBeenCalledTimes(1);
    expect(plain.mock.calls[0]![0].detail).toEqual({ value: "right" });
    expect(handled).not.toHaveBeenCalled();
    expect(outer.value).toBe("");

    buttons(outer)[1]!.click();
    await outer.updateComplete;
    expect(handled).toHaveBeenCalledTimes(1);
    expect(handled.mock.calls[0]![0].detail).toEqual({ value: "second" });
  } finally {
    outer.removeEventListener("wt-tab-change", plain);
    outer.removeEventListener("wt-tab-change", guarded);
  }
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

test("keeps a tab action visible beside a scrolling tablist at phone width", async () => {
  const el = (await mountThemed(
    `<wt-tabs label="Venue operations"><button slot="actions">Add route</button><div slot="status">Ready</div></wt-tabs>`,
  )) as WtTabs;
  el.items = items;
  host.style.width = "220px";
  await el.updateComplete;

  const action = el.querySelector<HTMLButtonElement>('button[slot="actions"]')!;
  const tablist = el.shadowRoot!.querySelector<HTMLElement>('[role="tablist"]')!;
  const tabs = buttons(el);
  const hostRect = el.getBoundingClientRect();
  const actionRect = action.getBoundingClientRect();
  const tablistRect = tablist.getBoundingClientRect();
  expect(actionRect.width).toBeGreaterThan(0);
  expect(actionRect.left).toBeGreaterThanOrEqual(tablistRect.right - 1);
  expect(actionRect.right).toBeLessThanOrEqual(hostRect.right + 1);
  expect(actionRect.top).toBeLessThan(tablistRect.bottom);
  expect(tablist.scrollWidth).toBeGreaterThan(tablist.clientWidth);
  expect(tablist.querySelector('button[slot="actions"]')).toBeNull();
  expect(tabs).toHaveLength(3);
});

async function wideAction(width: number) {
  const el = (await mountThemed(
    `<wt-tabs label="Venue operations"><button slot="actions" style="width: 180px; white-space: nowrap">Añadir una impresora</button><div slot="status">Ready</div></wt-tabs>`,
  )) as WtTabs;
  el.items = items;
  host.style.width = `${width}px`;
  await el.updateComplete;
  await frames();
  return el;
}

function centre(box: DOMRect): number {
  return box.top + box.height / 2;
}

// At 300 px the action is wider than half the row; 390 and 641 px are controls where it is not.
test.each([300, 390, 641])(
  "keeps a 180 px action whole and on the tabs' line in a %s px row",
  async (width) => {
    const el = await wideAction(width);
    const action = el.querySelector<HTMLButtonElement>("button[slot=actions]")!;
    const area = el.shadowRoot!.querySelector<HTMLElement>('[part="tab-actions"]')!;
    const row = el.shadowRoot!.querySelector<HTMLElement>('[part="tab-row"]')!;
    const strip = tablist(el).getBoundingClientRect();
    const actionBox = action.getBoundingClientRect();
    expect(area.scrollWidth).toBeLessThanOrEqual(area.clientWidth);
    expect(actionBox.width).toBe(180);
    expect(actionBox.right).toBeLessThanOrEqual(el.getBoundingClientRect().right + 1);
    expect(actionBox.left).toBeGreaterThanOrEqual(strip.right - 1);
    expect(
      Math.abs(centre(actionBox) - centre(buttons(el)[0]!.getBoundingClientRect())),
    ).toBeLessThanOrEqual(1);
    expect(row.clientHeight).toBe(tablist(el).offsetHeight);
  },
);

test("a strip beside a wide action scrolls, and End brings the last tab clear of the action", async () => {
  const el = await wideAction(390);
  const action = el
    .querySelector<HTMLButtonElement>("button[slot=actions]")!
    .getBoundingClientRect();
  expect(tablist(el).scrollWidth).toBeGreaterThan(tablist(el).clientWidth);
  buttons(el)[0]!.focus();
  buttons(el)[0]!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }),
  );
  await el.updateComplete;
  await frames();
  const last = buttons(el)[2]!.getBoundingClientRect();
  expect(el.shadowRoot!.activeElement).toBe(buttons(el)[2]);
  expectSelectedInView(el);
  expect(last.right).toBeLessThanOrEqual(action.left + 1);
});

test("a selected tab that fits scrolls in only as far as its end, keeping the tabs before it", async () => {
  const el = await setup();
  host.style.width = "220px";
  el.value = "routes";
  await el.updateComplete;
  await frames();
  const strip = tablist(el).getBoundingClientRect();
  const tab = buttons(el)[2]!.getBoundingClientRect();
  expect(tab.width).toBeLessThan(tablist(el).clientWidth);
  expect(tablist(el).scrollLeft).toBeGreaterThan(0);
  expect(Math.abs(tab.right - strip.right)).toBeLessThanOrEqual(1);
});

test("a selected tab wider than the strip shows its start, cut where the action begins", async () => {
  const el = await wideAction(300);
  el.value = "routes";
  await el.updateComplete;
  await frames();
  const strip = tablist(el).getBoundingClientRect();
  const tab = buttons(el)[2]!.getBoundingClientRect();
  const action = el
    .querySelector<HTMLButtonElement>("button[slot=actions]")!
    .getBoundingClientRect();
  expect(tab.width).toBeGreaterThan(tablist(el).clientWidth);
  expect(tablist(el).scrollLeft).toBeGreaterThan(0);
  expect(tab.left).toBeGreaterThanOrEqual(strip.left - 1);
  expect(tab.left).toBeLessThanOrEqual(strip.left + 1);
  expect(strip.right).toBeLessThanOrEqual(action.left + 1);
});

test("right to left, a selected tab wider than the strip shows its start at the strip's right edge", async () => {
  const el = await wideAction(300);
  host.dir = "rtl";
  el.value = "routes";
  await el.updateComplete;
  await frames();
  const strip = tablist(el).getBoundingClientRect();
  const tab = buttons(el)[2]!.getBoundingClientRect();
  expect(tab.width).toBeGreaterThan(tablist(el).clientWidth);
  expect(tablist(el).scrollLeft).toBeLessThan(0);
  expect(Math.abs(tab.right - strip.right)).toBeLessThanOrEqual(1);
});

test("right to left, a selected tab that fits scrolls in only as far as its end", async () => {
  const el = await setup();
  host.dir = "rtl";
  host.style.width = "220px";
  el.value = "routes";
  await el.updateComplete;
  await frames();
  const strip = tablist(el).getBoundingClientRect();
  const tab = buttons(el)[2]!.getBoundingClientRect();
  expect(tab.width).toBeLessThan(tablist(el).clientWidth);
  expect(tablist(el).scrollLeft).toBeLessThan(0);
  expect(Math.abs(tab.left - strip.left)).toBeLessThanOrEqual(1);
});

test("control: at 1280 px neither the tabs nor a wide action scroll", async () => {
  const el = await wideAction(1280);
  expect(tablist(el).scrollWidth).toBeLessThanOrEqual(tablist(el).clientWidth);
  const area = el.shadowRoot!.querySelector<HTMLElement>('[part="tab-actions"]')!;
  expect(area.scrollWidth).toBeLessThanOrEqual(area.clientWidth);
  const action = el
    .querySelector<HTMLButtonElement>("button[slot=actions]")!
    .getBoundingClientRect();
  expect(action.right).toBeCloseTo(el.getBoundingClientRect().right - 4, 0);
});

test("bounds several actions within their own scrolling area at phone width", async () => {
  const el = (await mountThemed(
    `<wt-tabs label="Menu"><div slot="actions"><button>Add a new section</button><button>Include another menu</button><button>Add products to this section</button></div><div slot="structure">Content</div></wt-tabs>`,
  )) as WtTabs;
  el.items = [
    { key: "structure", label: "Structure" },
    { key: "prices", label: "Prices" },
    { key: "preview", label: "Preview" },
  ];
  host.style.width = "390px";
  await el.updateComplete;
  const actions = el.shadowRoot!.querySelector<HTMLElement>(".tab-actions")!;
  const tablist = el.shadowRoot!.querySelector<HTMLElement>('[role="tablist"]')!;
  const hostRect = el.getBoundingClientRect();
  const actionRect = actions.getBoundingClientRect();
  expect(actionRect.right).toBeLessThanOrEqual(hostRect.right + 1);
  const tap = parseFloat(getComputedStyle(el).getPropertyValue("--wt-tap-min"));
  expect(tap).toBeGreaterThan(0);
  expect(tablist.clientWidth).toBeGreaterThanOrEqual(2 * tap - 1);
  expect(actionRect.width).toBeCloseTo(hostRect.width - 2 * tap, 0);
  expect(actions.scrollWidth).toBeGreaterThan(actions.clientWidth);
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

test("shows the selected tab when a narrow page opens directly on a later tab", async () => {
  const el = (await mountThemed(markup)) as WtTabs;
  host.style.width = "220px";
  el.items = items;
  el.value = "routes";
  await el.updateComplete;

  const bar = el.shadowRoot!.querySelector<HTMLElement>('[role="tablist"]')!;
  const selected = buttons(el)[2]!;
  expect(bar.scrollLeft).toBeGreaterThan(0);
  expect(selected.getBoundingClientRect().right).toBeLessThanOrEqual(
    bar.getBoundingClientRect().right,
  );

  el.value = "status";
  await el.updateComplete;
  expect(bar.scrollLeft).toBeLessThan(20);
  expect(buttons(el)[0]!.getBoundingClientRect().left).toBeGreaterThanOrEqual(
    bar.getBoundingClientRect().left,
  );
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
  el.addEventListener("wt-tab-change", listener);

  el.items = [];
  await el.updateComplete;
  menus.click();

  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener.mock.calls[0]![0].detail).toEqual({ value: "menus" });
  expect(el.value).toBe("menus");
});

/** A resize is reported after layout and before the next paint, so read a few frames later. */
async function frames(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
}
function tablist(el: WtTabs) {
  return el.shadowRoot!.querySelector<HTMLElement>('[role="tablist"]')!;
}
function expectSelectedInView(el: WtTabs) {
  const selected = buttons(el).find((tab) => tab.getAttribute("aria-selected") === "true")!;
  const strip = tablist(el).getBoundingClientRect();
  const box = selected.getBoundingClientRect();
  expect(box.left).toBeGreaterThanOrEqual(strip.left - 1);
  expect(box.right).toBeLessThanOrEqual(strip.right + 1);
}
async function selectLastWide() {
  const el = await setup();
  host.style.width = "900px";
  el.value = "routes";
  await el.updateComplete;
  await frames();
  expect(tablist(el).scrollLeft).toBe(0);
  return el;
}
function recordErrors() {
  const errors: string[] = [];
  const record = (event: ErrorEvent) => errors.push(event.message);
  addEventListener("error", record);
  onTestFinished(() => removeEventListener("error", record));
  return errors;
}

test("keeps the selected tab in view when its strip narrows, with no ResizeObserver loop", async () => {
  const el = await selectLastWide();
  const errors = recordErrors();
  host.style.width = "220px";
  await frames();
  expect(tablist(el).scrollWidth).toBeGreaterThan(tablist(el).clientWidth);
  expect(tablist(el).scrollLeft).toBeGreaterThan(0);
  expectSelectedInView(el);
  expect(errors).toEqual([]);
});

test("control: widening a narrowed strip again leaves the selected tab in view", async () => {
  const el = await setup();
  host.style.width = "220px";
  el.value = "routes";
  await el.updateComplete;
  await frames();
  const errors = recordErrors();
  host.style.width = "900px";
  await frames();
  expectSelectedInView(el);
  expect(errors).toEqual([]);
});

test("still keeps the selected tab in view after being taken out of the page and put back", async () => {
  const el = await selectLastWide();
  el.remove();
  host.append(el);
  host.style.width = "220px";
  await frames();
  expect(tablist(el).scrollLeft).toBeGreaterThan(0);
  expectSelectedInView(el);
});

test("stops watching its strip when taken out of the page", async () => {
  const el = await selectLastWide();
  const disconnect = vi.spyOn(ResizeObserver.prototype, "disconnect");
  onTestFinished(() => disconnect.mockRestore());
  el.remove();
  expect(disconnect).toHaveBeenCalled();
});

test("watches a strip rebuilt after its tabs were emptied and given back", async () => {
  const el = await selectLastWide();
  const old = tablist(el);
  const unobserve = vi.spyOn(ResizeObserver.prototype, "unobserve");
  onTestFinished(() => unobserve.mockRestore());
  el.items = [];
  await el.updateComplete;
  expect(unobserve).toHaveBeenCalledWith(old);
  el.items = items;
  await el.updateComplete;
  await frames();
  expect(tablist(el)).not.toBe(old);
  host.style.width = "220px";
  await frames();
  expect(tablist(el).scrollLeft).toBeGreaterThan(0);
  expectSelectedInView(el);
});

test("does not start watching a strip rebuilt while out of the page until it returns", async () => {
  const el = await selectLastWide();
  el.items = [];
  await el.updateComplete;
  el.remove();
  const observe = vi.spyOn(ResizeObserver.prototype, "observe");
  onTestFinished(() => observe.mockRestore());
  el.items = items;
  await el.updateComplete;
  expect(observe).not.toHaveBeenCalled();
  host.append(el);
  expect(observe).toHaveBeenCalledWith(tablist(el));
  host.style.width = "220px";
  await frames();
  expectSelectedInView(el);
});

test("leaves a strip the reader scrolled where it is when only the label changes", async () => {
  const el = await setup();
  host.style.width = "220px";
  el.value = "routes";
  await el.updateComplete;
  await frames();
  const observe = vi.spyOn(ResizeObserver.prototype, "observe");
  onTestFinished(() => observe.mockRestore());
  tablist(el).scrollLeft = 0;
  el.label = "Venue";
  await el.updateComplete;
  await frames();
  expect(tablist(el).scrollLeft).toBe(0);
  expect(observe).not.toHaveBeenCalled();
});

test("leaves a strip the reader scrolled where it is when only its height changes", async () => {
  const el = await setup();
  host.style.width = "220px";
  el.value = "routes";
  await el.updateComplete;
  await frames();
  expect(tablist(el).scrollLeft).toBeGreaterThan(0);
  const before = tablist(el).getBoundingClientRect();
  tablist(el).scrollLeft = 0;
  const style = document.createElement("style");
  style.textContent = `wt-tabs::part(tablist) { min-height: ${before.height + 20}px; }`;
  document.head.append(style);
  onTestFinished(() => style.remove());
  await frames();
  const after = tablist(el).getBoundingClientRect();
  expect(after.width).toBe(before.width);
  expect(after.height).toBeGreaterThan(before.height);
  expect(tablist(el).scrollLeft).toBe(0);
});

test("shows the selected tab again when put back in the page at the same width", async () => {
  const el = await setup();
  host.style.width = "220px";
  el.value = "routes";
  await el.updateComplete;
  await frames();
  expect(tablist(el).scrollLeft).toBeGreaterThan(0);
  el.remove();
  host.append(el);
  await frames();
  expectSelectedInView(el);
});

test("brings the selected tab back into view when the tabs alone are reordered", async () => {
  const el = await setup();
  host.style.width = "220px";
  el.value = "routes";
  await el.updateComplete;
  await frames();
  const scrolled = tablist(el).scrollLeft;
  expect(scrolled).toBeGreaterThan(20);
  el.items = [items[2]!, items[0]!, items[1]!];
  await el.updateComplete;
  expect(tablist(el).scrollLeft).toBeLessThan(scrolled);
  expectSelectedInView(el);
});

test("a marked tab shows a star after its label and is named with what the star means", async () => {
  const el = await setup();
  el.items = [items[0]!, { ...items[1]!, marked: "unpublished changes" }, items[2]!];
  await el.updateComplete;
  const marked = buttons(el)[1]!;
  const star = marked.querySelector<HTMLElement>(".mark")!;
  expect(star.textContent).toBe("*");
  expect(star.getAttribute("aria-hidden")).toBe("true");
  expect(marked.textContent!.replace(/\s+/g, " ").trim().startsWith("Menus*")).toBe(true);
  await expect
    .element(page.getByRole("tab", { name: "Menus, unpublished changes", exact: true }))
    .toBeInTheDocument();
  await expect.element(page.getByRole("tab", { name: "Status", exact: true })).toBeInTheDocument();
  expect(buttons(el)[0]!.querySelector(".mark")).toBeNull();
});

test("a marked tab is drawn in the primary text colour, selected or not", async () => {
  const el = await setup();
  host.style.setProperty("--wt-color-primary-text", "rgb(10, 20, 30)");
  host.style.setProperty("--wt-color-text-muted", "rgb(90, 90, 90)");
  host.style.setProperty("--wt-color-text", "rgb(0, 0, 0)");
  el.items = [
    { ...items[0]!, marked: "unpublished changes" },
    { ...items[1]!, marked: "unpublished changes" },
    items[2]!,
  ];
  await el.updateComplete;
  const [selected, unselected, plain] = buttons(el);
  expect(selected!.getAttribute("aria-selected")).toBe("true");
  expect(getComputedStyle(selected!).color).toBe("rgb(10, 20, 30)");
  expect(getComputedStyle(unselected!).color).toBe("rgb(10, 20, 30)");
  expect(getComputedStyle(plain!).color).toBe("rgb(90, 90, 90)");
});
