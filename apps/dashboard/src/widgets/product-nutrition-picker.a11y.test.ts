import { afterEach, describe, expect, it } from "vitest";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { ProductNutritionPicker } from "./product-nutrition-picker.js";
import type { NutritionValue } from "./product-nutrition.js";
registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);
const values: {
  label: string;
  value: NutritionValue;
  busy?: boolean;
  errors?: Record<string, string>;
}[] = [
  { label: "unreviewed", value: { allergens: null, dietaryDeclarations: [] } },
  { label: "None", value: { allergens: {}, dietaryDeclarations: [] } },
  {
    label: "kinds and implied diets",
    value: {
      allergens: { gluten: { kinds: ["wheat", "oats"] }, nuts: { kinds: ["walnuts"] } },
      dietaryDeclarations: ["vegan"],
    },
  },
  {
    label: "missing kinds",
    value: { allergens: { gluten: {}, nuts: {} }, dietaryDeclarations: ["vegetarian"] },
    errors: { "allergens-gluten": "Choose which cereals", "allergens-nuts": "Choose which nuts" },
  },
  { label: "busy", value: { allergens: { eggs: {} }, dietaryDeclarations: ["halal"] }, busy: true },
];
describe.each(["light", "dark"] as const)("product nutrition (%s)", (theme) => {
  it.each(values)("exposes $label accessibly", async ({ value, busy, errors }) => {
    const { host } = await mountWidget<ProductNutritionPicker>(
      "dashboard-product-nutrition-picker",
      { value, busy: busy ?? false, errors: errors ?? {} },
      theme,
    );
    await expectNoA11yViolations(host);
  });
  it("exposes inherited read-only choices accessibly", async () => {
    const { host, el } = await mountWidget<ProductNutritionPicker>(
      "dashboard-product-nutrition-picker",
      {
        value: { allergens: null, dietaryDeclarations: null },
        inherited: {
          name: "House bread",
          unitPrice: "3.00",
          vatClass: "reduced",
          unitId: null,
          primaryCategoryId: null,
          courseId: null,
          description: null,
          image: null,
          allergens: { gluten: { kinds: ["barley"] } },
          dietaryDeclarations: ["vegan"],
        },
      },
      theme,
    );
    expect(
      el.shadowRoot!.querySelector<HTMLButtonElement>('[data-choice="kind-gluten-barley"]')!
        .disabled,
    ).toBe(true);
    await expectNoA11yViolations(host);
  });
  it("paints selected and implied chips from the theme tokens", async () => {
    const { el } = await mountWidget<ProductNutritionPicker>(
      "dashboard-product-nutrition-picker",
      { value: { allergens: { milk: {} }, dietaryDeclarations: ["vegan"] } },
      theme,
    );
    el.style.setProperty("--wt-color-primary", "rgb(12, 34, 56)");
    el.style.setProperty("--wt-color-surface-lifted", "rgb(67, 89, 101)");
    el.style.setProperty("--wt-radius-full", "17px");
    const chosen = el.shadowRoot!.querySelector<HTMLElement>('[data-choice="allergen-milk"]')!;
    const implied = el.shadowRoot!.querySelector<HTMLElement>('[data-choice="diet-vegetarian"]')!;
    expect(getComputedStyle(chosen).backgroundColor).toBe("rgb(12, 34, 56)");
    expect(getComputedStyle(chosen).borderRadius).toBe("17px");
    expect(getComputedStyle(implied).backgroundColor).toBe("rgb(67, 89, 101)");
    const icon = chosen.querySelector("wt-icon")!;
    await icon.updateComplete;
    expect(icon.shadowRoot!.querySelector("path")!.getAttribute("d")!.length).toBeGreaterThan(10);
  });
});

it("uses the shared opacity token for busy controls", async () => {
  const { el } = await mountWidget<ProductNutritionPicker>("dashboard-product-nutrition-picker", {
    busy: true,
  });
  el.style.setProperty("--wt-opacity-disabled", "0.23");
  const button = el.shadowRoot!.querySelector("button")!;
  expect(button.disabled).toBe(true);
  expect(getComputedStyle(button).opacity).toBe("0.23");
});
