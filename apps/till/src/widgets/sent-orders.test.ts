import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import type { BillSetMenuState } from "@waitron/shared";
import type { CurrentOrderRow, CurrentOrders, TabLine } from "../api/kitchen-api.js";
import { currentContentLanguages, setContentLanguages } from "@waitron/ui";
import { setLocale } from "../i18n/t.js";
import { en, es } from "../i18n/strings.js";
import { cleanupWidgets, mountWidget, touchContextMenu } from "./test-helpers.js";
import "./sent-orders.js";
import {
  at,
  burgerDish as burger,
  burgerLine as billLine,
  now,
  sentCurrent as current,
  sentDish as row,
  sentGroup as group,
} from "../../test/sent-rows.js";

type Panel = LitElement & {
  scope: string;
  billId: string;
  snapshot: { scope: string; billId: string; current: CurrentOrders } | null;
  busy: boolean;
  now: number;
  billLabels: ReadonlyMap<string, string>;
  lines: readonly TabLine[];
  setMenus: BillSetMenuState | null;
};
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
async function mount(data: CurrentOrders, over: Partial<Panel> = {}) {
  return (
    await mountWidget<Panel>("till-sent-orders", {
      scope: "visit-1",
      billId: "b1",
      snapshot: { scope: "visit-1", billId: "b1", current: data },
      now,
      busy: false,
      billLabels: new Map([["b2", "Patio guests"]]),
      ...over,
    })
  ).el;
}
const root = (el: Panel) => el.shadowRoot!;
const find = (el: Panel, selector: string) => root(el).querySelector<HTMLElement>(selector)!;
const every = (el: Panel, selector: string) => [
  ...root(el).querySelectorAll<HTMLElement>(selector),
];
const text = (node: Element) => node.textContent!.replace(/\s+/g, " ").trim();
async function click(el: Panel, selector: string) {
  await userEvent.click(page.elementLocator(find(el, selector)));
  await el.updateComplete;
}
/** Opens the row `li` names, unless it is open already. */
async function openRow(el: Panel, li: string) {
  const button = find(el, `${li} [data-sent-row]`);
  if (button.getAttribute("aria-expanded") !== "true") await click(el, `${li} [data-sent-row]`);
}
/** Opens the row and presses its last Serve, which serves everything left of it. */
async function serveLeft(el: Panel, li: string) {
  await openRow(el, li);
  const serves = every(el, `${li} [data-sent-serve]`);
  expect(serves.length).toBeGreaterThan(0);
  await userEvent.click(page.elementLocator(serves.at(-1)!));
  await el.updateComplete;
}
/** Opens the row and presses its Dish details. */
async function openDetails(el: Panel, li: string) {
  await openRow(el, li);
  await click(el, `${li} [data-sent-details]`);
}
function collect(el: Panel, name: string) {
  const calls: unknown[] = [];
  el.addEventListener(name, (event) => calls.push((event as CustomEvent).detail));
  return calls;
}
/** Each section's title, its mark and the actions in its heading. */
const headings = (el: Panel) =>
  every(el, "wt-course-heading").map((heading) => [
    text(heading.querySelector("[data-section-title]")!),
    heading.getAttribute("mark") ?? "",
    [...heading.querySelectorAll("[slot=end] wt-button, wt-button[slot=end]")].map((button) =>
      button.getAttribute("data-serve-all") !== null ? "serve all" : "fire",
    ),
  ]);
/** A row's second line, or "" when it has none. */
const second = (el: Panel, selector: string) => {
  const line = find(el, selector).querySelector(".row-more");
  return line === null ? "" : text(line);
};
/** A row's quantity, name and price columns. */
const shownLines = (el: Panel, attribute: string) =>
  every(el, `[${attribute}]`).map((node) => [
    node.getAttribute(attribute),
    text(node.querySelector(".row-qty")!),
    text(node.querySelector(".row-name")!),
    text(node.querySelector(".row-price")!),
  ]);

it("stays absent until this bill has sent food in the current visit's snapshot", async () => {
  const el = await mount(current([row("other", { workingOrderId: "b2" })]));
  expect(root(el).querySelector("[data-sent-panel]")).toBeNull();
  el.snapshot = { scope: "old-visit", billId: "b1", current: current([row("stale")]) };
  await el.updateComplete;
  expect(root(el).querySelector("[data-sent-panel]")).toBeNull();
  el.snapshot = { scope: "visit-1", billId: "b1", current: current([row("Bravas")]) };
  await el.updateComplete;
  expect(find(el, "[data-sent-panel]")).toBeTruthy();
  expect(find(el, "[data-fired-line=Bravas]").checkVisibility()).toBe(true);
});

