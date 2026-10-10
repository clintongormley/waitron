import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./recipe-editor.js";
import type { RecipeEditor } from "./recipe-editor.js";
import type { Ingredient, Product, RecipeLine } from "../api/client.js";

/**
 * With no product the editor renders nothing, so it is mounted with one, and with a PARTIAL recipe —
 * one ingredient pre-checked, the rest off — so axe sees both switch states.
 */
const INGREDIENTS: Ingredient[] = [
  {
    id: "i1",
    name: "Harina de trigo",
    allergens: { gluten: { presence: "contains" } },
    dietaryOrigin: null,
    active: true,
  },
  { id: "i2", name: "Sal", allergens: {}, dietaryOrigin: null, active: true },
  {
    id: "i3",
    name: "Leche entera",
    allergens: { milk: { presence: "contains" } },
    dietaryOrigin: "dairy",
    active: true,
  },
];

const RECIPE: RecipeLine[] = [INGREDIENTS[0]];

const PRODUCT: Product = {
  id: "prod-1",
  modifiers: [],
  catalogueId: "cat-1",
  categoryId: null,
  primaryCategoryId: null,
  name: "Bizcocho",
  customerName: { es: "Bizcocho de la abuela" },
  unitId: "u1",
  unit: { id: "u1", name: { es: "Unidad" }, precision: 0, abbreviation: { es: "ud" } },
  description: null,
  kitchenName: null,
  dietaryDeclarations: [],
  pricingUnit: "each",
  unitPrice: "3.50",
  vatClass: "reduced",
  active: true,
  available: true,
  ordering: "public",
  allergens: null,
  dietOverride: null,
  dietDerivation: null,
  manualAllergens: null,
  image: null,
  color: null,
  variants: [],
};

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("recipe-editor a11y (%s theme)", (theme) => {
  it("renders accessibly with an untouched recipe and Save quiet", async () => {
    const { el, host } = await mountWidget<RecipeEditor>(
      "dashboard-recipe-editor",
      { product: PRODUCT, ingredients: INGREDIENTS, recipe: RECIPE },
      theme,
    );
    const save =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm]")!;
    expect(save.variant).toBe("secondary");
    expect(save.disabled).toBe(true);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with a changed recipe and Save primary", async () => {
    const { el, host } = await mountWidget<RecipeEditor>(
      "dashboard-recipe-editor",
      { product: PRODUCT, ingredients: INGREDIENTS, recipe: RECIPE },
      theme,
    );
    el.shadowRoot!.querySelector("[data-test=ing-i2]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked: true } }),
    );
    await el.updateComplete;
    const save =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm]")!;
    expect(save.variant).toBe("primary");
    expect(save.disabled).toBe(false);
    await expectNoA11yViolations(host);
  });
});
