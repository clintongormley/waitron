import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatMoney } from "@waitron/shared";
import { WorkingOrderStore, type OrderLine } from "../state/working-order.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./basket.js";
import type { StoredLines, TillBasket } from "./basket.js";
import type { TabLine, TillProduct } from "../api/client.js";
import type { AdjustDetail } from "../screens/till-table-order-screen.js";

// A stored counter order in the basket offers Cancel, Give away and Discount on its dishes and
// Discount the bill, from the server's own listing of its lines (B11c).

const product = (id: string, name: string, unitPrice: string): TillProduct => ({
  id,
  name,
  customerName: { es: `${name} carta` },
  pricingUnit: "each",
  unitPrice,
  vatClass: "general",
  category: null,
  allergens: null,
});

const croquetas = product("croquetas", "Croquetas", "3.00");
const cana = product("cana", "Caña", "0.00");
const burger = product("burger", "Hamburguesa", "10.00");

const tabLine = (over: Partial<TabLine> & Pick<TabLine, "id" | "lineNo">): TabLine => ({
  name: "Stored name",
  productId: null,
  parentLineNo: null,
  quantity: "1.000",
  unitPrecision: 0,
  unitPriceGross: "1.00",
  servedAt: null,
  courseId: null,
  sentAt: null,
  firedAt: null,
  state: null,
  groupId: null,
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
  ...over,
});

/** Two croquetas the kitchen has, a caña given away, and an unsent burger with bacon. */
const listed: TabLine[] = [
  tabLine({
    id: "l-1",
    lineNo: 1,
    productId: "croquetas",
    quantity: "2.000",
    unitPriceGross: "3.00",
    sentAt: "2026-09-30T09:00:00.000Z",
    firedAt: "2026-09-30T09:00:00.000Z",
    state: "preparing",
  }),
  tabLine({
    id: "l-2",
    lineNo: 2,
    productId: "cana",
    unitPriceGross: "0.00",
    listUnitPriceGross: "2.50",
  }),
  tabLine({ id: "l-3", lineNo: 3, productId: "burger", unitPriceGross: "10.00" }),
  tabLine({
    id: "l-4",
    lineNo: 4,
    parentLineNo: 3,
    productId: "p-bacon",
    listId: "list-extras",
    unitPrecision: null,
    unitPriceGross: "1.50",
  }),
];

const basketLines = (): OrderLine[] => [
  { workingOrderLineId: "l-1", product: croquetas, quantity: "2" },
  { workingOrderLineId: "l-2", product: cana, quantity: "1" },
  {
    workingOrderLineId: "l-3",
    product: burger,
    quantity: "1",
    extras: [
      { listId: "list-extras", productId: "p-bacon", name: "Bacon", price: "1.50", quantity: 1 },
    ],
  },
];

function storedOrder(): WorkingOrderStore {
  const store = new WorkingOrderStore();
  store.loadFrom("wo-9", basketLines(), undefined, 4);
  return store;
}

const stored: StoredLines = { orderId: "wo-9", revision: 4, lines: listed };

async function mount(store: WorkingOrderStore, storedLines: StoredLines | null = stored) {
  const { el } = await mountWidget<TillBasket>("till-basket", { store, storedLines });
  return el;
}