it("draws every row with a hidden level-2 Sent heading and level-3 section headings", async () => {
  const el = await mount(
    current(
      [row("ready", { readyAt: at(59) }), row("served", { servedQuantity: "1.000" })],
      [group("g", [row("held", { released: false, lineNo: 2 })])],
    ),
  );
  const title = find(el, "h2");
  expect(title.textContent).toBe("Sent");
  expect(title.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  expect(every(el, "wt-course-heading").map((heading) => heading.getAttribute("level"))).toEqual([
    "3",
    "3",
  ]);
  expect(find(el, "[data-served-line=served]").checkVisibility()).toBe(true);
  expect(find(el, "[data-held-line=held]").checkVisibility()).toBe(true);
  expect(find(el, "[data-sent-panel]").getAnimations()).toEqual([]);
  const rows = every(el, "li:not([data-companion])");
  expect(rows.length).toBe(3);
  for (const li of rows) {
    await userEvent.click(page.elementLocator(li.querySelector("[data-sent-row]")!));
    await el.updateComplete;
    const line = li.getBoundingClientRect();
    const actions = [...li.querySelectorAll("[data-sent-open] button")];
    expect(actions.length).toBeGreaterThan(0);
    for (const info of actions) {
      expect(info.getBoundingClientRect().right).toBeLessThanOrEqual(line.right);
      expect(info.getBoundingClientRect().left).toBeGreaterThanOrEqual(line.left);
    }
  }
});

it("heads each fire group in firing order with its courses and mark, then the ungrouped rows", async () => {
  const data = current(
    [row("bread", { courseId: "starter", firedAt: at(40), lineNo: 5 })],
    [
      group("mains", [row("steak", { courseId: "main", released: false, firedAt: null })], {
        position: 2,
        displayNumber: 9,
      }),
      group(
        "drinks",
        [
          row("beer", { courseId: "drink", lineNo: 2 }),
          row("wine", { courseId: "drink", lineNo: 3 }),
          row("olives", { courseId: "starter", lineNo: 4 }),
        ],
        { position: 1, state: "fired", firedAt: at(48) },
      ),
    ],
  );
  data.retainedCourses = [
    { id: "main", name: "Mains", displayOrder: 2, fireNowZoneIds: [] },
    { id: "starter", name: "Starters", displayOrder: 1, fireNowZoneIds: [] },
    { id: "drink", name: "Drinks", displayOrder: 0, fireNowZoneIds: [] },
  ];
  const el = await mount(data);
  expect(every(el, "[data-sent-section]").map((node) => node.dataset.sentSection)).toEqual([
    "drinks",
    "mains",
    "",
  ]);
  expect(headings(el)).toEqual([
    ["Drinks, Starters · Fired 12 min ago", "sent", ["serve all"]],
    ["Mains · Held", "", ["fire"]],
    ["Starters · Fired 20 min ago", "sent", ["serve all"]],
  ]);
  expect(find(el, "[data-group-fire=mains]").getAttribute("aria-label")).toBe("Fire · Group 9");
  expect(find(el, "wt-course-heading").getAttribute("mark-label")).toBe("Sent");
});

it("says Fired on a released dish under a Held heading, which the heading does not say", async () => {
  const data = current(
    [],
    [
      group("g", [
        row("held", { released: false, firedAt: null, courseId: "gone" }),
        row("early", { lineNo: 2, firedAt: at(40) }),
        row("unknown", { lineNo: 3, firedAt: null }),
      ]),
    ],
  );
  const el = await mount(data);
  expect(headings(el)).toEqual([["No course · Held", "", ["fire", "serve all"]]]);
  expect(second(el, "[data-fired-line=early]")).toBe("Fired 20 min ago");
  expect(second(el, "[data-fired-line=unknown]")).toBe("Fired");
  expect(second(el, "[data-held-line=held]")).toBe("");
  const calls = collect(el, "serve-lines");
  await serveLeft(el, "[data-fired-line=early]");
  expect(calls).toEqual([{ items: [{ lineId: "early", quantity: "1" }] }]);
});

it("Serve all sends only its own section's released, unserved portions, once", async () => {
  const data = current(
    [row("bread", { lineNo: 9 })],
    [
      group(
        "drinks",
        [
          row("beer", { quantity: "3.000", servedQuantity: "1.000" }),
          row("late", { released: false, firedAt: null, lineNo: 2 }),
          row("done", { servedQuantity: "1.000", servedAt: at(50), lineNo: 3 }),
        ],
        { state: "fired", firedAt: at(48) },
      ),
    ],
  );
  const el = await mount(data);
  const calls = collect(el, "serve-lines");
  await click(el, "[data-sent-section=drinks] [data-serve-all]");
  expect(calls).toEqual([{ items: [{ lineId: "beer", quantity: "2" }] }]);
  await click(el, '[data-sent-section=""] [data-serve-all]');
  expect(calls).toEqual([
    { items: [{ lineId: "beer", quantity: "2" }] },
    { items: [{ lineId: "bread", quantity: "1" }] },
  ]);
});

it("Serve all sends nothing while busy or after a row of its section changed", async () => {
  const data = current(
    [],
    [group("drinks", [row("beer", { quantity: "3.000" })], { state: "fired", firedAt: at(48) })],
  );
  const el = await mount(data);
  const calls = collect(el, "serve-lines");
  const old = find(el, "[data-serve-all]");
  el.busy = true;
  old.click();
  await el.updateComplete;
  expect(old.hasAttribute("disabled")).toBe(true);
  expect(old.getAttribute("variant")).toBe("ghost");
  el.busy = false;
  el.snapshot = {
    ...el.snapshot!,
    current: current(
      [],
      [group("drinks", [row("beer", { quantity: "4.000" })], { state: "fired", firedAt: at(48) })],
    ),
  };
  old.click();
  expect(calls).toEqual([]);
  await el.updateComplete;
  await click(el, "[data-serve-all]");
  expect(calls).toEqual([{ items: [{ lineId: "beer", quantity: "4" }] }]);
});

it("a held group with released dishes offers Serve all beside Fire, which serves only those", async () => {
  const el = await mount(
    current(
      [],
      [
        group("g", [
          row("flan", { readyAt: at(59) }),
          row("water", { lineNo: 2 }),
          row("soup", { lineNo: 3, released: false, firedAt: null }),
          row("other", { lineNo: 4, workingOrderId: "b2", released: false, firedAt: null }),
        ]),
      ],
    ),
  );
  expect(headings(el)).toEqual([["Held", "", ["fire", "serve all"]]]);
  const calls = collect(el, "serve-lines");
  await click(el, "[data-sent-section=g] [data-serve-all]");
  expect(calls).toEqual([
    {
      items: [
        { lineId: "flan", quantity: "1" },
        { lineId: "water", quantity: "1" },
      ],
    },
  ]);
});

it("a held group with nothing released offers Fire alone", async () => {
  const el = await mount(
    current([], [group("g", [row("soup", { released: false, firedAt: null })])]),
  );
  expect(headings(el)).toEqual([["Held", "", ["fire"]]]);
});

it("Serve all sends nothing once a dish it showed has moved under another heading", async () => {
  const beer = row("beer");
  const wine = row("wine", { lineNo: 2 });
  const water = row("water", { lineNo: 3 });
  const fired = { state: "fired", firedAt: at(48) } as const;
  const el = await mount(
    current(
      [],
      [group("drinks", [beer, wine], fired), group("later", [water], { ...fired, position: 2 })],
    ),
  );
  const old = find(el, "[data-sent-section=drinks] [data-serve-all]");
  const calls = collect(el, "serve-lines");
  el.snapshot = {
    ...el.snapshot!,
    current: current(
      [],
      [group("drinks", [beer], fired), group("later", [water, wine], { ...fired, position: 2 })],
    ),
  };
  old.click();
  expect(calls).toEqual([]);
  await el.updateComplete;
  await click(el, "[data-sent-section=drinks] [data-serve-all]");
  expect(calls).toEqual([{ items: [{ lineId: "beer", quantity: "1" }] }]);
});

it("keeps a focused Serve all on its own group when an earlier group leaves the list", async () => {
  const fired = (id: string, dish: string, position: number) =>
    group(id, [row(dish)], { state: "fired", position, firedAt: at(40) });
  const el = await mount(
    current([], [fired("first", "soup", 1), fired("next", "steak", 2), fired("last", "pie", 3)]),
  );
  const button = find(el, "[data-sent-section=next] [data-serve-all]") as LitElement;
  await button.updateComplete;
  button.shadowRoot!.querySelector("button")!.focus();
  expect(root(el).activeElement).toBe(button);
  el.snapshot = {
    ...el.snapshot!,
    current: current([], [fired("next", "steak", 2), fired("last", "pie", 3)]),
  };
  await el.updateComplete;
  expect(
    root(el).activeElement?.closest("[data-sent-section]")?.getAttribute("data-sent-section"),
  ).toBe("next");
});

it("serves the active remainder from the opened row, one row per dish, with the charged cancellation apart", async () => {
  const el = await mount(
    current([
      row("Bravas", {
        quantity: "4.000",
        servedQuantity: "1.000",
        cancelledQuantity: "1.000",
        readyAt: at(57),
        netAmount: "12.00",
      }),
    ]),
  );
  expect(shownLines(el, "data-fired-line")).toEqual([["Bravas", "3", "Bravas", "€9.00"]]);
  expect(second(el, "[data-fired-line=Bravas]")).toBe("Ready 3 min · 1 of 3 served");
  expect(shownLines(el, "data-served-line")).toEqual([["Bravas", "1", "Bravas", "€3.00"]]);
  expect(second(el, "[data-served-line=Bravas]")).toBe("Cancelled, charged");
  const calls = collect(el, "serve-lines");
  await serveLeft(el, "[data-fired-line=Bravas]");
  expect(calls).toEqual([{ items: [{ lineId: "Bravas", quantity: "2" }] }]);
  expect(root(el).querySelector("[data-serve-dialog]")).toBeNull();
  expect(root(el).querySelector("input[type=checkbox]")).toBeNull();
});

it("draws Ready N min bold in the warning colour", async () => {
  const el = await mount(current([row("ready", { readyAt: at(57) }), row("cooking")]));
  const ready = find(el, "[data-fired-line=ready] .row-ready");
  expect(text(ready)).toBe("Ready 3 min");
  const probe = document.createElement("span");
  probe.style.color = "var(--wt-color-warning)";
  probe.style.fontWeight = "var(--wt-font-weight-bold)";
  root(el).append(probe);
  try {
    expect(getComputedStyle(probe).color).not.toBe(getComputedStyle(find(el, "h2")).color);
    expect(getComputedStyle(ready).color).toBe(getComputedStyle(probe).color);
    expect(getComputedStyle(ready).fontWeight).toBe(getComputedStyle(probe).fontWeight);
    const quiet = find(el, "[data-fired-line=ready] .row-more");
    expect(getComputedStyle(quiet).color).not.toBe(getComputedStyle(probe).color);
  } finally {
    probe.remove();
  }
  expect(second(el, "[data-fired-line=cooking]")).toBe("");
});

it("All served sends every displayed active fired remainder of the section in one command, including paid/no-station work", async () => {
  const el = await mount(
    current(
      [
        row("Bravas", { quantity: "3.000", servedQuantity: "1.000", readyAt: at(59) }),
        row("Water", { billStatus: "settled", quantity: "0.750", unitPrecision: 3 }),
        row("Cancelled", { cancelledQuantity: "1.000" }),
        row("Other bill", { workingOrderId: "b2" }),
      ],
      [group("g", [row("Held", { released: false })])],
    ),
  );
  const calls = collect(el, "serve-lines");
  await click(el, "[data-serve-all]");
  expect(calls).toEqual([
    {
      items: [
        { lineId: "Bravas", quantity: "2" },
        { lineId: "Water", quantity: "0.75" },
      ],
    },
  ]);
});

it("opens line information without serving and refuses detached, busy or superseded row commands", async () => {
  const el = await mount(current([row("Bravas", { readyAt: at(59) })]));
  const serves = collect(el, "serve-lines");
  const details = collect(el, "sent-line-info");
  await openDetails(el, "[data-fired-line=Bravas]");
  expect(serves).toEqual([]);
  expect(details).toEqual([{ lineId: "Bravas", workingOrderId: "b1", kind: "fired" }]);
  const old = find(el, "[data-fired-line=Bravas] [data-sent-serve]");
  el.busy = true;
  old.click();
  expect(serves).toEqual([]);
  el.busy = false;
  el.snapshot = { scope: "old", billId: "b1", current: current([row("Bravas")]) };
  old.click();
  expect(serves).toEqual([]);
  el.remove();
  old.click();
  expect(serves).toEqual([]);
});

it("a part-served dish's information names its served part as well as what is left", async () => {
  const el = await mount(
    current([row("Bravas", { quantity: "3.000", servedQuantity: "1.000", readyAt: at(59) })]),
  );
  const details = collect(el, "sent-line-info");
  await openDetails(el, "[data-fired-line=Bravas]");
  expect(details).toEqual([
    { lineId: "Bravas", workingOrderId: "b1", kind: "fired", servedLineIds: ["Bravas"] },
  ]);
});

it("labels companions by bill without a price or line action, and fires the whole held group", async () => {
  const data = current(
    [],
    [
      group("g", [
        row("own", { released: false, billStatus: "settled", netAmount: "9.50" }),
        row("guest", { workingOrderId: "b2", released: false, netAmount: "888.88" }),
      ]),
    ],
  );
  const el = await mount(data);
  const companion = find(el, "[data-held-group=g] [data-companion=guest]");
  expect(companion.textContent).toContain("Patio guests");
  expect(companion.textContent).not.toContain("888.88");
  expect(companion.querySelector("wt-button")).toBeNull();
  const calls = collect(el, "fire-group");
  await click(el, "[data-group-fire=g]");
  expect(calls).toEqual([{ groupId: "g" }]);
});

it("keeps Fire and the other bill's held dish under a held group whose dish on this bill was released", async () => {
  const el = await mount(
    current(
      [],
      [
        group("g", [
          row("own", { name: "Bravas" }),
          row("guest", { workingOrderId: "b2", released: false }),
        ]),
      ],
    ),
  );
  expect(headings(el)).toEqual([["Held", "", ["fire", "serve all"]]]);
  expect(every(el, "[data-companion=guest]")).toHaveLength(1);
  const calls = collect(el, "fire-group");
  await click(el, "[data-group-fire=g]");
  expect(calls).toEqual([{ groupId: "g" }]);
});

it("draws another bill's dish as an ordinary muted sent row whose second line is the bill's name", async () => {
  const el = await mount(
    current(
      [],
      [
        group("g", [
          row("own", { released: false }),
          row("guest", { workingOrderId: "b2", released: false }),
        ]),
      ],
    ),
  );
  el.style.setProperty("--wt-color-track", "rgb(1, 2, 3)");
  el.style.setProperty("--wt-color-text", "rgb(4, 5, 6)");
  el.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  const companion = find(el, "[data-companion=guest]");
  const own = find(el, "[data-held-line=own]");
  expect(getComputedStyle(companion).backgroundColor).toBe(getComputedStyle(own).backgroundColor);
  expect(getComputedStyle(companion).backgroundColor).not.toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(companion).color).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(companion.querySelector(".row-more")!).color).toBe("rgb(7, 8, 9)");
  expect(second(el, "[data-companion=guest]")).toBe("Patio guests");
  expect(companion.querySelector(".row-price")).toBeNull();
});

