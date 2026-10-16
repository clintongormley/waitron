import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { HOME_DISPLAY_DEFAULTS } from "@waitron/catalogue/src/device-home.js";
import { sellingValuesOf, type TillProduct, type TillZoneMenu } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillMenuBrowser } from "./menu-browser.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

const dish: TillProduct = {
  id: "dish",
  productId: "dish",
  menuItemId: "offer",
  menuVersionId: "version",
  name: "Staff soup",
  customerName: { en: "Customer soup" },
  kitchenName: "Kitchen soup",
  unitPrice: "3.00",
  vatClass: "general",
  category: null,
  allergens: { gluten: { kinds: ["wheat", "barley"] }, milk: {} },
  dietaryDeclarations: ["vegetarian"],
};
const menu: TillZoneMenu = {
  id: "menu",
  name: "Lunch",
  versionId: "version",
  isDefault: true,
  orderable: true,
  sendable: true,
  audience: "customer",
  structure: { members: [{ kind: "product", productId: "dish", menuItemId: "offer" }] },
  home: {
    shortcuts: [],
    till: HOME_DISPLAY_DEFAULTS.till,
    handheld: HOME_DISPLAY_DEFAULTS.handheld,
  },
};

async function mount(product: TillProduct = dish) {
  setLocale("en");
  const store = new WorkingOrderStore();
  const { el, host } = await mountWidget<TillMenuBrowser>("till-menu-browser", {
    menu,
    products: [product],
    store,
  });
  const button = el.shadowRoot!.querySelector<HTMLElement>('[data-kind="product"]')!;
  return { el, host, store, button };
}

function info(el: TillMenuBrowser): HTMLElement | null {
  return el.shadowRoot!.querySelector("till-product-info");
}

