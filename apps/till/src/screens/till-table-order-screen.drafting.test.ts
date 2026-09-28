import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget, servedMenus } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./till-table-order-screen.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import { DraftStore } from "../state/draft-sync.js";
import type { OfferedModifier, TillProduct } from "../api/client.js";
import type { TillMenuBrowser } from "../widgets/menu-browser.js";

// Beer and Flan ring straight in; the Burger asks for its doneness and its extras first (Bacon
// comes preselected); Jamón is sold by weight.

const beer: TillProduct = {
  id: "beer",
  menuItemId: "offer-beer",
  catalogueId: "menu-table",
  name: "Beer",
  customerName: { es: "Cerveza de barril" },
  pricingUnit: "each",
  unitPrice: "3.00",
  vatClass: "general",
  category: null,
  allergens: null,
  courseId: null,
};

const flan: TillProduct = { ...beer, id: "flan", menuItemId: "offer-flan", name: "Flan" };

const cookedList: OfferedModifier = {
  kind: "options",
  id: "list-cooked",
  name: "Doneness",
  customerName: { es: "Punto carta" },
  kitchenName: "Punto KDS",
  defaultLabelId: "label-medium",
  labels: [
    {
      id: "label-rare",
      name: "Rare",
      customerName: { es: "Poco hecha carta" },
      kitchenName: "Poco hecha KDS",
      available: true,
    },
    {
      id: "label-medium",
      name: "Medium",
      customerName: { es: "Al punto carta" },
      kitchenName: "Al punto KDS",
      available: true,
    },
  ],
};

const extrasList: OfferedModifier = {
  kind: "extras",
  id: "list-extras",
  name: "Extras",
  customerName: { es: "Extras carta" },
  kitchenName: "Extras KDS",
  minPicks: 0,
  maxPicks: null,
  items: [
    {
      productId: "p-bacon",
      name: "Bacon",
      customerName: { es: "Bacon carta" },
      kitchenName: "Bacon KDS",
      price: "1.00",
      vatClass: "general",
      maxQuantity: 3,
      preselected: true,
      addAllergens: null,
      suitableFor: [],
    },
  ],
};

const burger: TillProduct = {
  ...beer,
  id: "burger",
  menuItemId: "offer-burger",
  name: "Burger",
  unitPrice: "9.50",
  offeredModifiers: [cookedList, extrasList],
};

const jamon: TillProduct = {
  ...beer,
  id: "jamon",
  menuItemId: "offer-jamon",
  name: "Jamón",
  pricingUnit: "weight",
  unitPrice: "20.00",
};

const products = [beer, flan, burger, jamon];

function menuOf(offered: TillProduct[], section?: (product: TillProduct) => string | undefined) {
  return servedMenus(
    [{ id: "menu-table", name: "Carta", isDefault: true, versionId: "menu-table-v1" }],
    offered.map((product) => {
      const placed = section?.(product);
      return {
        id: product.menuItemId!,
        menuId: "menu-table",
        productId: product.id,
        ...(placed === undefined ? {} : { section: placed }),
      };
    }),
  );
}

async function mount(over: Partial<TillTableOrderScreen> = {}) {
  const offered = over.products ?? products;
  return mountWidget<TillTableOrderScreen>("till-table-order-screen", {
    products: offered,
    menus: menuOf(offered),
    lines: [],
    statuses: [],
    orderId: "wo-4",
    draftStore: new DraftStore(),
    ...over,
  });
}

const browser = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!;
const store = (el: TillTableOrderScreen) => el.draftStore!;
const rows = (el: TillTableOrderScreen) =>
  store(el).lines.map(
    (line) => `${line.product.name} ×${line.quantity}${line.noMerge === true ? " apart" : ""}`,
  );

/** Taps the menu browser's tile named `name`. */
async function tap(el: TillTableOrderScreen, name: string): Promise<void> {
  [...browser(el).shadowRoot!.querySelectorAll<HTMLElement>("wt-button.tile")]
    .find((tile) => tile.querySelector(".name")?.textContent === name)!
    .click();
  await el.updateComplete;
}

const bar = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-last-added]");
const barText = (el: TillTableOrderScreen) => bar(el)!.textContent!.replace(/\s+/g, " ").trim();