/** A fired heading and a held one with nothing released, laid out at `width`. */
async function twoHeadings(width = 600) {
  const el = await mount(
    current(
      [],
      [
        group("held", [row("steak", { released: false })], { position: 2 }),
        group("fired", [row("beer")], { position: 1, state: "fired", firedAt: at(48) }),
      ],
    ),
  );
  el.style.width = `${width}px`;
  for (let frame = 0; frame < 2; frame++)
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  return el;
}
const edge = (heading: Element) =>
  heading.getBoundingClientRect().right - parseFloat(getComputedStyle(heading).paddingRight);

it("draws Serve all as a teal word on the heading's line, with a full tap area inside a compact heading", async () => {
  const el = await twoHeadings();
  el.style.setProperty("--wt-color-primary-text", "rgb(1, 2, 3)");
  el.style.setProperty("--wt-font-size-md", "15px");
  const heading = find(el, "[data-sent-section=fired] wt-course-heading");
  const serve = find(el, "[data-sent-section=fired] [data-serve-all]");
  expect(serve.getAttribute("variant")).toBe("ghost");
  const inner = getComputedStyle(serve.shadowRoot!.querySelector("button")!);
  expect(inner.color).toBe("rgb(1, 2, 3)");
  expect(inner.fontSize).toBe("15px");
  expect(inner.fontWeight).toBe("600");
  expect(inner.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(inner.borderTopColor).toBe("rgba(0, 0, 0, 0)");
  const button = serve.getBoundingClientRect();
  const box = heading.getBoundingClientRect();
  const title = find(el, "[data-sent-section=fired] [data-section-title]").getBoundingClientRect();
  const pill = heading.shadowRoot!.querySelector('[part="mark"]')!.getBoundingClientRect();
  expect(button.height).toBeGreaterThanOrEqual(44);
  expect(button.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeLessThanOrEqual(45);
  expect(button.top).toBeGreaterThanOrEqual(box.top - 0.5);
  expect(button.bottom).toBeLessThanOrEqual(box.bottom + 0.5);
  expect(button.top).toBeLessThan(title.bottom);
  expect(button.right).toBeCloseTo(edge(heading), 0);
  expect(pill.right).toBeLessThanOrEqual(button.left);
});

/** Whether the heading's mark and actions are drawn on a line of their own, under its title. */
const wrapped = (heading: Element) =>
  heading.shadowRoot!.querySelector(".end")!.getBoundingClientRect().top >=
  heading.shadowRoot!.querySelector('[role="heading"]')!.getBoundingClientRect().bottom;

/** The vertical middle of the text inside `node`, wherever it is drawn. */
function textMiddle(node: Node): number {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let at = walker.nextNode(); at !== null; at = walker.nextNode()) {
    if (at.textContent!.trim() === "") continue;
    range.selectNodeContents(at);
    const box = range.getBoundingClientRect();
    return (box.top + box.bottom) / 2;
  }
  throw new Error("no text");
}

it.each([
  [600, false, 44],
  [200, true, 71],
] as const)(
  "centres Serve all's word on the Sent mark's line at %ipx (wrapped: %s), %ipx tall",
  async (width, stacked, height) => {
    const el = await twoHeadings(width);
    const heading = find(el, "[data-sent-section=fired] wt-course-heading");
    expect(wrapped(heading)).toBe(stacked);
    const serve = find(el, "[data-sent-section=fired] [data-serve-all]");
    const mark = heading.shadowRoot!.querySelector('[part="mark"]')!;
    expect(Math.abs(textMiddle(serve) - textMiddle(mark))).toBeLessThanOrEqual(1);
    // Within a pixel or so: CI's fonts draw these lines a pixel shorter than a Mac's.
    expect(Math.abs(heading.getBoundingClientRect().height - height)).toBeLessThanOrEqual(1.5);
    expect(serve.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(serve.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    const title = find(
      el,
      "[data-sent-section=fired] [data-section-title]",
    ).getBoundingClientRect();
    if (stacked)
      expect(serve.getBoundingClientRect().top).toBeGreaterThanOrEqual(title.bottom - 0.5);
  },
);

it.each([
  [600, false],
  [200, true],
] as const)(
  "centres Serve all's word on Fire's line on a held heading with a released dish at %ipx (wrapped: %s)",
  async (width, stacked) => {
    const el = await mount(
      current([], [group("g", [row("own", { released: false }), row("drink", { lineNo: 2 })])]),
    );
    el.style.width = `${width}px`;
    for (let frame = 0; frame < 2; frame++)
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const heading = find(el, "[data-sent-section=g] wt-course-heading");
    expect(wrapped(heading)).toBe(stacked);
    const fire = find(el, "[data-group-fire=g]");
    const serve = find(el, "[data-sent-section=g] [data-serve-all]");
    expect(Math.abs(textMiddle(serve) - textMiddle(fire))).toBeLessThanOrEqual(1);
  },
);

it.each(["en", "es"] as const)(
  "names each %s group's Serve all after its group, as Fire is named",
  async (locale) => {
    setLocale(locale);
    const el = await mount(
      current(
        [row("loose")],
        [
          group("g7", [row("beer")], { state: "fired", firedAt: at(48) }),
          group("g8", [row("wine", { lineNo: 2 })], {
            position: 2,
            displayNumber: 8,
            state: "fired",
            firedAt: at(48),
          }),
        ],
      ),
    );
    const strings = { en, es }[locale];
    const named = (n: number) =>
      `${strings["table.serve_group"]} · ${strings["table.group_n"].replace("{n}", String(n))}`;
    expect(
      every(el, "[data-serve-all]").map((button) => button.getAttribute("aria-label")),
    ).toEqual([named(7), named(8), null]);
  },
);

it("draws a disabled Serve all quiet, not teal", async () => {
  const el = await mount(
    current(
      [],
      [
        group("served", [row("beer", { servedQuantity: "1.000", servedAt: at(50) })], {
          state: "fired",
          firedAt: at(48),
        }),
        group("fired", [row("wine")], { position: 2, state: "fired", firedAt: at(48) }),
      ],
    ),
  );
  el.style.setProperty("--wt-color-primary-text", "rgb(1, 2, 3)");
  const colour = (id: string) =>
    getComputedStyle(
      find(el, `[data-sent-section=${id}] [data-serve-all]`).shadowRoot!.querySelector("button")!,
    ).color;
  expect(colour("fired")).toBe("rgb(1, 2, 3)");
  expect(colour("served")).not.toBe("rgb(1, 2, 3)");
  el.busy = true;
  await el.updateComplete;
  expect(colour("fired")).not.toBe("rgb(1, 2, 3)");
});

it("draws a held heading's Fire as an outlined button at the right of its line", async () => {
  const el = await twoHeadings();
  const heading = find(el, "[data-sent-section=held] wt-course-heading");
  const fire = find(el, "[data-group-fire=held]");
  expect(fire.getAttribute("variant")).toBe("secondary");
  const button = fire.getBoundingClientRect();
  const title = find(el, "[data-sent-section=held] [data-section-title]").getBoundingClientRect();
  expect(button.height).toBeGreaterThanOrEqual(44);
  expect(button.right).toBeCloseTo(edge(heading), 0);
  expect(button.top).toBeLessThan(title.bottom);
  el.busy = true;
  await el.updateComplete;
  expect(fire.getAttribute("variant")).toBe("secondary");
});

it.each(["en", "es"] as const)(
  "never breaks a %s heading inside its time phrase or before its dot",
  async (locale) => {
    setLocale(locale);
    const data = current(
      [],
      [group("fired", [row("beer", { courseId: "drink" })], { state: "fired", firedAt: at(48) })],
    );
    data.retainedCourses = [{ id: "drink", name: "Drinks", displayOrder: 0, fireNowZoneIds: [] }];
    const el = await mount(data);
    const words = find(el, "[data-section-title]").textContent!.trim();
    expect(words).toBe(
      `Drinks\u00a0· ${{ en, es }[locale]["table.group_fired_ago"].replace("{n}", "12")}`,
    );
    expect(words.split(" ")).toHaveLength(2);
  },
);

it("uses only the supplied reminder to show due/snooze/fire above the sections", async () => {
  const data = current([], [group("g", [row("held", { released: false })])]);
  data.reminder = { groupId: "g", dueAt: new Date(now).toISOString() };
  const el = await mount(data);
  const reminder = find(el, "[data-group-reminder]");
  expect(
    reminder.compareDocumentPosition(find(el, "[data-sent-section]")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const snoozes = collect(el, "snooze-group");
  const fires = collect(el, "fire-group");
  await click(el, "[data-reminder-snooze]");
  expect(snoozes).toEqual([{ groupId: "g", minutes: 5 }]);
  await click(el, "[data-reminder-fire]");
  expect(fires).toEqual([{ groupId: "g" }]);
  data.reminder = null;
  el.snapshot = { scope: "visit-1", billId: "b1", current: { ...data } };
  await el.updateComplete;
  expect(root(el).querySelector("[data-reminder-fire]")).toBeNull();
});

it("keeps ready updates from moving a pressed row and then restores ready-first ordering", async () => {
  const el = await mount(current([row("first", { readyAt: at(59) }), row("second")]));
  const pressed = find(el, "[data-sent-row=first]");
  pressed.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerId: 1 }),
  );
  el.snapshot = {
    scope: "visit-1",
    billId: "b1",
    current: current([row("first"), row("second", { readyAt: at(58) })]),
  };
  await el.updateComplete;
  expect(every(el, "[data-fired-line]").map((node) => node.dataset.firedLine)).toEqual([
    "first",
    "second",
  ]);
  expect(find(el, "[data-sent-row=first]")).toBe(pressed);
  pressed.dispatchEvent(
    new PointerEvent("pointercancel", { bubbles: true, composed: true, pointerId: 1 }),
  );
  await el.updateComplete;
  expect(every(el, "[data-fired-line]").map((node) => node.dataset.firedLine)).toEqual([
    "second",
    "first",
  ]);
});

it.each(["busy", "unreleased"] as const)(
  "a native press on a %s row offers no Serve and does not freeze the next accepted snapshot",
  async (reason) => {
    const el = await mount(
      current([
        row("first", { readyAt: at(59), released: reason !== "unreleased" }),
        row("second"),
      ]),
      { busy: reason === "busy" },
    );
    const calls = collect(el, "serve-lines");
    const button = find(el, '[data-sent-row="first"]');
    await userEvent.click(button);
    await el.updateComplete;
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const serves = every(el, '[data-fired-line="first"] [data-sent-serve]') as HTMLButtonElement[];
    expect(serves.map((serve) => serve.disabled)).toEqual(reason === "busy" ? [true] : []);
    for (const serve of serves) await userEvent.click(serve, { force: true });
    expect(calls).toEqual([]);
    el.busy = false;
    el.snapshot = {
      ...el.snapshot!,
      current: current([row("first", { quantity: "2.000" }), row("second", { readyAt: at(58) })]),
    };
    await el.updateComplete;
    expect(every(el, "[data-fired-line]").map((line) => line.dataset.firedLine)).toEqual([
      "second",
      "first",
    ]);
    expect(shownLines(el, "data-fired-line")[1]).toEqual(["first", "2", "first", "€3.00"]);
    await serveLeft(el, '[data-fired-line="first"]');
    expect(calls).toEqual([{ items: [{ lineId: "first", quantity: "2" }] }]);
  },
);

it("refuses an old row or All served control after the displayed quantities change", async () => {
  const el = await mount(current([row("Bravas", { readyAt: at(59) })]));
  await openRow(el, "[data-fired-line=Bravas]");
  const oldRow = find(el, "[data-fired-line=Bravas] [data-sent-serve]");
  const oldAll = find(el, "[data-serve-all]");
  const calls = collect(el, "serve-lines");
  el.snapshot = {
    scope: "visit-1",
    billId: "b1",
    current: current([row("Bravas", { quantity: "2.000", readyAt: at(59) })]),
  };
  oldRow.click();
  oldAll.click();
  expect(calls).toEqual([]);
  await el.updateComplete;
  await click(el, "[data-serve-all]");
  expect(calls).toEqual([{ items: [{ lineId: "Bravas", quantity: "2" }] }]);
});

it("names courses in course order while group numbers survive mutable firing positions", async () => {
  const data = current(
    [],
    [
      group(
        "g",
        [
          row("flan", { courseId: "dessert", released: false, quantity: "2.000" }),
          row("steak", { courseId: "main", released: false, quantity: "3.000" }),
        ],
        { position: 5, displayNumber: 7 },
      ),
    ],
  );
  data.retainedCourses = [
    { id: "dessert", name: "Desserts", displayOrder: 2, fireNowZoneIds: [] },
    { id: "main", name: "Mains", displayOrder: 1, fireNowZoneIds: [] },
  ];
  const el = await mount(data);
  expect(headings(el)).toEqual([["Mains, Desserts · Held", "", ["fire"]]]);
  expect(find(el, "[data-group-fire=g]").getAttribute("aria-label")).toBe("Fire · Group 7");
});

it("shows Spanish ready age, information and charged cancellations without a missing translation", async () => {
  setLocale("es");
  const el = await mount(
    current([row("Bravas", { readyAt: at(59) }), row("Cancelado", { cancelledQuantity: "1.000" })]),
  );
  expect(find(el, "h2").textContent).toBe("Enviado");
  expect(second(el, "[data-fired-line=Bravas]")).toBe("Listo 1 min");
  await openRow(el, "[data-fired-line=Bravas]");
  expect(text(find(el, "[data-fired-line=Bravas] [data-sent-details]"))).toBe("Detalles del plato");
  expect(second(el, "[data-served-line=Cancelado]")).toBe("Cancelado, cobrado");
  expect(text(find(el, "[data-serve-all]"))).toBe(es["table.serve_group"]);
});

it.each([
  ["en", "0.125", "0.25", "0.5", "0.375", "0.625"],
  ["es", "0,125", "0,25", "0,5", "0,375", "0,625"],
] as const)(
  "formats fractional sent dishes and extras in %s without changing service quantities",
  async (locale, ready, firing, served, held, companion) => {
    setLocale(locale);
    const el = await mount(
      current(
        [
          row("ready", {
            name: "Queso 1.5, × maduro",
            quantity: "0.125",
            unitPrecision: 3,
            readyAt: at(59),
            extras: [
              {
                lineId: "extra",
                name: "Salsa 0.5, × suave",
                quantity: "0.250",
                netAmount: "0.50",
                unitPriceGross: "2.00",
                priceQuantity: "1.000",
              },
            ],
          }),
          row("firing", { quantity: "0.250", unitPrecision: 3 }),
          row("served", { quantity: "0.500", unitPrecision: 3, servedQuantity: "0.500" }),
          row("charged", { quantity: "0.125", unitPrecision: 3, cancelledQuantity: "0.125" }),
        ],
        [
          group("g", [
            row("held", { quantity: "0.375", unitPrecision: 3, released: false }),
            row("companion", {
              quantity: "0.625",
              unitPrecision: 3,
              released: false,
              workingOrderId: "b2",
            }),
          ]),
        ],
      ),
    );
    const qty = (selector: string) => text(find(el, `${selector} .row-qty`));
    expect(qty("[data-fired-line=ready]")).toBe(ready);
    expect(text(find(el, "[data-fired-line=ready] .row-name"))).toBe("Queso 1.5, × maduro");
    expect(second(el, "[data-fired-line=ready]")).toContain(`Salsa 0.5, × suave ×${firing}`);
    expect(qty("[data-fired-line=firing]")).toBe(firing);
    expect(qty("[data-served-line=served]")).toBe(served);
    expect(qty("[data-served-line=charged]")).toBe(ready);
    expect(qty("[data-held-line=held]")).toBe(held);
    expect(qty("[data-companion=companion]")).toBe(companion);
    const calls = collect(el, "serve-lines");
    await serveLeft(el, "[data-fired-line=ready]");
    expect(calls).toEqual([{ items: [{ lineId: "ready", quantity: "0.125" }] }]);
  },
);

it("keeps a future snooze quiet and offers Clear snooze", async () => {
  const data = current(
    [],
    [
      group("g", [row("held", { released: false })], {
        remindAt: new Date(now + 300_000).toISOString(),
      }),
    ],
  );
  data.reminder = { groupId: "g", dueAt: new Date(now + 300_000).toISOString() };
  const el = await mount(data);
  expect(root(el).querySelector("[data-reminder-fire]")).toBeNull();
  const calls = collect(el, "unsnooze-group");
  await click(el, "[data-reminder-unsnooze]");
  expect(calls).toEqual([{ groupId: "g" }]);
  el.now = now + 300_000;
  await el.updateComplete;
  expect(root(el).querySelector("[data-reminder-fire]")).toBeTruthy();
});

it("refreshes translated labels in place", async () => {
  const el = await mount(current([row("Bravas", { readyAt: at(59) })]));
  setLocale("es");
  await el.updateComplete;
  expect(find(el, "h2").textContent).toBe("Enviado");
  expect(second(el, "[data-fired-line=Bravas]")).toBe("Listo 1 min");
});

it("keeps the browser menu off a fired dish during a touch hold", async () => {
  const el = await mount(current([row("Bravas", { readyAt: at(59) })]));
  expect(touchContextMenu(find(el, "[data-sent-row=Bravas]"))).toBe(true);
});

it("opens a held mouse press as information without serving on the following click", async () => {
  const el = await mount(current([row("Bravas", { readyAt: at(59) })]));
  const serves = collect(el, "serve-lines");
  const details = collect(el, "sent-line-info");
  const dish = find(el, "[data-sent-row=Bravas]");
  let activity = 0;
  el.parentElement!.addEventListener("pointerdown", () => activity++);
  dish.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 550));
  window.dispatchEvent(
    new PointerEvent("pointerup", {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    }),
  );
  dish.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, detail: 1 }));
  await el.updateComplete;
  expect(details).toEqual([{ lineId: "Bravas", workingOrderId: "b1", kind: "fired" }]);
  expect(serves).toEqual([]);
  expect(dish.getAttribute("aria-expanded")).toBe("false");
  expect(activity).toBe(1);
});

