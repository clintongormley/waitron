import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import type { CurrentOrderRow, CurrentOrders, TabLine } from "../api/kitchen-api.js";
import { es } from "../i18n/strings.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import {
  at,
  burgerDish,
  burgerLine,
  now,
  sentCurrent,
  sentDish,
  sentGroup,
} from "../../test/sent-rows.js";
import "./sent-orders.js";

type Panel = LitElement & {
  scope: string;
  billId: string;
  snapshot: { scope: string; billId: string; current: CurrentOrders } | null;
  busy: boolean;
  now: number;
  lines: readonly TabLine[];
};
const burgers = [burgerLine("burger-1", 1), burgerLine("burger-2", 2), burgerLine("burger-3", 3)];

const viewport = [innerWidth, innerHeight] as const;
beforeEach(() => setLocale("en"));
afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(...viewport);
});
async function mount(data: CurrentOrders, over: Partial<Panel> = {}) {
  return (
    await mountWidget<Panel>("till-sent-orders", {
      scope: "visit-1",
      billId: "b1",
      snapshot: { scope: "visit-1", billId: "b1", current: data },
      now,
      busy: false,
      ...over,
    })
  ).el;
}
const root = (el: Panel) => el.shadowRoot!;
const find = (el: Panel, selector: string) => root(el).querySelector<HTMLElement>(selector);
const text = (node: Element) => node.textContent!.replace(/\s+/g, " ").trim();
const toggle = (line: string) => `[data-sent-row="${line}"]`;
async function tap(el: Panel, selector: string) {
  await userEvent.click(page.elementLocator(find(el, selector)!));
  await el.updateComplete;
}
function collect(el: Panel, name: string) {
  const calls: unknown[] = [];
  el.addEventListener(name, (event) => calls.push((event as CustomEvent).detail));
  return calls;
}
/** The open row's line id, its count line and its Serve buttons' words. */
const opened = (el: Panel) =>
  [...root(el).querySelectorAll<HTMLElement>("li[data-open]")].map((li) => [
    li.querySelector("[data-sent-row]")!.getAttribute("data-sent-row"),
    text(li.querySelector("[data-sent-open-count]")!),
    [...li.querySelectorAll("[data-sent-serve]")].map(text),
  ]);

it("a tap opens one row, a second tap closes it, and a tap on another row moves the box", async () => {
  const el = await mount(sentCurrent([sentDish("bravas"), sentDish("water", { lineNo: 2 })]));
  expect(find(el, toggle("bravas"))!.getAttribute("aria-expanded")).toBe("false");
  await tap(el, toggle("bravas"));
  expect(opened(el)).toEqual([["bravas", "0 of 1 served", ["Serve 1"]]]);
  expect(find(el, toggle("bravas"))!.getAttribute("aria-expanded")).toBe("true");
  await tap(el, toggle("water"));
  expect(opened(el)).toEqual([["water", "0 of 1 served", ["Serve 1"]]]);
  expect(find(el, toggle("bravas"))!.getAttribute("aria-expanded")).toBe("false");
  await tap(el, toggle("water"));
  expect(opened(el)).toEqual([]);
});

it("a tap serves nothing on its own", async () => {
  const el = await mount(sentCurrent([sentDish("bravas", { quantity: "2.000" })]));
  const serves = collect(el, "serve-lines");
  await tap(el, toggle("bravas"));
  await tap(el, toggle("bravas"));
  expect(serves).toEqual([]);
});

it("counts two identical portions as 0 of 2 and serves the first by line number, or both, once each", async () => {
  const el = await mount(sentCurrent([burgerDish("burger-2", 2), burgerDish("burger-1", 1)]), {
    lines: burgers,
  });
  const serves = collect(el, "serve-lines");
  await tap(el, toggle("burger-1"));
  expect(opened(el)).toEqual([["burger-1", "0 of 2 served", ["Serve 1", "Serve 2"]]]);
  await tap(el, "[data-sent-serve=one]");
  expect(serves).toEqual([{ items: [{ lineId: "burger-1", quantity: "1" }] }]);
  await tap(el, "[data-sent-serve=rest]");
  expect(serves).toEqual([
    { items: [{ lineId: "burger-1", quantity: "1" }] },
    {
      items: [
        { lineId: "burger-1", quantity: "1" },
        { lineId: "burger-2", quantity: "1" },
      ],
    },
  ]);
});

