import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "./test-helpers.js";
import { ChoiceForm, type ChoiceDraft } from "./choice-form.js";

afterEach(cleanupWidgets);

const extras: ChoiceDraft = {
  id: "c",
  name: { es: "Queso" },
  available: true,
  priceDelta: "1.00",
  maxQuantity: 1,
  addAllergens: { milk: { presence: "contains" } },
  dietaryEffect: { invalidates: ["vegetarian"] },
};
const options: ChoiceDraft = {
  id: "c",
  name: { es: "Opción" },
  available: true,
  addAllergens: { milk: { presence: "contains" } },
  dietaryEffect: { invalidates: ["vegetarian"] },
};

describe.each(["light", "dark"] as const)("choice form (%s)", (theme) => {
  it.each([
    { kind: "extras", value: extras },
    { kind: "options", value: options },
  ] as const)("accessible $kind controls", async ({ kind, value }) => {
    const { el, host } = await mountWidget<ChoiceForm>(
      "dashboard-choice-form",
      { open: true, kind, value, locales: ["es", "en"] },
      theme,
    );
    await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
    const details = el.shadowRoot!.querySelector("details");
    if (details) details.open = true;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("accessible invalid fields", async () => {
    const { el, host } = await mountWidget<ChoiceForm>(
      "dashboard-choice-form",
      { open: true, kind: "extras", value: null, locales: ["es"] },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="choice-save"]')!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