it("does not open or serve after pointer cancellation or a scrolling movement", async () => {
  const el = await mount(current([row("Bravas", { readyAt: at(59) })]));
  const serves = collect(el, "serve-lines");
  const details = collect(el, "sent-line-info");
  const dish = find(el, "[data-sent-row=Bravas]");
  for (const end of ["pointercancel", "pointermove"] as const) {
    dish.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        composed: true,
        pointerId: 1,
        pointerType: "touch",
        button: 0,
        clientX: 10,
        clientY: 10,
      }),
    );
    window.dispatchEvent(new PointerEvent(end, { pointerId: 1, clientX: 10, clientY: 50 }));
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 10, clientY: 50 }));
    dish.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, detail: 1 }));
    await el.updateComplete;
  }
  expect(serves).toEqual([]);
  expect(details).toEqual([]);
  expect(dish.getAttribute("aria-expanded")).toBe("false");
  dish.click();
  await el.updateComplete;
  expect(dish.getAttribute("aria-expanded")).toBe("true");
  find(el, "[data-fired-line=Bravas] [data-sent-serve]").click();
  expect(serves).toEqual([{ items: [{ lineId: "Bravas", quantity: "1" }] }]);
});

it("opens served and held details, preserving notes, extras and no-kitchen status", async () => {
  const el = await mount(
    current(
      [
        row("served", { servedQuantity: "1.000", servedAt: at(59), note: "No salt" }),
        row("water", {
          firedAt: null,
          readyAt: at(59),
          extras: [
            {
              lineId: "ice",
              name: "Ice",
              quantity: "1.000",
              netAmount: "0.25",
              unitPriceGross: "0.25",
              priceQuantity: "1.000",
            },
          ],
        }),
      ],
      [group("g", [row("held", { released: false })])],
    ),
  );
  const details = collect(el, "sent-line-info");
  expect(second(el, "[data-served-line=served]")).toBe("Station note: No salt · Served");
  expect(second(el, "[data-fired-line=water]")).toBe("Ice · Ready 1 min");
  await openDetails(el, "[data-held-line=held]");
  await openDetails(el, "[data-served-line=served]");
  expect(details).toEqual([
    { lineId: "held", workingOrderId: "b1", kind: "held" },
    { lineId: "served", workingOrderId: "b1", kind: "served" },
  ]);
  const old = find(el, "[data-served-line=served] [data-sent-details]");
  el.busy = true;
  old.click();
  el.busy = false;
  el.snapshot = null;
  old.click();
  el.remove();
  old.click();
  expect(details).toHaveLength(2);
});