it("reads 1 of 3 served on one line of 3 and on three identical lines of 1", async () => {
  const line = await mount(
    sentCurrent([sentDish("bravas", { quantity: "3.000", servedQuantity: "1.000" })]),
  );
  await tap(line, toggle("bravas"));
  expect(opened(line)).toEqual([["bravas", "1 of 3 served", ["Serve 1", "Serve 2"]]]);
  cleanupWidgets();
  const portions = await mount(
    sentCurrent([
      burgerDish("burger-1", 1, { servedQuantity: "1.000", servedAt: at(55) }),
      burgerDish("burger-2", 2),
      burgerDish("burger-3", 3),
    ]),
    { lines: [{ ...burgers[0]!, servedAt: at(55) }, burgers[1]!, burgers[2]!] },
  );
  await tap(portions, toggle("burger-2"));
  expect(opened(portions)).toEqual([["burger-2", "1 of 3 served", ["Serve 1", "Serve 2"]]]);
  const serves = collect(portions, "serve-lines");
  await tap(portions, "[data-sent-serve=one]");
  expect(serves).toEqual([{ items: [{ lineId: "burger-2", quantity: "1" }] }]);
});

it("Serve 1 on one line showing 3 sends 1, and Serve 3 sends all of it", async () => {
  const el = await mount(sentCurrent([sentDish("bravas", { quantity: "3.000" })]));
  const serves = collect(el, "serve-lines");
  await tap(el, toggle("bravas"));
  expect(opened(el)).toEqual([["bravas", "0 of 3 served", ["Serve 1", "Serve 3"]]]);
  await tap(el, "[data-sent-serve=one]");
  await tap(el, "[data-sent-serve=rest]");
  expect(serves).toEqual([
    { items: [{ lineId: "bravas", quantity: "1" }] },
    { items: [{ lineId: "bravas", quantity: "3" }] },
  ]);
});

it("a weighed dish, or one not counted in whole portions, offers one Serve for the whole of it", async () => {
  const el = await mount(
    sentCurrent([
      sentDish("ham", { quantity: "0.350", unitPrecision: 3 }),
      sentDish("wine", { quantity: "2.000", countsWholePortions: false, lineNo: 2 }),
    ]),
  );
  const serves = collect(el, "serve-lines");
  await tap(el, toggle("ham"));
  expect(opened(el)).toEqual([["ham", "0 of 0.35 served", ["Serve"]]]);
  await tap(el, "[data-sent-serve=whole]");
  await tap(el, toggle("wine"));
  expect(opened(el)).toEqual([["wine", "0 of 2 served", ["Serve"]]]);
  await tap(el, "[data-sent-serve=whole]");
  expect(serves).toEqual([
    { items: [{ lineId: "ham", quantity: "0.35" }] },
    { items: [{ lineId: "wine", quantity: "2" }] },
  ]);
});

it("after Serve 1 the same row stays open and reads the new count", async () => {
  const el = await mount(sentCurrent([sentDish("bravas", { quantity: "3.000" })]));
  await tap(el, toggle("bravas"));
  await tap(el, "[data-sent-serve=one]");
  el.snapshot = {
    ...el.snapshot!,
    current: sentCurrent([
      sentDish("bravas", { quantity: "3.000", servedQuantity: "1.000", servedAt: at(59) }),
    ]),
  };
  await el.updateComplete;
  expect(opened(el)).toEqual([["bravas", "1 of 3 served", ["Serve 1", "Serve 2"]]]);
});

