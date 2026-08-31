import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./modifier-picker.js";
import type { TillModifierPicker } from "./modifier-picker.js";
import type { TillProduct } from "../api/client.js";

const burger: TillProduct = {
  id: "burger",
  descriptions: { en: "Burger", es: "Hamburguesa" },
  pricingUnit: "each",
  unitPrice: "8.00",
  vatClass: "general",
  category: null,
  allergens: null,
  optionGroups: [
    {
      id: "g-doneness",
      name: { en: "Doneness", es: "Punto" },
      minSelect: 1,
      maxSelect: 1,
      required: true,
      items: [
        {
          id: "i-rare",
          name: { en: "Rare", es: "Poco hecha" },
          priceDelta: "0.00",
          vatClass: null,
          maxQuantity: 1,
          addAllergens: null,
          removeAllergens: null,
          addOrigins: null,
          removeOrigins: null,
        },
        {
          id: "i-medium",
          name: { en: "Medium", es: "Al punto" },
          priceDelta: "0.00",
          vatClass: null,
          maxQuantity: 1,
          addAllergens: null,
          removeAllergens: null,
          addOrigins: null,
          removeOrigins: null,
        },
      ],
    },
    {
      id: "g-extras",
      name: { en: "Extras", es: "Extras" },
      minSelect: 0,
      maxSelect: 3,
      required: false,
      items: [
        {
          id: "i-cheese",
          name: { en: "Cheese", es: "Queso" },
          priceDelta: "1.00",
          vatClass: null,
          maxQuantity: 1,
          addAllergens: null,
          removeAllergens: null,
          addOrigins: null,
          removeOrigins: null,
        },
        {
          id: "i-bacon",
          name: { en: "Bacon", es: "Bacon" },
          priceDelta: "1.50",
          vatClass: null,
          maxQuantity: 1,
          addAllergens: null,
          removeAllergens: null,
          addOrigins: null,
          removeOrigins: null,
        },
        // A per-option-quantity item (maxQuantity 2) so the sweep also covers the stepper controls.
        {
          id: "i-shot",
          name: { en: "Extra shot", es: "Café extra" },
          priceDelta: "0.60",
          vatClass: null,
          maxQuantity: 2,
          addAllergens: null,
          removeAllergens: null,
          addOrigins: null,
          removeOrigins: null,
        },
      ],
    },
  ],
};

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-modifier-picker a11y (%s theme)", (theme) => {
  it("has no violations with radio + checkbox groups shown", async () => {
    setLocale("es-ES");
    const { host } = await mountWidget<TillModifierPicker>(
      "till-modifier-picker",
      { product: burger },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations once a group is at its max (disabled options)", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillModifierPicker>(
      "till-modifier-picker",
      { product: burger },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLInputElement>("#opt-i-rare")!.click();
    el.shadowRoot!.querySelector<HTMLInputElement>("#opt-i-cheese")!.click();
    el.shadowRoot!.querySelector<HTMLInputElement>("#opt-i-bacon")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations with a per-option-quantity stepper stepped up (labelled controls)", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillModifierPicker>(
      "till-modifier-picker",
      { product: burger },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLInputElement>("#opt-i-rare")!.click();
    // Step the "extra shot" up once so the stepper (and its accessible labels) is on screen.
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="opt-i-shot-inc"]')!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