it("rejects stale group/reminder commands and suppresses disabled service actions", async () => {
  const data = current([], [group("g", [row("held", { released: false })])]);
  data.reminder = { groupId: "g", dueAt: new Date(now).toISOString() };
  const el = await mount(data);
  const fire = find(el, "[data-group-fire=g]");
  const snooze = find(el, "[data-reminder-snooze]");
  const fires = collect(el, "fire-group"),
    snoozes = collect(el, "snooze-group");
  el.busy = true;
  fire.click();
  snooze.click();
  await el.updateComplete;
  expect((fire as HTMLElementTagNameMap["wt-button"]).variant).toBe("secondary");
  el.busy = false;
  el.snapshot = { scope: "visit-1", billId: "b1", current: { ...data, reminder: null } };
  snooze.click();
  el.snapshot = null;
  fire.click();
  el.remove();
  fire.click();
  expect(fires).toEqual([]);
  expect(snoozes).toEqual([]);
});

it("does not revive stale information controls for food that changed its service state", async () => {
  const el = await mount(current([row("Bravas", { readyAt: at(59) })]));
  const details = collect(el, "sent-line-info");
  await openRow(el, "[data-fired-line=Bravas]");
  const old = find(el, "[data-fired-line=Bravas] [data-sent-details]");
  el.snapshot = {
    scope: "visit-1",
    billId: "b1",
    current: current([row("Bravas", { servedAt: at(59), servedQuantity: "1.000" })]),
  };
  old.click();
  expect(details).toEqual([]);
});