it("a wholly served row, a held row and a row not yet released open with no Serve", async () => {
  const el = await mount(
    sentCurrent(
      [
        sentDish("done", { quantity: "2.000", servedQuantity: "2.000", servedAt: at(50) }),
        sentDish("waiting", { released: false, firedAt: null, lineNo: 2 }),
      ],
      [sentGroup("g", [sentDish("held", { released: false, firedAt: null, lineNo: 3 })])],
    ),
  );
  await tap(el, toggle("done"));
  // Its second line already reads Served, so no count repeats it.
  expect(text(find(el, "li[data-open] .row-more")!)).toBe("Served");
  expect(find(el, "li[data-open] [data-sent-open-count]")).toBeNull();
  expect(find(el, "li[data-open] [data-sent-serve]")).toBeNull();
  expect(find(el, "li[data-open] [data-sent-details]")).not.toBeNull();
  for (const [line, count] of [
    ["waiting", "0 of 1 served"],
    ["held", "0 of 1 served"],
  ] as const) {
    await tap(el, toggle(line));
    expect(opened(el)).toEqual([[line, count, []]]);
    expect(find(el, "li[data-open] [data-sent-details]")).not.toBeNull();
  }
});

it("sends nothing when any portion of the row changed since it was drawn", async () => {
  const el = await mount(sentCurrent([burgerDish("burger-1", 1), burgerDish("burger-2", 2)]), {
    lines: burgers,
  });
  const serves = collect(el, "serve-lines");
  await tap(el, toggle("burger-1"));
  const one = find(el, "[data-sent-serve=one]")!;
  const rest = find(el, "[data-sent-serve=rest]")!;
  // The portion Serve 1 would not send was served elsewhere.
  el.snapshot = {
    ...el.snapshot!,
    current: sentCurrent([
      burgerDish("burger-1", 1),
      burgerDish("burger-2", 2, { servedQuantity: "1.000", servedAt: at(59) }),
    ]),
  };
  one.click();
  rest.click();
  expect(serves).toEqual([]);
  await el.updateComplete;
  expect(opened(el)).toEqual([["burger-1", "1 of 2 served", ["Serve 1"]]]);
});

it("sends nothing on one line whose quantity changed since it was drawn", async () => {
  const el = await mount(sentCurrent([sentDish("bravas", { quantity: "3.000" })]));
  const serves = collect(el, "serve-lines");
  await tap(el, toggle("bravas"));
  const one = find(el, "[data-sent-serve=one]")!;
  el.snapshot = {
    ...el.snapshot!,
    current: sentCurrent([sentDish("bravas", { quantity: "4.000" })]),
  };
  one.click();
  expect(serves).toEqual([]);
});

const bravasLine: TabLine = {
  ...burgerLine("bravas", 1),
  name: "Bravas",
  productId: "bravas",
  menuItemId: "offer-bravas",
  quantity: "3.000",
  portion: false,
};

it.each<[string, Partial<CurrentOrderRow>, TabLine[]?]>([
  ["the dish drawn on the line", { name: "Croquetas" }],
  ["the bill line's dish", {}, [{ ...bravasLine, productId: "croquetas" }]],
  [
    "the line's extras",
    {
      extras: [
        {
          lineId: "aioli",
          name: "Aioli",
          quantity: "1.000",
          netAmount: "0.50",
          unitPriceGross: "0.50",
          priceQuantity: "1.000",
        },
      ],
    },
  ],
  ["the line's note", { note: "no salt" }],
  ["the serving unit's decimals", { unitPrecision: 3 }],
  ["whether it counts whole portions", { countsWholePortions: false }],
  [
    "the total and served amounts, leaving the same left",
    { quantity: "4.000", servedQuantity: "1.000" },
  ],
  [
    "the total and cancelled amounts, leaving the same left",
    { quantity: "4.000", cancelledQuantity: "1.000" },
  ],
])("sends nothing when %s changed since the row was drawn", async (_change, over, lines) => {
  const el = await mount(sentCurrent([sentDish("bravas", { quantity: "3.000" })]), {
    lines: [bravasLine],
  });
  const serves = collect(el, "serve-lines");
  await tap(el, toggle("bravas"));
  const one = find(el, "[data-sent-serve=one]")!;
  el.snapshot = {
    ...el.snapshot!,
    current: sentCurrent([sentDish("bravas", { quantity: "3.000", ...over })]),
  };
  if (lines !== undefined) el.lines = lines;
  one.click();
  expect(serves).toEqual([]);
});

