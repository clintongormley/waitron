import { afterEach, describe, expect, it } from "vitest";
import { formatMoney } from "@waitron/shared";
import { currentLocale } from "../i18n/t.js";
import { draftLinePrice } from "../state/draft-layout.js";
import { WorkingOrderStore, type OrderLine } from "../state/working-order.js";
import type { TillProduct } from "../api/menu-api.js";
import "./basket.js";
import type { TillBasket } from "./basket.js";
import { draftRowSlotStyles, draftSelectBox, draftSplitChevron } from "./draft-row.js";
import { cleanupWidgets, mountWidget, tokenColour } from "./test-helpers.js";
import { render } from "lit";

const product = (id: string, name: string, over: Partial<TillProduct> = {}): TillProduct => ({
  id,
  name,
  unitPrice: "10.00",
  pricingUnit: "each",
  vatClass: "general",
  category: null,
  allergens: {},
  ...over,
});

const burger = product("burger", "Burger", {
  offeredModifiers: [
    {
      kind: "extras",
      id: "toppings",
      name: "Toppings",
      customerName: null,
      kitchenName: null,
      minPicks: 0,
      maxPicks: 3,
      items: [
        {
          presentation: {
            name: "Cheese",
            customerName: null,
            kitchenName: null,
            variantName: null,
            variantCustomerName: null,
            variantKitchenName: null,
          },
          productId: "cheese",
          name: "Cheese",
          customerName: null,
          kitchenName: null,
          price: "1.00",
          vatClass: "general",
          takeawayVatClass: "general",
          portion: "1",
          unit: {
            id: "each",
            staffName: "Each",
            staffAbbreviation: "ea",
            name: { en: "Each" },
            abbreviation: { en: "ea" },
            precision: 0,
            hardwareUnit: null,
          },
          maxQuantity: 3,
          preselected: false,
          addAllergens: { milk: {} },
          suitableFor: [],
        },
      ],
    },
  ],
});
const cheese = { listId: "toppings", productId: "cheese", name: "Cheese", price: "1.00" };
const steak = product("steak", "Steak");
const wine = product("wine", "House wine", {
  unitPrice: "0.02",
  unit: {
    id: "ml",
    staffName: "Millilitre",
    staffAbbreviation: "ml",
    name: { en: "Millilitre" },
    abbreviation: { en: "ml" },
    precision: 0,
    hardwareUnit: null,
    measure: true,
  },
});
const hake = product("hake", "Hake");

async function rows(lines: OrderLine[], props: Partial<TillBasket> = {}) {
  const store = new WorkingOrderStore();
  store.loadFrom("draft", lines);
  const { el, host } = await mountWidget<TillBasket>("till-basket", {
    store,
    lineDetails: true,
    stacked: true,
    compactRows: true,
    ...props,
  });
  return { el, host, store };
}

const rowsOf = (el: TillBasket) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-draft-row]")].map((row) =>
    row.innerText.replace(/\s+/g, " ").trim(),
  );

afterEach(cleanupWidgets);