it("does not turn a held-row hold followed by movement into serving, information or a drag", async () => {
  const el = await mount(
    current([row("ready", { readyAt: at(59) })], [group("g", [row("held", { released: false })])]),
  );
  const details = collect(el, "sent-line-info"),
    serves = collect(el, "serve-lines");
  const dish = find(el, "[data-held-line=held] .sent-row-open");
  dish.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 550));
  window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 10, clientY: 50 }));
  window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 10, clientY: 50 }));
  expect(details).toEqual([]);
  expect(serves).toEqual([]);
});

it("reads the live clock when none is injected and releases a pointer order after leaving the list", async () => {
  const data = current([
    row("ready", { readyAt: new Date(Date.now() - 60_000).toISOString() }),
    row("unknown", { firedAt: null }),
  ]);
  const el = await mount(data, { now: undefined });
  expect(second(el, "[data-fired-line=ready]")).toBe("Ready 1 min");
  expect(text(find(el, "[data-section-title]"))).toContain("Fired");
  const list = find(el, "[data-sent-row=ready]").parentElement!.parentElement!;
  list.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
  list.dispatchEvent(new PointerEvent("pointerleave"));
  await el.updateComplete;
  expect(find(el, "[data-sent-row=ready]")).toBeTruthy();
});

it("labels an unknown companion as another bill without exposing its internal id", async () => {
  const el = await mount(
    current(
      [],
      [
        group("g", [
          row("own", { released: false }),
          row("other", { released: false, workingOrderId: "internal-bill-id" }),
        ]),
      ],
    ),
  );
  expect(find(el, "[data-companion=other]").textContent).toContain("Another bill");
  expect(find(el, "[data-companion=other]").textContent).not.toContain("internal-bill-id");
});

it("marks a sent row's and a companion's dish name in the venue's content language", async () => {
  const previous = currentContentLanguages();
  setContentLanguages({ defaultLanguage: "ca", languages: ["ca"] });
  try {
    const el = await mount(
      current(
        [row("fired")],
        [
          group("g", [
            row("own", { released: false }),
            row("other", { released: false, workingOrderId: "bill-2" }),
          ]),
        ],
      ),
    );
    for (const selector of [
      "[data-fired-line=fired]",
      "[data-held-line=own]",
      "[data-companion=other]",
    ])
      expect(find(el, `${selector} .product-name`).getAttribute("lang"), selector).toBe("ca");
  } finally {
    setContentLanguages(previous);
  }
});

it("defers a newly due banner until the pressed row is released", async () => {
  const data = current(
    [row("Bravas", { readyAt: at(59) })],
    [group("g", [row("held", { released: false })])],
  );
  const el = await mount(data);
  const dish = find(el, "[data-sent-row=Bravas]");
  const before = dish.getBoundingClientRect().toJSON();
  dish.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerId: 1 }),
  );
  el.snapshot = {
    scope: "visit-1",
    billId: "b1",
    current: { ...data, reminder: { groupId: "g", dueAt: new Date(now).toISOString() } },
  };
  await el.updateComplete;
  expect(dish.getBoundingClientRect().toJSON()).toEqual(before);
  expect(root(el).querySelector("[data-reminder-fire]")).toBeNull();
  dish.dispatchEvent(
    new PointerEvent("pointercancel", { bubbles: true, composed: true, pointerId: 1 }),
  );
  await el.updateComplete;
  expect(root(el).querySelector("[data-reminder-fire]")).toBeTruthy();
});

it("names the due group's courses and its due clock time in the reminder", async () => {
  const data = current([], [group("g", [row("held", { released: false, courseId: "main" })])]);
  data.retainedCourses = [{ id: "main", name: "Mains", displayOrder: 1, fireNowZoneIds: [] }];
  data.reminder = { groupId: "g", dueAt: "2026-10-18T12:00:00" };
  const el = await mount(data, { now: Date.parse("2026-10-18T12:00:00") });
  expect(find(el, "[data-group-reminder=due]").textContent).toContain("Group 7 · Mains");
  expect(find(el, "[data-group-reminder=due]").textContent).toContain("12:00");
});

it("marks a reminder due at its own deadline without waiting for another server read or age tick", async () => {
  const data = current([], [group("g", [row("held", { released: false })])]);
  data.reminder = { groupId: "g", dueAt: new Date(Date.now() + 400).toISOString() };
  const el = await mount(data, { now: undefined });
  expect(root(el).querySelector("[data-reminder-fire]")).toBeNull();
  await vi.waitFor(() => expect(root(el).querySelector("[data-reminder-fire]")).toBeTruthy(), {
    timeout: 1500,
  });
});