async function step(el: TillTableOrderScreen, by: "-1" | "1"): Promise<void> {
  bar(el)!.querySelector<HTMLElement>(`[data-last-added-step="${by}"]`)!.click();
  await el.updateComplete;
}

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe("till-table-order-screen: the last-added bar", () => {
  it("shows three taps on Beer as Beer ×3, and +1 makes it 4", async () => {
    const { el } = await mount();
    expect(bar(el)).toBeNull();
    await tap(el, "Beer");
    await tap(el, "Beer");
    await tap(el, "Beer");
    expect(barText(el)).toContain("Beer ×3");

    await step(el, "1");

    expect(barText(el)).toContain("Beer ×4");
    expect(rows(el)).toEqual(["Beer ×4"]);
  });

  it("shows the line the latest tap grew, not the one tapped before it", async () => {
    const { el } = await mount();
    await tap(el, "Beer");
    await tap(el, "Flan");
    expect(barText(el)).toContain("Flan ×1");
    await tap(el, "Beer");
    expect(barText(el)).toContain("Beer ×2");
    expect(barText(el)).not.toContain("Flan");
  });

  it("takes one off with −1, and at 1 removes the line and shows nothing", async () => {
    const { el } = await mount();
    await tap(el, "Flan");
    await tap(el, "Beer");
    await tap(el, "Beer");
    await step(el, "-1");
    expect(barText(el)).toContain("Beer ×1");
    expect(rows(el)).toEqual(["Flan ×1", "Beer ×1"]);

    await step(el, "-1");

    expect(rows(el)).toEqual(["Flan ×1"]);
    expect(bar(el)).toBeNull();
  });

  it("gives its −1 and +1 a tap target of 44 px each way, and names the dish they change", async () => {
    const { el } = await mount();
    await tap(el, "Beer");
    for (const by of ["-1", "1"]) {
      const control = bar(el)!.querySelector<HTMLElement>(`[data-last-added-step="${by}"]`)!;
      const inner = control.shadowRoot!.querySelector("button")!;
      const box = inner.getBoundingClientRect();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(inner.getAttribute("aria-label")).toContain("Beer");
    }
  });

  it("opens a dish with choices in its customisation first, and shows what was chosen once it is added", async () => {
    const { el } = await mount();
    await tap(el, "Burger");
    expect(rows(el)).toEqual([]);
    const picker = browser(el).shadowRoot!.querySelector<HTMLElement>("till-modifier-picker")!;
    await (picker as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

    picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
    await el.updateComplete;

    expect(rows(el)).toEqual(["Burger ×1"]);
    expect(barText(el)).toContain("Burger ×1");
    expect(barText(el)).toContain("Medium");
    expect(barText(el)).toContain("Bacon");
  });

  it("shows a line's note", async () => {
    const { el } = await mount();
    await tap(el, "Beer");
    store(el).setLineExtras(0, { note: "no glass" });
    await el.updateComplete;
    expect(barText(el)).toContain("no glass");
  });

  it("asks a weighed dish's weight and adds what is entered, with no ±1", async () => {
    const { el } = await mount();
    await tap(el, "Jamón");
    expect(rows(el)).toEqual([]);
    const weigh = browser(el).shadowRoot!.querySelector<HTMLElement>("till-tender-pay")!;
    await (weigh as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    const pad = weigh.shadowRoot!.querySelector<HTMLElement>("till-numeric-pad")!;
    pad.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "0.25" } }));
    await (weigh as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

    weigh.shadowRoot!.querySelector<HTMLElement>("wt-button.add")!.click();
    await el.updateComplete;

    expect(rows(el)).toEqual(["Jamón ×0.25"]);
    expect(barText(el)).toContain("Jamón");
    expect(bar(el)!.querySelector("[data-last-added-step]")).toBeNull();
  });

  it("shows no weighing prompt until a weighed dish is tapped", async () => {
    const { el } = await mount();
    const weigh = browser(el).shadowRoot!.querySelector<HTMLElement>("till-tender-pay");
    expect(weigh?.shadowRoot?.textContent?.trim() ?? "").toBe("");
  });
});

describe("till-table-order-screen: one view of the draft", () => {
  it("shows each line once, in its course section, with its quantity, note and remove", async () => {
    const byCourse = [
      { ...beer, courseId: "drinks" },
      { ...flan, courseId: "desserts" },
    ];
    const { el } = await mount({
      products: byCourse,
      menus: menuOf(byCourse),
      courses: [
        { id: "drinks", name: "Drinks", displayOrder: 0 },
        { id: "desserts", name: "Desserts", displayOrder: 1 },
      ],
    });
    await tap(el, "Beer");
    await tap(el, "Beer");
    await tap(el, "Flan");
    const baskets = [...el.shadowRoot!.querySelectorAll("till-basket")];
    const shownLines = baskets.flatMap((basket) => [
      ...basket.shadowRoot!.querySelectorAll(".line"),
    ]);
    expect(baskets.length).toBe(2);
    expect(shownLines.length).toBe(2);
    expect(baskets.map((basket) => basket.closest("[data-draft-section]") !== null)).toEqual(
      baskets.map(() => true),
    );
    const first = baskets[0]!.shadowRoot!;
    expect(first.querySelector(".step-inc")).not.toBeNull();
    expect(first.querySelector(".note-toggle")).not.toBeNull();
    expect(first.querySelector(".remove")).not.toBeNull();

    first.querySelector<HTMLElement>(".step-inc")!.click();
    await el.updateComplete;
    expect(rows(el)).toEqual(["Beer ×3", "Flan ×1"]);
    first.querySelector<HTMLElement>(".remove")!.click();
    await el.updateComplete;
    expect(rows(el)).toEqual(["Flan ×1"]);
  });
});

describe("till-table-order-screen: Split quantity on a draft line", () => {
  const split = (el: TillTableOrderScreen, index: number) =>
    el.shadowRoot!.querySelector<HTMLElement>(`[data-split-draft-line="${index}"]`);

  it("turns Beer ×3 into three rows that a further tap does not regroup", async () => {
    const { el } = await mount();
    await tap(el, "Beer");
    await tap(el, "Beer");
    await tap(el, "Beer");
    expect(split(el, 0)!.getAttribute("aria-label")).toBe(`${t("table.split_group_line")} · Beer`);

    split(el, 0)!.click();
    await el.updateComplete;
    expect(rows(el)).toEqual(["Beer ×1 apart", "Beer ×1 apart", "Beer ×1 apart"]);
    expect(el.shadowRoot!.querySelectorAll("[data-draft-select]").length).toBe(3);

    await tap(el, "Beer");
    await tap(el, "Beer");
    expect(rows(el)).toEqual(["Beer ×1 apart", "Beer ×1 apart", "Beer ×1 apart", "Beer ×2"]);
  });

  it("is offered only on a line of more than one whole unit", async () => {
    const { el } = await mount();
    await tap(el, "Flan");
    store(el).addProduct(jamon, "2");
    await el.updateComplete;
    expect(split(el, 0)).toBeNull();
    expect(split(el, 1)).toBeNull();
  });
});