const rows = (el: TillBasket) => [...el.shadowRoot!.querySelectorAll<HTMLElement>(".line")];
/** A line's action, by the line's place in the basket. */
const within = (el: TillBasket, index: number | string, attribute: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[${attribute}="${index}"]`);
const all = (el: TillBasket, selector: string) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>(selector)].length;

function adjustments(el: TillBasket): AdjustDetail[] {
  const heard: AdjustDetail[] = [];
  el.addEventListener("adjust", (event) => heard.push((event as CustomEvent<AdjustDetail>).detail));
  return heard;
}

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe("till-basket: a stored counter order", () => {
  it("offers Cancel in place of remove and − on the dish the kitchen has, and keeps +", async () => {
    const el = await mount(storedOrder());

    expect(within(el, 0, "data-cancel-line")).not.toBeNull();
    expect(rows(el)[0]!.querySelector(".remove")).toBeNull();
    expect(rows(el)[0]!.querySelector(".step-dec")).toBeNull();
    expect(rows(el)[0]!.querySelector(".step-inc")).not.toBeNull();
    expect(within(el, 0, "data-cancel-line")!.getAttribute("aria-label")).toBe(
      `${t("table.cancel_line")} · Croquetas`,
    );
  });

  it("keeps the dish the kitchen has lined up with the others, stacked or not", async () => {
    const el = await mount(storedOrder());
    el.parentElement!.style.width = "600px";
    const edge = (row: HTMLElement, selector: string, side: "left" | "right") =>
      Math.round(row.querySelector(selector)!.getBoundingClientRect()[side]);
    const columns = () =>
      rows(el).map((row) => ({
        total: edge(row, ".line-total", "right"),
        note: edge(row, ".note-toggle", "right"),
      }));

    expect(new Set(columns().map((row) => JSON.stringify(row))).size).toBe(1);
    el.stacked = true;
    await el.updateComplete;
    expect(new Set(columns().map((row) => JSON.stringify(row))).size).toBe(1);
    expect(new Set(rows(el).map((row) => edge(row, ".count", "left"))).size).toBe(1);
  });

  it("keeps remove and −/+ on the dishes the kitchen does not have, which offer no Cancel", async () => {
    const el = await mount(storedOrder());

    for (const index of [1, 2]) {
      expect(rows(el)[index]!.querySelector(".remove")).not.toBeNull();
      expect(rows(el)[index]!.querySelector(".step-dec")).not.toBeNull();
    }
    expect(all(el, "[data-cancel-line]")).toBe(1);
  });

  it("offers Give away and Discount on every dish, and Discount the bill once", async () => {
    const el = await mount(storedOrder());

    expect(all(el, "[data-comp-line]")).toBe(3);
    expect(all(el, "[data-discount-line]")).toBe(3);
    expect(all(el, "[data-discount-bill]")).toBe(1);
    expect(el.shadowRoot!.querySelector("[data-discount-bill]")!.textContent!.trim()).toBe(
      t("table.discount_bill"),
    );
    expect(within(el, 2, "data-comp-line")!.getAttribute("aria-label")).toBe(
      `${t("table.comp_line")} · Hamburguesa`,
    );
  });

  it("gives away or discounts an extra on its own and whole, naming it with its dish, and offers no Cancel while its dish is not with the kitchen", async () => {
    const el = await mount(storedOrder());
    const heard = adjustments(el);
    const bacon = t("table.extra_of").replace("{extra}", "Bacon").replace("{dish}", "Hamburguesa");

    expect(all(el, "[data-comp-extra]")).toBe(1);
    expect(all(el, "[data-discount-extra]")).toBe(1);
    expect(all(el, "[data-cancel-extra]")).toBe(0);
    expect(within(el, "2-0", "data-comp-extra")!.getAttribute("aria-label")).toBe(
      `${t("table.comp_line")} · ${bacon}`,
    );
    within(el, "2-0", "data-comp-extra")!.click();
    within(el, "2-0", "data-discount-extra")!.click();

    const target = {
      lineId: "l-4",
      name: bacon,
      quantity: "1",
      total: "1.50",
      unitTotal: null,
      started: false,
    };
    expect(heard).toEqual([
      { kind: "comp", counter: true, target },
      { kind: "discount", counter: true, target },
    ]);
  });

  it("cancels an extra on its own and whole once its dish is with the kitchen", async () => {
    const sentBurger: StoredLines = {
      ...stored,
      lines: listed.map((line) =>
        line.lineNo === 3
          ? { ...line, sentAt: "2026-09-30T09:00:00.000Z", state: "queued" as const }
          : line,
      ),
    };
    const el = await mount(storedOrder(), sentBurger);
    const heard = adjustments(el);

    expect(all(el, "[data-cancel-extra]")).toBe(1);
    within(el, "2-0", "data-cancel-extra")!.click();

    expect(heard).toEqual([
      {
        kind: "cancel",
        counter: true,
        target: expect.objectContaining({ lineId: "l-4", quantity: "1", unitTotal: null }),
      },
    ]);
  });

  it("shows each part of a dish split by a give-away with its own extra, and adjusts that extra", async () => {
    const store = new WorkingOrderStore();
    const bacon = {
      listId: "list-extras",
      productId: "p-bacon",
      name: "Bacon",
      price: "1.50",
      quantity: 1,
    };
    store.loadFrom(
      "wo-9",
      [
        { workingOrderLineId: "l-3", product: burger, quantity: "1", extras: [bacon] },
        {
          workingOrderLineId: "l-5",
          product: { ...burger, unitPrice: "0.00" },
          quantity: "1",
          extras: [{ ...bacon, price: "0.00" }],
        },
      ],
      undefined,
      4,
    );
    const split: StoredLines = {
      ...stored,
      lines: [
        listed[2]!,
        listed[3]!,
        {
          ...listed[2]!,
          id: "l-5",
          lineNo: 5,
          unitPriceGross: "0.00",
          listUnitPriceGross: "10.00",
        },
        {
          ...listed[3]!,
          id: "l-6",
          lineNo: 6,
          parentLineNo: 5,
          unitPriceGross: "0.00",
          listUnitPriceGross: "1.50",
        },
      ],
    };
    const el = await mount(store, split);
    const heard = adjustments(el);
    const extraTotals = [...el.shadowRoot!.querySelectorAll(".option-total")];

    expect(extraTotals[0]!.querySelector("s")).toBeNull();
    expect(extraTotals[1]!.querySelector("s")!.textContent).toBe(
      formatMoney("1.50", currentLocale()),
    );
    within(el, "0-0", "data-comp-extra")!.click();
    within(el, "1-0", "data-comp-extra")!.click();
    expect(heard.map(({ target }) => [target.lineId, target.total])).toEqual([
      ["l-4", "1.50"],
      ["l-6", "0.00"],
    ]);
  });

  it("shows a dish's price before it was given away, struck through", async () => {
    const el = await mount(storedOrder());

    const total = rows(el)[1]!.querySelector(".line-total")!;
    expect(total.querySelector("s")!.textContent).toBe(formatMoney("2.50", currentLocale()));
    expect(total.querySelector("[data-price-was]")!.textContent!.trim()).toBe(t("table.price_was"));
    expect(total.textContent).toContain(formatMoney("0.00", currentLocale()));
    expect(rows(el)[0]!.querySelector(".line-total s")).toBeNull();
  });

  it("shows an extra's price before its dish was given away, struck through", async () => {
    const store = new WorkingOrderStore();
    store.loadFrom(
      "wo-9",
      [
        {
          workingOrderLineId: "l-3",
          product: { ...burger, unitPrice: "0.00" },
          quantity: "2",
          extras: [
            {
              listId: "list-extras",
              productId: "p-bacon",
              name: "Bacon",
              price: "0.00",
              quantity: 1,
            },
          ],
        },
      ],
      undefined,
      4,
    );
    const comped: StoredLines = {
      ...stored,
      lines: [
        { ...listed[2]!, quantity: "2.000", unitPriceGross: "0.00", listUnitPriceGross: "10.00" },
        { ...listed[3]!, quantity: "2.000", unitPriceGross: "0.00", listUnitPriceGross: "1.50" },
      ],
    };
    const el = await mount(store, comped);

    expect(rows(el)[0]!.querySelector(".line-total s")!.textContent).toBe(
      formatMoney("20.00", currentLocale()),
    );
    const extra = el.shadowRoot!.querySelector(".option-total")!;
    expect(extra.querySelector("s")!.textContent).toBe(formatMoney("3.00", currentLocale()));
    expect(extra.textContent).toContain(formatMoney("0.00", currentLocale()));
  });

  it("sends Cancel on several whole units with each unit's price, from the counter", async () => {
    const el = await mount(storedOrder());
    const heard = adjustments(el);

    within(el, 0, "data-cancel-line")!.click();

    expect(heard).toEqual([
      {
        kind: "cancel",
        counter: true,
        target: {
          lineId: "l-1",
          name: "Croquetas",
          quantity: "2",
          total: "6.00",
          unitTotal: "3.00",
          started: true,
        },
      },
    ]);
  });

  it("gives away or discounts one of a dish with its extras by each unit's share of them", async () => {
    const store = storedOrder();
    const twoBurgers: StoredLines = {
      ...stored,
      lines: listed.map((line) =>
        line.lineNo === 3 || line.lineNo === 4 ? { ...line, quantity: "2.000" } : line,
      ),
    };
    const el = await mount(store, twoBurgers);
    const heard = adjustments(el);

    within(el, 2, "data-comp-line")!.click();
    within(el, 2, "data-discount-line")!.click();

    expect(heard.map(({ kind, target }) => [kind, target.total, target.unitTotal])).toEqual([
      ["comp", "23.00", "11.50"],
      ["discount", "23.00", "11.50"],
    ]);
  });

  it("discounts the whole order as the server listed it", async () => {
    const el = await mount(storedOrder());
    const heard = adjustments(el);

    el.shadowRoot!.querySelector<HTMLElement>("[data-discount-bill]")!.click();

    expect(heard).toEqual([
      {
        kind: "discount",
        counter: true,
        target: {
          lineId: null,
          name: t("adjust.whole_bill"),
          quantity: null,
          total: "17.50",
          unitTotal: null,
        },
      },
    ]);
  });
});

describe("till-basket: no adjustments until the basket matches the stored order", () => {
  const none = (el: TillBasket) =>
    all(el, "[data-cancel-line]") +
    all(el, "[data-comp-line]") +
    all(el, "[data-discount-line]") +
    all(el, "[data-discount-bill]") +
    all(el, "[data-comp-extra]") +
    all(el, "[data-discount-extra]");

  it("offers none on a walk-up basket", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(croquetas, "2");
    const el = await mount(store, null);
    expect(none(el)).toBe(0);
    expect(rows(el)[0]!.querySelector(".remove")).not.toBeNull();
  });

  it("offers none once the basket is changed, and the dish the kitchen has still has no remove", async () => {
    const store = storedOrder();
    const el = await mount(store);

    store.setLineQuantity(2, "2");
    await el.updateComplete;

    expect(none(el)).toBe(0);
    expect(rows(el)[0]!.querySelector(".remove")).toBeNull();
    expect(rows(el)[0]!.querySelector(".step-dec")).toBeNull();
  });

  it("offers none while the basket is being sent", async () => {
    const store = storedOrder();
    const el = await mount(store);

    store.sending = true;
    await el.updateComplete;

    expect(none(el)).toBe(0);
  });

  it("offers none when the listing is of another revision or another order", async () => {
    const other = await mount(storedOrder(), { ...stored, revision: 5 });
    expect(none(other)).toBe(0);
    const elsewhere = await mount(storedOrder(), { ...stored, orderId: "wo-8" });
    expect(none(elsewhere)).toBe(0);
    expect(rows(elsewhere)[0]!.querySelector(".remove")).not.toBeNull();
  });
});