it.each<[string, (el: Panel) => Promise<void> | void]>([
  ["after the row closed", (el) => tap(el, toggle("bravas"))],
  [
    "after the row closed and opened again",
    async (el) => {
      await tap(el, toggle("bravas"));
      await tap(el, toggle("bravas"));
    },
  ],
  ["after another row opened", (el) => tap(el, toggle("water"))],
  [
    "after another row opened, before the list drew again",
    (el) => find(el, toggle("water"))!.click(),
  ],
  [
    "once the party changed, before the list drew again",
    (el) => {
      el.scope = "visit-2";
      el.snapshot = { ...el.snapshot!, scope: "visit-2" };
    },
  ],
  [
    "once its line moved to the bill now shown, before the list drew again",
    (el) => {
      el.billId = "b2";
      el.snapshot = {
        scope: "visit-1",
        billId: "b2",
        current: sentCurrent([
          sentDish("bravas", { quantity: "3.000", workingOrderId: "b2" }),
          sentDish("water", { lineNo: 2, workingOrderId: "b2" }),
        ]),
      };
    },
  ],
])("a retained Serve button sends nothing %s", async (_when, change) => {
  const el = await mount(
    sentCurrent([sentDish("bravas", { quantity: "3.000" }), sentDish("water", { lineNo: 2 })]),
  );
  const serves = collect(el, "serve-lines");
  const details = collect(el, "sent-line-info");
  await tap(el, toggle("bravas"));
  const one = find(el, "[data-sent-serve=one]")!;
  const info = find(el, "[data-sent-details]")!;
  const drawn = change(el);
  if (drawn !== undefined) await drawn;
  one.click();
  info.click();
  expect(serves).toEqual([]);
  expect(details).toEqual([]);
});

it("stays open after Serve 1 when the served portion joins an identical one further along", async () => {
  const ready = { readyAt: at(55) };
  const el = await mount(
    sentCurrent([
      burgerDish("burger-1", 1, ready),
      burgerDish("burger-2", 2),
      burgerDish("burger-3", 3),
    ]),
    { lines: burgers },
  );
  const serves = collect(el, "serve-lines");
  await tap(el, toggle("burger-2"));
  expect(opened(el)).toEqual([["burger-2", "0 of 2 served", ["Serve 1", "Serve 2"]]]);
  await tap(el, "[data-sent-serve=one]");
  const served = { servedQuantity: "1.000", servedAt: at(59) };
  el.snapshot = {
    ...el.snapshot!,
    current: sentCurrent([
      burgerDish("burger-1", 1, ready),
      burgerDish("burger-2", 2, served),
      burgerDish("burger-3", 3),
    ]),
  };
  el.lines = [burgers[0]!, { ...burgers[1]!, servedAt: at(59) }, burgers[2]!];
  await el.updateComplete;
  expect(opened(el)).toEqual([["burger-3", "0 of 1 served", ["Serve 1"]]]);
  await tap(el, "[data-sent-serve=one]");
  expect(serves).toEqual([
    { items: [{ lineId: "burger-2", quantity: "1" }] },
    { items: [{ lineId: "burger-3", quantity: "1" }] },
  ]);
  // With none of it left, the row holding its served portions stays open.
  el.snapshot = {
    ...el.snapshot!,
    current: sentCurrent([
      burgerDish("burger-1", 1, ready),
      burgerDish("burger-2", 2, served),
      burgerDish("burger-3", 3, served),
    ]),
  };
  el.lines = [burgers[0]!, ...burgers.slice(1).map((line) => ({ ...line, servedAt: at(59) }))];
  await el.updateComplete;
  expect(opened(el)).toEqual([["burger-1", "2 of 3 served", ["Serve 1"]]]);
});