describe("product nutrition on the menu", () => {
  it.each([
    { name: "allergen", allergens: { milk: {} }, dietaryDeclarations: [], marked: true },
    { name: "diet only", allergens: {}, dietaryDeclarations: ["halal"], marked: true },
    { name: "reviewed empty", allergens: {}, dietaryDeclarations: [], marked: false },
    { name: "unreviewed", allergens: null, dietaryDeclarations: [], marked: false },
  ])("marks $name products only when information was declared", async (values) => {
    const { button } = await mount({
      ...dish,
      allergens: values.allergens as TillProduct["allergens"],
      dietaryDeclarations: values.dietaryDeclarations,
    });
    expect(button.querySelector('wt-icon[name="allergies"]') !== null).toBe(values.marked);
  });

  it("reserves room for the mark without splitting a word that fits a phone tile", async () => {
    await page.viewport(390, 844);
    try {
      const { button } = await mount({ ...dish, name: "Vegetable soup" });
      await (button as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
      const text = button.querySelector(".name")!.lastChild!;
      const word = document.createRange();
      word.setStart(text, 0);
      word.setEnd(text, 9);
      expect([...word.getClientRects()]).toHaveLength(1);
    } finally {
      await page.viewport(414, 896);
    }
  });

  it("a right click leaves selection unchanged and prevents the competing native context menu", async () => {
    const { el, store, button } = await mount();
    const events: Event[] = [];
    button.addEventListener("contextmenu", (event) => events.push(event));
    await userEvent.click(button, { button: "right" });
    expect(events).toHaveLength(1);
    expect(events[0]!.defaultPrevented).toBe(true);
    expect(store.lines).toHaveLength(0);
    expect(info(el)).toBeNull();
  });

  it("a held mouse press opens the dish information and never adds it", async () => {
    const { el, store, button } = await mount();
    await userEvent.click(button, { delay: 650 });
    await el.updateComplete;
    expect(store.lines).toHaveLength(0);
    expect(info(el)).not.toBeNull();
    expect(
      (info(el)!.shadowRoot!.querySelector("wt-dialog") as HTMLElement & { heading: string })
        .heading,
    ).toBe("Staff soup");
    expect(info(el)!.shadowRoot!.textContent).toContain("Wheat, Barley");
    expect(info(el)!.shadowRoot!.textContent).not.toContain("Customer soup");
  });

  it("a short click on the mark adds once without opening information", async () => {
    const { el, store, button } = await mount();
    const mark = button.querySelector<HTMLElement>('wt-icon[name="allergies"]');
    expect(mark).not.toBeNull();
    await userEvent.click(mark!);
    expect(store.lines).toHaveLength(1);
    expect(store.lines[0]!.quantity).toBe("1");
    expect(info(el)).toBeNull();
  });

  it("two quick clicks add twice instead of opening information", async () => {
    const { el, store, button } = await mount();
    await userEvent.dblClick(button);
    expect(store.lines).toHaveLength(2);
    expect(store.lines.map((line) => line.quantity)).toEqual(["1", "1"]);
    expect(info(el)).toBeNull();
  });

  it("an unmarked unreviewed dish still opens information on hold", async () => {
    const { el, store, button } = await mount({
      ...dish,
      allergens: null,
      dietaryDeclarations: [],
    });
    await userEvent.click(button, { delay: 650 });
    await el.updateComplete;
    expect(store.lines).toHaveLength(0);
    expect(info(el)).not.toBeNull();
    expect(info(el)!.shadowRoot!.textContent).toContain("Allergens not yet reviewed");
  });

  it("holding the search field after selecting a dish never opens stale product information", async () => {
    const { el, button } = await mount();
    await userEvent.click(button);
    const search = el.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("label")!;
    await userEvent.click(search, { delay: 650 });
    await el.updateComplete;
    expect(info(el)).toBeNull();
  });

  it("Add opens the normal variant picker without ringing up the parent", async () => {
    const product: TillProduct = {
      ...dish,
      variants: [
        {
          ...sellingValuesOf(dish),
          id: "small",
          name: "Small",
          allergens: { eggs: {} },
          unitPrice: "2.00",
          unitPriceDifference: "-1.00",
          available: true,
        },
      ],
    };
    const { el, store, button } = await mount(product);
    await userEvent.click(button, { delay: 650 });
    await el.updateComplete;
    await userEvent.click(info(el)!.shadowRoot!.querySelector<HTMLElement>("[data-add]")!);
    await el.updateComplete;
    expect(info(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-modifier-picker")).not.toBeNull();
    expect(store.lines).toHaveLength(0);
  });

  it("Add asks for a weighed dish's quantity through the normal store event", async () => {
    const product: TillProduct = { ...dish, pricingUnit: "weight" };
    const { el, store, button } = await mount(product);
    const selected: unknown[] = [];
    store.on("product-selected", (picked) => selected.push(picked));
    await userEvent.click(button, { delay: 650 });
    await el.updateComplete;
    await userEvent.click(info(el)!.shadowRoot!.querySelector<HTMLElement>("[data-add]")!);
    await el.updateComplete;
    expect(selected).toEqual([product]);
    expect(store.lines).toHaveLength(0);
  });

  it("opens information for a sold-out product but keeps Add disabled", async () => {
    const { el, store, button } = await mount({ ...dish, available: false });
    await userEvent.click(button, { force: true, delay: 650 });
    await el.updateComplete;
    expect(info(el)).not.toBeNull();
    expect(
      (info(el)!.shadowRoot!.querySelector("[data-add]") as HTMLElement & { disabled: boolean })
        .disabled,
    ).toBe(true);
    expect(store.lines).toHaveLength(0);
  });

  it("keyboard activation selects a product without opening information", async () => {
    const { el, store, button } = await mount();
    button.shadowRoot!.querySelector<HTMLButtonElement>("button")!.focus();
    await userEvent.keyboard("{Enter}");
    expect(store.lines).toHaveLength(1);
    expect(info(el)).toBeNull();
  });

  it("Add in the information window follows the normal product selection", async () => {
    const { el, store, button } = await mount();
    await userEvent.click(button, { delay: 650 });
    await el.updateComplete;
    expect(info(el)).not.toBeNull();
    const add = info(el)!.shadowRoot!.querySelector<HTMLElement>("[data-add]")!;
    await userEvent.click(add);
    await el.updateComplete;
    expect(store.lines).toHaveLength(1);
    expect(store.lines[0]!.product.id).toBe("dish");
    expect(info(el)).toBeNull();
  });
});
