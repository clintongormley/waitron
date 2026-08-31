import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./recipe-editor.js";
import type { RecipeEditor } from "./recipe-editor.js";
import type { Ingredient, Product, RecipeLine } from "../api/client.js";

/**
 * The recipe editor renders its full surface only once a product is chosen (with no product it renders
 * nothing), so it is mounted with a product, the ingredient list, and a PARTIAL recipe — one ingredient
 * pre-checked, the rest off — so axe sees both switch states plus the Save/Cancel footer, in both
 * themes. axe is run against the themed host so a color-contrast check means what it means in the app.
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
  catalogueId: "cat-1",
  categoryId: null,
  descriptions: { es: "Bizcocho" },
  pricingUnit: "each",
  unitPrice: "3.50",
  vatClass: "reduced",
  active: true,
  allergens: null,
  dietOverride: null,
  manualAllergens: null,
  image: null,
};

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("recipe-editor a11y (%s theme)", (theme) => {
  it("renders accessibly", async () => {
    const { host } = await mountWidget<RecipeEditor>(
      "dashboard-recipe-editor",
      { product: PRODUCT, ingredients: INGREDIENTS, recipe: RECIPE },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