it("keeps the box open with its buttons disabled while busy, and sends nothing", async () => {
  const el = await mount(sentCurrent([sentDish("bravas", { quantity: "2.000" })]));
  const serves = collect(el, "serve-lines");
  const details = collect(el, "sent-line-info");
  await tap(el, toggle("bravas"));
  el.busy = true;
  // Before the list draws again, the buttons are not yet disabled.
  find(el, "[data-sent-serve=one]")!.click();
  find(el, "[data-sent-details]")!.click();
  await el.updateComplete;
  expect(opened(el)).toEqual([["bravas", "0 of 2 served", ["Serve 1", "Serve 2"]]]);
  const buttons = [
    ...root(el).querySelectorAll<HTMLButtonElement>("li[data-open] [data-sent-open] button"),
  ];
  expect(buttons.map((button) => button.disabled)).toEqual([true, true, true]);
  for (const button of buttons) button.click();
  expect(serves).toEqual([]);
  expect(details).toEqual([]);
});

it("refuses a press from a button drawn before the row stopped being released", async () => {
  const el = await mount(sentCurrent([sentDish("bravas")]));
  const serves = collect(el, "serve-lines");
  await tap(el, toggle("bravas"));
  const one = find(el, "[data-sent-serve=one]")!;
  el.snapshot = {
    ...el.snapshot!,
    current: sentCurrent([sentDish("bravas", { released: false, firedAt: null })]),
  };
  one.click();
  expect(serves).toEqual([]);
});

it("closes when the bill changes or no row holds its line any more", async () => {
  const el = await mount(sentCurrent([sentDish("bravas"), sentDish("water", { lineNo: 2 })]));
  await tap(el, toggle("bravas"));
  el.snapshot = { ...el.snapshot!, current: sentCurrent([sentDish("water", { lineNo: 2 })]) };
  await el.updateComplete;
  expect(opened(el)).toEqual([]);
  el.snapshot = {
    ...el.snapshot!,
    current: sentCurrent([sentDish("bravas"), sentDish("water", { lineNo: 2 })]),
  };
  await el.updateComplete;
  expect(opened(el)).toEqual([]);
  await tap(el, toggle("water"));
  el.billId = "b2";
  el.snapshot = { scope: "visit-1", billId: "b2", current: sentCurrent([]) };
  await el.updateComplete;
  el.billId = "b1";
  el.snapshot = {
    scope: "visit-1",
    billId: "b1",
    current: sentCurrent([sentDish("bravas"), sentDish("water", { lineNo: 2 })]),
  };
  await el.updateComplete;
  expect(opened(el)).toEqual([]);
});

it("Dish details opens the dish window as the ⓘ did, without serving", async () => {
  const el = await mount(
    sentCurrent([
      burgerDish("burger-3", 3),
      burgerDish("burger-1", 1, { servedQuantity: "1.000", servedAt: at(50) }),
      burgerDish("burger-2", 2),
    ]),
    { lines: burgers },
  );
  const serves = collect(el, "serve-lines");
  const details = collect(el, "sent-line-info");
  await tap(el, toggle("burger-2"));
  expect(text(find(el, "[data-sent-details]")!)).toBe("Dish details");
  await tap(el, "[data-sent-details]");
  expect(details).toEqual([
    {
      lineId: "burger-2",
      workingOrderId: "b1",
      kind: "fired",
      lineIds: ["burger-2", "burger-3"],
      servedLineIds: ["burger-1"],
    },
  ]);
  expect(serves).toEqual([]);
});

it("holding a row still opens the dish window, and does not open the row", async () => {
  const el = await mount(sentCurrent([sentDish("bravas", { readyAt: at(59) })]));
  const serves = collect(el, "serve-lines");
  const details = collect(el, "sent-line-info");
  const dish = find(el, toggle("bravas"))!;
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
  expect(details).toEqual([{ lineId: "bravas", workingOrderId: "b1", kind: "fired" }]);
  expect(serves).toEqual([]);
  expect(opened(el)).toEqual([]);
});