it("refreshes Ready N min every 20 seconds while a fired row shows, and runs no timer unread, held-only or removed", async () => {
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"],
  });
  try {
    vi.setSystemTime(now);
    const el = await mount(current([row("ready", { readyAt: at(59) })]), {
      snapshot: null,
      now: undefined,
    });
    expect(vi.getTimerCount()).toBe(0);
    el.snapshot = {
      scope: "visit-1",
      billId: "b1",
      current: current([row("ready", { readyAt: at(59) })]),
    };
    await el.updateComplete;
    expect(second(el, "[data-fired-line=ready]")).toBe("Ready 1 min");
    await vi.advanceTimersByTimeAsync(20_000);
    await el.updateComplete;
    expect(second(el, "[data-fired-line=ready]")).toBe("Ready 1 min");
    await vi.advanceTimersByTimeAsync(40_000);
    await el.updateComplete;
    expect(second(el, "[data-fired-line=ready]")).toBe("Ready 2 min");
    el.snapshot = {
      scope: "visit-1",
      billId: "b1",
      current: current([], [group("g", [row("held", { released: false })])]),
    };
    await el.updateComplete;
    expect(vi.getTimerCount()).toBe(0);
    el.snapshot = {
      scope: "visit-1",
      billId: "b1",
      current: current([row("ready", { readyAt: at(59) })]),
    };
    await el.updateComplete;
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    el.remove();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("keeps a wholly served heading's fired age moving without a server read", async () => {
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"],
  });
  try {
    vi.setSystemTime(now);
    const done = row("done", { servedQuantity: "1.000", servedAt: at(50) });
    const el = await mount(current([], [group("g", [done], { state: "fired", firedAt: at(48) })]), {
      now: undefined,
    });
    const age = find(el, "[data-sent-section=g] till-fired-ago");
    expect(text(age)).toBe("Fired 12 min ago");
    await vi.advanceTimersByTimeAsync(60_000);
    await el.updateComplete;
    expect(text(age)).toBe("Fired 13 min ago");
  } finally {
    vi.useRealTimers();
  }
});

it("moves fired ages on their own clocks, redrawing the list only while a Ready age shows", async () => {
  vi.useFakeTimers({
    toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"],
  });
  try {
    vi.setSystemTime(now);
    const el = await mount(
      current(
        [],
        [
          group("g", [row("soup", { firedAt: at(50) })], { state: "fired", firedAt: at(48) }),
          group(
            "h",
            [
              row("early", { lineNo: 2, firedAt: at(40) }),
              row("later", { lineNo: 3, released: false, firedAt: null }),
            ],
            { position: 2 },
          ),
        ],
      ),
      { now: undefined },
    );
    const render = vi.spyOn(el as unknown as { render(): unknown }, "render");
    await vi.advanceTimersByTimeAsync(60_000);
    await el.updateComplete;
    expect(text(find(el, "[data-sent-section=g] [data-section-title]"))).toBe("Fired 13 min ago");
    expect(second(el, "[data-fired-line=early]")).toBe("Fired 21 min ago");
    expect(render).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("keeps unreleased fired food visible but serves only released remainders", async () => {
  const el = await mount(
    current([
      row("held-extra", { released: false, firedAt: null }),
      row("served", { servedQuantity: "1.000", servedAt: at(59), lineNo: 2 }),
    ]),
  );
  const all = find(el, "[data-serve-all]") as HTMLElement & { disabled: boolean };
  expect(all.disabled).toBe(true);
  expect(all.getAttribute("variant")).toBe("ghost");
  await openRow(el, '[data-fired-line="held-extra"]');
  expect(every(el, '[data-fired-line="held-extra"] [data-sent-serve]')).toEqual([]);
  expect(find(el, '[data-fired-line="held-extra"]').textContent).toContain("3.00");
  const calls = collect(el, "serve-lines");
  all.click();
  expect(calls).toEqual([]);
  el.snapshot = { ...el.snapshot!, current: current([row("held-extra")]) };
  await el.updateComplete;
  expect(all.disabled).toBe(false);
  expect(all.getAttribute("variant")).toBe("ghost");
  await click(el, "[data-serve-all]");
  expect(calls).toEqual([{ items: [{ lineId: "held-extra", quantity: "1" }] }]);
});

it("refuses a retained serve control when the latest row has an unreleased component", async () => {
  const el = await mount(current([row("Bravas")]));
  await openRow(el, '[data-fired-line="Bravas"]');
  const dish = find(el, '[data-fired-line="Bravas"] [data-sent-serve]');
  const all = find(el, "[data-serve-all]");
  const calls = collect(el, "serve-lines");
  el.snapshot = { ...el.snapshot!, current: current([row("Bravas", { released: false })]) };
  dish.click();
  all.click();
  expect(calls).toEqual([]);
  await el.updateComplete;
  expect(find(el, '[data-fired-line="Bravas"] [data-sent-row]').getAttribute("aria-expanded")).toBe(
    "true",
  );
  expect(every(el, '[data-fired-line="Bravas"] [data-sent-serve]')).toEqual([]);
});

const burgers = [billLine("burger-1", 1), billLine("burger-2", 2), billLine("burger-3", 3)];

it("A803 portion grouping: two identical sent portions show one row of 2, and its Serve 2 serves both", async () => {
  const el = await mount(
    current([
      burger("burger-2", 2),
      burger("burger-1", 1),
      burger("burger-3", 3, { readyAt: at(50) }),
    ]),
    { lines: burgers },
  );
  expect(shownLines(el, "data-fired-line")).toEqual([
    ["burger-3", "1", "Burger", "€9.50"],
    ["burger-1", "2", "Burger", "€19.00"],
  ]);
  const calls = collect(el, "serve-lines");
  await serveLeft(el, "[data-fired-line=burger-1]");
  expect(calls).toEqual([
    {
      items: [
        { lineId: "burger-1", quantity: "1" },
        { lineId: "burger-2", quantity: "1" },
      ],
    },
  ]);
});

it("one row per dish: identical portions with some served read as one row, and its last Serve serves what is left", async () => {
  const el = await mount(
    current([
      burger("burger-1", 1, { servedQuantity: "1.000", servedAt: at(55) }),
      burger("burger-2", 2),
      burger("burger-3", 3),
    ]),
    { lines: [{ ...burgers[0]!, servedAt: at(55) }, burgers[1]!, burgers[2]!] },
  );
  expect(every(el, "li").length).toBe(1);
  expect(shownLines(el, "data-fired-line")).toEqual([["burger-2", "3", "Burger", "€28.50"]]);
  expect(second(el, "[data-fired-line=burger-2]")).toBe("1 of 3 served");
  const calls = collect(el, "serve-lines");
  await serveLeft(el, "[data-fired-line=burger-2]");
  expect(calls).toEqual([
    {
      items: [
        { lineId: "burger-2", quantity: "1" },
        { lineId: "burger-3", quantity: "1" },
      ],
    },
  ]);
});

it("A803 portion grouping: identical held portions show one row in their group", async () => {
  const held = { released: false, firedAt: null };
  const el = await mount(
    current([], [group("g", [burger("burger-1", 1, held), burger("burger-2", 2, held)])]),
    { lines: burgers.map((line) => ({ ...line, firedAt: null, groupId: "g" })) },
  );
  expect(shownLines(el, "data-held-line")).toEqual([["burger-1", "2", "Burger", "€19.00"]]);
  expect(second(el, "[data-held-line=burger-1]")).toBe("");
});

it("A803 portion grouping: a portion ticked for a guest's allergy stands apart from its twin", async () => {
  const el = await mount(
    current([burger("burger-1", 1), burger("burger-2", 2), burger("burger-3", 3)]),
    {
      lines: burgers,
      allergy: {
        answer: "allergies",
        guests: [
          { id: "guest", position: 0, who: "Blue shirt", allergens: { milk: {} }, note: null },
        ],
        ticks: [{ guestId: "guest", draftLineId: null, workingLineId: "burger-3" }],
        changedBy: null,
        changedAt: null,
        revision: 1,
      },
    } as Partial<Panel>,
  );
  expect(shownLines(el, "data-fired-line")).toEqual([
    ["burger-1", "2", "Burger", "€19.00"],
    ["burger-3", "1", "BurgerBlue shirt", "€9.50"],
  ]);
});

it("A803 portion grouping: a grouped row's information names every member by line number", async () => {
  const held = { released: false, firedAt: null };
  const el = await mount(
    current([], [group("g", [burger("burger-2", 2, held), burger("burger-1", 1, held)])]),
    { lines: burgers.map((line) => ({ ...line, firedAt: null, groupId: "g" })) },
  );
  const details = collect(el, "sent-line-info");
  await openDetails(el, "[data-held-line=burger-1]");
  expect(details).toEqual([
    { lineId: "burger-1", workingOrderId: "b1", kind: "held", lineIds: ["burger-1", "burger-2"] },
  ]);
});

it("A803 portion grouping: a long press on a grouped row names every member", async () => {
  const el = await mount(current([burger("burger-2", 2), burger("burger-1", 1)]), {
    lines: burgers,
  });
  const serves = collect(el, "serve-lines");
  const details = collect(el, "sent-line-info");
  const dish = find(el, "[data-sent-row=burger-1]");
  dish.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 550));
  window.dispatchEvent(
    new PointerEvent("pointerup", { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 }),
  );
  dish.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, detail: 1 }));
  await el.updateComplete;
  expect(details).toEqual([
    { lineId: "burger-1", workingOrderId: "b1", kind: "fired", lineIds: ["burger-1", "burger-2"] },
  ]);
  expect(serves).toEqual([]);
});