describe("a new dish's compact row", () => {
  it("reads quantity, name, a quiet second line and price for each kind of dish", async () => {
    const { el } = await rows(
      [
        { product: steak, quantity: "1" },
        {
          product: steak,
          quantity: "2",
          optionSnapshots: [
            {
              listName: { en: "Cooking" },
              listCustomerName: null,
              listKitchenName: null,
              labelName: { en: "Medium" },
              labelCustomerName: null,
              labelKitchenName: null,
            },
          ],
          extras: [{ ...cheese, quantity: 2 }],
          note: "No salt",
        },
        { product: wine, quantity: "250" },
        { product: hake, quantity: "1", setMenuId: "daily" },
      ],
      { placedPrice: () => "5.00" },
    );
    const money = (amount: string) => formatMoney(amount, currentLocale());
    expect(rowsOf(el)).toEqual([
      `1 Steak ${money("10.00")}`,
      `2 Steak Cheese ×2 · Cooking: Medium · No salt ${money("24.00")}`,
      `250 ml House wine ${money("5.00")}`,
      `1 Hake +${money("5.00")} ${money("5.00")}`,
    ]);
    const second = el.shadowRoot!.querySelectorAll<HTMLElement>("[data-draft-row] .draft-row-more");
    expect(second).toHaveLength(1);
    expect(getComputedStyle(second[0]!).color).toBe(
      tokenColour(el.shadowRoot!, "--wt-color-text-muted"),
    );
    const font = (token: string, property: "fontSize" | "fontWeight") => {
      const probe = document.createElement("span");
      probe.style[property] = `var(${token})`;
      el.shadowRoot!.append(probe);
      const value = getComputedStyle(probe)[property];
      probe.remove();
      return value;
    };
    const drawn = (selector: string) => {
      const style = getComputedStyle(el.shadowRoot!.querySelector(selector)!);
      return [style.fontSize, style.fontWeight];
    };
    expect(drawn(".draft-row-qty")).toEqual([
      font("--wt-font-size-lg", "fontSize"),
      font("--wt-font-weight-bold", "fontWeight"),
    ]);
    expect(drawn(".draft-row-name")).toEqual([
      font("--wt-font-size-lg", "fontSize"),
      font("--wt-font-weight-medium", "fontWeight"),
    ]);
    expect(drawn(".draft-row-more")[0]).toBe(font("--wt-font-size-sm", "fontSize"));
    expect(drawn(".draft-row-price")[0]).toBe(font("--wt-font-size-md", "fontSize"));
  });

  it("shows an extra's own allergens beside it, and an extra no longer offered with its mark", async () => {
    const { el } = await rows([
      { product: burger, quantity: "1", extras: [{ ...cheese, quantity: 1 }] },
      {
        product: burger,
        quantity: "1",
        notOfferedExtras: [{ ...cheese, productId: "bacon", name: "Bacon", quantity: 1 }],
      },
    ]);
    const [withCheese, withBacon] =
      el.shadowRoot!.querySelectorAll<HTMLElement>("[data-draft-row]");
    const pick = withCheese!.querySelector<HTMLElement>("[data-draft-extra]")!;
    expect(pick.textContent).toContain("Cheese");
    expect(pick.querySelector('[data-test^="option-allergens-"]')!.textContent).toContain("Milk");
    expect(withBacon!.querySelector("[data-draft-extra]")!.textContent).toMatch(
      /Bacon\s*Not offered now/,
    );
  });

  it("prints the figure the order total adds for a set-menu dish", async () => {
    const line: OrderLine = {
      product: hake,
      quantity: "1",
      setMenuId: "daily",
      extras: [{ ...cheese, quantity: 1 }],
    };
    const placedPrice = () => "3.50";
    const { el } = await rows([line], { placedPrice });
    expect(el.shadowRoot!.querySelector(".draft-row-price")!.textContent!.trim()).toBe(
      formatMoney(draftLinePrice(line, placedPrice), currentLocale()),
    );
  });

  it("tints the dish added last, and moves the tint to the next dish added", async () => {
    const { el, store } = await rows([]);
    store.addProduct(steak, "1");
    await el.updateComplete;
    const tinted = () =>
      [...el.shadowRoot!.querySelectorAll<HTMLElement>(".draft-row")].map((row) =>
        row.hasAttribute("data-last-added"),
      );
    expect(tinted()).toEqual([true]);
    const row = el.shadowRoot!.querySelector<HTMLElement>(".draft-row")!;
    expect(getComputedStyle(row).backgroundColor).toBe(
      tokenColour(el.shadowRoot!, "--wt-color-surface-lifted"),
    );
    store.addProduct(hake, "1");
    await el.updateComplete;
    expect(tinted()).toEqual([false, true]);
    expect(getComputedStyle(row).backgroundColor).toBe(
      tokenColour(el.shadowRoot!, "--wt-color-surface"),
    );
  });

  it("keeps the screen's selection box and split control in the row's outer cells", async () => {
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, draftRowSlotStyles.styleSheet!];
    try {
      const { el, host } = await rows([{ product: steak, quantity: "3" }]);
      const lead = document.createElement("button");
      lead.slot = "lead-0";
      lead.className = "draft-row-select";
      lead.setAttribute("data-draft-select", "0");
      const end = document.createElement("button");
      end.slot = "end-0";
      end.className = "draft-row-split";
      end.setAttribute("data-split-draft-line", "0");
      render(draftSelectBox(true), lead);
      render(draftSplitChevron(), end);
      el.append(lead, end);
      await el.updateComplete;
      const box = lead.querySelector<HTMLElement>(".draft-select-box")!;
      const boxStyle = getComputedStyle(box);
      expect([boxStyle.width, boxStyle.height, boxStyle.borderRadius]).toEqual([
        "24px",
        "24px",
        "6px",
      ]);
      expect(boxStyle.backgroundColor).toBe(tokenColour(host, "--wt-color-primary"));
      expect(box.querySelector("wt-icon")!.getAttribute("name")).toBe("check");
      expect(getComputedStyle(box.querySelector("wt-icon")!).color).toBe(
        tokenColour(host, "--wt-color-on-primary"),
      );
      render(draftSelectBox(false), lead);
      expect(getComputedStyle(box).borderColor).toBe(tokenColour(host, "--wt-color-border"));
      expect(box.querySelector("wt-icon")).toBeNull();
      expect(lead.textContent!.trim()).toBe("");
      const chevron = end.querySelector("wt-icon")!;
      expect(chevron.getAttribute("name")).toBe("chevron-down");
      expect(getComputedStyle(chevron).color).toBe(tokenColour(host, "--wt-color-text-muted"));
      const button = el.shadowRoot!.querySelector<HTMLElement>("[data-draft-row]")!;
      const [leadBox, rowBox, endBox] = [lead, button, end].map((node) =>
        node.getBoundingClientRect(),
      );
      expect(leadBox.width).toBe(44);
      const drawn = box.getBoundingClientRect();
      expect(drawn.left - leadBox.left).toBeCloseTo(leadBox.right - drawn.right, 0);
      expect(leadBox.right).toBeLessThanOrEqual(rowBox.left);
      expect(endBox.left).toBeGreaterThanOrEqual(rowBox.right);
    } finally {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (sheet) => sheet !== draftRowSlotStyles.styleSheet,
      );
    }
  });

  it("ends every row's price at the same place, with or without the split control", async () => {
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, draftRowSlotStyles.styleSheet!];
    try {
      const { el } = await rows([
        { product: steak, quantity: "2" },
        { product: hake, quantity: "1" },
      ]);
      const end = document.createElement("button");
      end.slot = "end-0";
      end.className = "draft-row-split";
      render(draftSplitChevron(), end);
      el.append(end);
      await el.updateComplete;
      const prices = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".draft-row-price")];
      expect(prices).toHaveLength(2);
      const [withSplit, withoutSplit] = prices.map((price) => price.getBoundingClientRect().right);
      expect(Math.abs(withSplit! - withoutSplit!)).toBeLessThan(0.5);
    } finally {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (sheet) => sheet !== draftRowSlotStyles.styleSheet,
      );
    }
  });
});
