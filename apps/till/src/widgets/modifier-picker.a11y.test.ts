import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./modifier-picker.js";
import type { TillModifierPicker } from "./modifier-picker.js";
import { sellingValuesOf, type OfferedModifier, type TillProduct } from "../api/client.js";

/** Three DIFFERENT texts per name, as every fixture in this package gives (CLAUDE.md §3). */
function offeredItem(productId: string, staff: string, price: string, maxQuantity = 1) {
  return {
    productId,
    name: staff,
    customerName: { es: `${staff} carta` },
    kitchenName: `${staff} KDS`,
    price,
    vatClass: "general" as const,
    maxQuantity,
    preselected: false,
    addAllergens: null,
    suitableFor: [],
  };
}

const extras: OfferedModifier = {
  kind: "extras",
  id: "list-extras",
  name: "Extras",
  customerName: { es: "Extras carta" },
  kitchenName: "Extras KDS",
  minPicks: 0,
  maxPicks: 2,
  items: [offeredItem("p-bacon", "Bacon", "1.50"), offeredItem("p-cheese", "Queso", "1.00", 3)],
};

const cooked: OfferedModifier = {
  kind: "options",
  id: "list-cooked",
  name: "Punto",
  customerName: { es: "Punto carta" },
  kitchenName: "Punto KDS",
  defaultLabelId: "label-medium",
  labels: [
    {
      id: "label-rare",
      name: "Poco hecha",
      customerName: { es: "Poco hecha carta" },
      kitchenName: "Poco hecha KDS",
      available: true,
    },
    {
      id: "label-medium",
      name: "Al punto",
      customerName: { es: "Al punto carta" },
      kitchenName: "Al punto KDS",
      available: true,
    },
  ],
};

const burger: TillProduct = {
  id: "burger",
  name: "Burger",
  customerName: { es: "Burger carta" },
  pricingUnit: "each",
  unitPrice: "8.00",
  vatClass: "general",
  category: null,
  allergens: null,
  offeredModifiers: [extras, cooked],
};

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-modifier-picker a11y (%s theme)", (theme) => {
  it("has no violations with an extras list and an options list on screen", async () => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillModifierPicker>(
      "till-modifier-picker",
      { product: burger },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with variants listed, one unavailable and two with a price difference", async () => {
    setLocale("es-ES");
    const variant = (
      id: string,
      unitPrice: string,
      unitPriceDifference: string | null,
      available: boolean,
    ) => ({
      ...sellingValuesOf(burger),
      id,
      name: `Vino ${id}`,
      unitPrice,
      unitPriceDifference,
      available,
    });
    const { host } = await mountWidget<TillModifierPicker>(
      "till-modifier-picker",
      {
        product: {
          ...burger,
          offeredModifiers: [],
          variants: [
            variant("100", "7.50", "-0.50", false),
            variant("125", "9.50", "1.50", true),
            variant("150", "8.00", null, true),
          ],
        },
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations once a list is at its allowance (disabled controls)", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillModifierPicker>(
      "till-modifier-picker",
      { product: burger },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLInputElement>("#pick-list-extras-p-bacon")!.click();
    el.shadowRoot!.querySelector<HTMLElement>(
      '[data-test="pick-list-extras-p-cheese-inc"]',
    )!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations with a stepper stepped up (labelled controls)", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillModifierPicker>(
      "till-modifier-picker",
      { product: burger },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>(
      '[data-test="pick-list-extras-p-cheese-inc"]',
    )!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("announces an options list that offers no label", async () => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillModifierPicker>(
      "till-modifier-picker",
      {
        product: { ...burger, offeredModifiers: [{ ...cooked, defaultLabelId: null, labels: [] }] },
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("announces a reopened pick the dish no longer offers", async () => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillModifierPicker>(
      "till-modifier-picker",
      {
        product: burger,
        initialSelections: {
          extras: [
            { listId: "list-extras", productId: "p-gone", name: "Ido", price: "1.00", quantity: 1 },
          ],
          options: [{ listId: "list-cooked", labelId: "label-rare" }],
        },
      },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