it("A803 portion grouping: a long press on a part-served row names what is left and what was served", async () => {
  const el = await mount(
    current([
      burger("burger-3", 3),
      burger("burger-1", 1, { servedQuantity: "1.000", servedAt: at(50) }),
      burger("burger-2", 2),
    ]),
    { lines: burgers },
  );
  const details = collect(el, "sent-line-info");
  const dish = find(el, "[data-sent-row=burger-2]");
  dish.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 10,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 550));
  window.dispatchEvent(
    new PointerEvent("pointerup", { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 }),
  );
  await el.updateComplete;
  expect(details).toEqual([
    {
      lineId: "burger-2",
      workingOrderId: "b1",
      kind: "fired",
      lineIds: ["burger-2", "burger-3"],
      servedLineIds: ["burger-1"],
    },
  ]);
});

describe("A773 at the pass", () => {
  const atPass = (id: string, over: Partial<CurrentOrderRow> = {}) =>
    row(id, {
      firedAt: null,
      kitchen: {
        state: "queued",
        firedAt: null,
        stationId: "grill",
        movable: false,
        phase: "requested",
        requestedAt: at(45),
      },
      ...over,
    });

  it("says a released dish the kitchen asked for is at the pass under a Fired heading", async () => {
    setLocale("es");
    const el = await mount(
      current(
        [
          atPass("burger"),
          row("unknown", { firedAt: null, lineNo: 2 }),
          row("queued", {
            lineNo: 3,
            firedAt: at(50),
            kitchen: {
              state: "queued",
              firedAt: at(50),
              stationId: "grill",
              movable: false,
              phase: "waiting",
              requestedAt: at(50),
            },
          }),
        ],
        [group("g", [row("held", { released: false, firedAt: null })])],
      ),
    );
    expect(headings(el)).toEqual([
      [es["table.group_held"], "", ["fire"]],
      [es["table.group_fired_ago"].replace("{n}", "10").replace(/\s/g, " "), "sent", ["serve all"]],
    ]);
    expect(second(el, "[data-fired-line=burger]")).toBe(es["table.at_the_pass"]);
    expect(second(el, "[data-fired-line=unknown]")).toBe("");
    expect(second(el, "[data-fired-line=queued]")).toBe("");
    expect(second(el, "[data-held-line=held]")).toBe("");
  });

  it("writes At the pass capitalised, as the other states read, in English and Spanish", async () => {
    const title = async () =>
      text(find(await mount(current([atPass("burger")])), "[data-section-title]"));
    expect(await title()).toBe("At the pass");
    setLocale("es");
    expect(await title()).toBe(es["table.at_the_pass"]);
  });

  it("heads a section whose every waiting dish is at the pass At the pass, never Fired, in Spanish", async () => {
    setLocale("es");
    const el = await mount(
      current([
        atPass("burger"),
        atPass("chips", { lineNo: 2 }),
        row("done", { lineNo: 3, servedQuantity: "1.000", servedAt: at(55) }),
      ]),
    );
    const title = text(find(el, "[data-section-title]"));
    expect(title).toBe(es["table.at_the_pass"]);
    expect(title).not.toContain(es["table.group_fired"]);
    expect(find(el, "wt-course-heading").getAttribute("mark")).toBe("sent");
    expect(find(el, "[data-serve-all]")).toBeTruthy();
    expect(second(el, "[data-fired-line=burger]")).toBe("");
    expect(second(el, "[data-served-line=done]")).toBe(es["table.row_served"]);
  });

  it("says a dish is at the pass while one of its kitchen items waits there, though its own has fired", async () => {
    const el = await mount(
      current([
        row("burger", {
          firedAt: null,
          requestedAt: at(44),
          kitchen: {
            state: "queued",
            firedAt: at(45),
            stationId: "grill",
            movable: false,
            phase: "waiting",
            requestedAt: at(45),
          },
        }),
      ]),
    );
    expect(text(find(el, "[data-section-title]"))).toBe("At the pass");
  });

  it("does not say a dish is at the pass until the waiter has released it", async () => {
    const el = await mount(current([atPass("burger", { released: false })]));
    expect(text(find(el, "[data-section-title]"))).toBe("Fired");
  });
});

it("combines covered soups of the same type but separates a surcharge and another menu type", async () => {
  const types = [
    ["daily-one", "daily"],
    ["daily-two", "daily"],
    ["special-one", "special"],
    ["daily-three", "daily-older"],
    ["daily-four", "daily-later"],
  ] as const;
  const copies = [
    ["daily-copy", "daily"],
    ["special-copy", "special"],
    ["daily-older-copy", "daily"],
    ["daily-later-copy", "daily"],
  ] as const;
  const setMenus: BillSetMenuState = {
    copies: copies.map(([id, setMenuId]) => ({
      id,
      setMenuId,
      versionId: id,
      name: setMenuId,
      priceCents: 1400,
      lines: [],
      dishes: [],
    })),
    recorded: {},
    exact: true,
    setMenus: types.map(([id, type], index) => ({
      lineId: id,
      copyId: `${type}-copy`,
      lineNo: 10 + index,
    })),
    dishes: (
      [
        ["soup-one", "daily-one", 0],
        ["soup-two", "daily-two", 0],
        ["soup-three", "daily-four", 0],
        ["soup-surcharge", "daily-three", 500],
        ["soup-special", "special-one", 0],
      ] as const
    ).map(([lineId, setMenuLineId, priceCents]) => ({
      lineId,
      setMenuLineId,
      priceCents,
      productId: "soup",
      variantId: null,
      place: 0,
      countsAsCourseId: "starter",
      movable: true,
    })),
  };
  const lines = setMenus.dishes.map(({ lineId, priceCents }, index) => ({
    ...billLine(lineId, index + 1),
    name: "Soup",
    productId: "soup",
    unitPriceGross: priceCents === 500 ? "5.00" : "0.00",
  }));
  const data = current(
    lines.map((line) =>
      row(line.id, {
        lineNo: line.lineNo,
        name: line.name,
        netAmount: line.unitPriceGross,
        readyAt: at(50),
      }),
    ),
  );
  const el = await mount(data, { lines, setMenus });
  expect(shownLines(el, "data-fired-line")).toEqual([
    ["soup-one", "3", "Soup menu", "€0.00"],
    ["soup-special", "1", "Soup menu", "€0.00"],
    ["soup-surcharge", "1", "Soup +€5.00", "€5.00"],
  ]);
});
