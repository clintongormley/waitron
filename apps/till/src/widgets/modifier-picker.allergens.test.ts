import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { EMPTY_MENU_FILTERS } from "../menu-filter.js";
import type { OfferedExtraItem, TillProduct } from "../api/client.js";
import { TillModifierPicker } from "./modifier-picker.js";

const noNuts = { diets: [], exclude: { nuts: "all" as const } };
const extra = (
  id: string,
  allergens: OfferedExtraItem["addAllergens"],
  preselected = false,
): OfferedExtraItem => ({
  productId: id,
  name: id,
  customerName: { en: `${id} customer` },
  kitchenName: `${id} kitchen`,
  presentation: {
    name: id,
    customerName: { en: `${id} customer` },
    kitchenName: `${id} kitchen`,
    variantName: null,
    variantCustomerName: null,
    variantKitchenName: null,
  },
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
  price: "1.00",
  vatClass: "general",
  maxQuantity: 1,
  preselected,
  addAllergens: allergens,
  suitableFor: [],
});
const dish = (defaults = true, minPicks = 0): TillProduct => ({
  id: "salad",
  name: "Salad",
  customerName: { en: "Guest salad" },
  kitchenName: "Cold salad",
  pricingUnit: "each",
  unitPrice: "5.00",
  vatClass: "general",
  category: null,
  allergens: {},
  offeredModifiers: [
    {
      kind: "extras",
      id: "toppings",
      name: "Toppings",
      customerName: { en: "Guest toppings" },
      kitchenName: "Cold toppings",
      minPicks,
      maxPicks: 3,
      items: [
        extra("Walnuts", { nuts: { kinds: ["walnuts"] } }, defaults),
        extra("Seeds", {}, defaults),
        extra("Unknown", null),
        extra("Herbs", {}),
      ],
    },
  ],
});
const startLocale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(startLocale);
});

it.each(["light", "dark"] as const)(
  "asks before removing named defaults, then keeps compatible defaults (%s)",
  async (theme) => {
    const { el, host } = await mountWidget<TillModifierPicker>(
      "till-modifier-picker",
      { product: dish(), filters: noNuts },
      theme,
    );
    const confirm = vi.fn();
    el.addEventListener("wt-modifier-confirm", confirm);
    const add = el.shadowRoot!.querySelector(".confirm")!;
    expect(add.hasAttribute("disabled")).toBe(true);
    expect(el.shadowRoot!.querySelector(".allergen-removal")!.textContent).toContain("Walnuts");
    el.confirm();
    expect(confirm).not.toHaveBeenCalled();
    await expectNoA11yViolations(host);
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>(".remove-extras")!);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".allergen-removal")).toBeNull();
    expect(add.hasAttribute("disabled")).toBe(false);
    el.confirm();
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]![0].detail.extras).toEqual([
      { listId: "toppings", productId: "Seeds", name: "Seeds", price: "1.00", quantity: 1 },
    ]);
    await expectNoA11yViolations(host);
  },
);

it("cancels the default-removal question without adding a dish", async () => {
  const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
    product: dish(),
    filters: noNuts,
  });
  const confirm = vi.fn();
  const cancelled = new Promise((resolve) =>
    el.addEventListener("wt-modifier-cancel", resolve, { once: true }),
  );
  el.addEventListener("wt-modifier-confirm", confirm);
  await userEvent.click(
    el.shadowRoot!.querySelector<HTMLElement>(".allergen-removal .cancel-removal")!,
  );
  await cancelled;
  expect(confirm).not.toHaveBeenCalled();
});

it("omits incompatible optional and unknown choices without asking when none were defaults", async () => {
  const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
    product: dish(false),
    filters: noNuts,
  });
  expect(el.shadowRoot!.querySelector(".allergen-removal")).toBeNull();
  expect(el.shadowRoot!.textContent).not.toContain("Walnuts");
  expect(el.shadowRoot!.textContent).not.toContain("Unknown");
  const confirm = vi.fn();
  el.addEventListener("wt-modifier-confirm", confirm);
  el.confirm();
  expect(confirm.mock.calls[0]![0].detail.extras).toBeUndefined();
});

it("still needs a compatible replacement after removing a required default", async () => {
  const product = dish(true, 2);
  const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
    product,
    filters: noNuts,
  });
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>(".remove-extras")!);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".confirm")!.hasAttribute("disabled")).toBe(true);
  const herbs = [...el.shadowRoot!.querySelectorAll("label")].find((label) =>
    label.textContent?.includes("Herbs"),
  )!;
  await userEvent.click(herbs.querySelector("input")!);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".confirm")!.hasAttribute("disabled")).toBe(false);
});

it.each([EMPTY_MENU_FILTERS, { diets: [], exclude: { nuts: [] } }])(
  "preserves defaults without an active exclusion",
  async (filters) => {
    const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
      product: dish(),
      filters,
    });
    const confirm = vi.fn();
    el.addEventListener("wt-modifier-confirm", confirm);
    el.confirm();
    expect(
      confirm.mock.calls[0]![0].detail.extras.map((item: { productId: string }) => item.productId),
    ).toEqual(["Walnuts", "Seeds"]);
  },
);

it("leaves saved selections unchanged even when a host supplies exclusions", async () => {
  const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
    product: dish(),
    filters: noNuts,
    initialSelections: {
      extras: [
        { listId: "toppings", productId: "Walnuts", name: "Walnuts", price: "1.00", quantity: 1 },
      ],
    },
  });
  expect(el.shadowRoot!.querySelector(".allergen-removal")).toBeNull();
  expect(el.shadowRoot!.textContent).toContain("Walnuts");
  expect(
    el.shadowRoot!.querySelector<HTMLInputElement>('input[id="pick-toppings-Walnuts"]')?.checked,
  ).toBe(true);
});