it("draws the opened row as the new rows' box, its text in full colour and weight", async () => {
  const el = await mount(sentCurrent([sentDish("bravas", { quantity: "2.000" })]));
  const li = find(el, "[data-fired-line=bravas]")!;
  const closedQty = getComputedStyle(li.querySelector(".row-qty")!).fontWeight;
  await tap(el, toggle("bravas"));
  const style = getComputedStyle(li);
  const probe = document.createElement("span");
  probe.style.color = "var(--wt-color-primary)";
  probe.style.backgroundColor = "var(--wt-color-surface)";
  probe.style.borderRadius = "var(--wt-radius-md)";
  probe.style.marginTop = "var(--wt-space-1)";
  probe.style.marginLeft = "var(--wt-space-2)";
  probe.style.fontWeight = "var(--wt-font-weight-bold)";
  probe.style.outlineColor = "var(--wt-color-text)";
  root(el).append(probe);
  const want = getComputedStyle(probe);
  expect(style.borderTopWidth).toBe("2px");
  expect(style.borderTopColor).toBe(want.color);
  expect(style.borderBottomColor).toBe(want.color);
  expect(style.borderTopLeftRadius).toBe(want.borderRadius);
  expect(style.backgroundColor).toBe(want.backgroundColor);
  expect(style.marginTop).toBe(want.marginTop);
  expect(style.marginLeft).toBe(want.marginLeft);
  expect(style.color).toBe(want.outlineColor);
  const qty = getComputedStyle(li.querySelector(".row-qty")!).fontWeight;
  expect(qty).toBe(want.fontWeight);
  expect(qty).not.toBe(closedQty);
  for (const button of li.querySelectorAll<HTMLElement>("[data-sent-open] button")) {
    const rect = button.getBoundingClientRect();
    expect(rect.height).toBe(44);
    expect(getComputedStyle(button).fontWeight).toBe(want.fontWeight);
  }
  const count = getComputedStyle(li.querySelector("[data-sent-open-count]")!);
  expect(count.color).not.toBe(want.outlineColor);
  probe.remove();
});

it("reads the count and Serve words in Spanish", async () => {
  setLocale("es");
  const el = await mount(
    sentCurrent([sentDish("bravas", { quantity: "3.000", servedQuantity: "1.000" })]),
  );
  await tap(el, toggle("bravas"));
  expect(opened(el)).toEqual([["bravas", "1 de 3 servidos", ["Servir 1", "Servir 2"]]]);
  expect(text(find(el, "[data-sent-details]")!)).toBe(es["table.sent_info"]);
});

it("an opened part-served row shows its count once, on the count line, not under its name", async () => {
  const el = await mount(
    sentCurrent([
      sentDish("bravas", {
        quantity: "3.000",
        servedQuantity: "1.000",
        note: "no salt",
      }),
    ]),
  );
  const more = () => text(find(el, "[data-fired-line=bravas] .row-more")!);
  expect(more()).toBe("Station note: no salt · 1 of 3 served");
  await tap(el, toggle("bravas"));
  expect(more()).toBe("Station note: no salt");
  expect(opened(el)).toEqual([["bravas", "1 of 3 served", ["Serve 1", "Serve 2"]]]);
  await tap(el, toggle("bravas"));
  expect(more()).toBe("Station note: no salt · 1 of 3 served");
});

it.each([390, 844, 1280])(
  "at %i wide the last Serve stops a space in from the box's border, and the count starts under the name",
  async (width) => {
    await page.viewport(width, 800);
    const el = await mount(
      sentCurrent([sentDish("bravas", { quantity: "3.000", servedQuantity: "1.000" })]),
    );
    await tap(el, toggle("bravas"));
    const li = find(el, "li[data-open]")!;
    const gap = Number.parseFloat(getComputedStyle(li).getPropertyValue("--wt-space-2"));
    expect(gap).toBeGreaterThan(0);
    const box = li.getBoundingClientRect();
    const inner = box.right - Number.parseFloat(getComputedStyle(li).borderRightWidth);
    const serves = [...li.querySelectorAll("[data-sent-serve]")];
    const last = serves.at(-1)!.getBoundingClientRect();
    expect(inner - last.right).toBeGreaterThanOrEqual(gap - 0.5);
    expect(inner - last.right).toBeLessThanOrEqual(gap + 0.5);
    const price = li.querySelector(".row-price")!.getBoundingClientRect();
    expect(Math.abs(price.right - last.right)).toBeLessThanOrEqual(0.5);
    const name = li.querySelector(".row-name")!.getBoundingClientRect();
    const count = li.querySelector("[data-sent-open-count]")!.getBoundingClientRect();
    expect(Math.abs(count.left - name.left)).toBeLessThanOrEqual(0.5);
  },
);
