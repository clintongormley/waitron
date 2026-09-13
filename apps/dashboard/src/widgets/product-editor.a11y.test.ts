import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { ProductEditor } from "./product-editor.js";

afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("product editor accessibility (%s)", (theme) => {
  it.each(["empty", "errors", "selected", "picker"])("renders %s", async (state) => {
    const { el, host } = await mountWidget<ProductEditor>(
      "dashboard-product-editor",
      {
        open: true,
        locales: ["en", "es"],
        units: [{ id: "each", name: { en: "Each" } }],
        taxChoices: [{ id: "reduced", rate: "10.00", label: "Reduced" }],
        value:
          state === "selected"
            ? {
                name: { en: "Coffee" },
                description: null,
                kitchenName: "BAR",
                image: null,
                unitId: "each",
                unitPrice: "3.00",
                vatClass: "reduced",
                available: true,
                variants: [{ name: { en: "Small" }, unitPrice: "2.00", available: true }],
                allergens: { milk: { presence: "may_contain" } },
                dietaryDeclarations: ["vegan"],
                categoryIds: ["drinks"],
                primaryCategoryId: "drinks",
                modifierIds: ["milk"],
              }
            : null,
        categories: [{ id: "drinks", name: { en: "Drinks" } }],
        modifiers: [{ id: "milk", name: { en: "Milk" } }],
      },
      theme,
    );
    if (state === "errors") el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    if (state === "picker")
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=pick-modifier]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
