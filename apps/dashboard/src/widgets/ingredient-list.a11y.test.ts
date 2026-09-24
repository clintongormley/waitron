import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./ingredient-list.js";
import type { IngredientList } from "./ingredient-list.js";
import type { Ingredient } from "../api/client.js";

/**
 * The fixture covers all THREE allergen states (null=PENDING, {}=none, {…}=declared) so axe sees
 * every branch of the allergen pill.
 */
const ingredients: Ingredient[] = [
  { id: "i1", name: "Harina de trigo", allergens: null, dietaryOrigin: null, active: true },
  { id: "i2", name: "Sal", allergens: {}, dietaryOrigin: null, active: true },
  {
    id: "i3",
    name: "Leche entera",
    allergens: { milk: { presence: "contains" } },
    dietaryOrigin: "dairy",
    active: false,
  },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("ingredient-list a11y (%s theme)", (theme) => {
  it("renders accessibly", async () => {
    const { host } = await mountWidget<IngredientList>(
      "dashboard-ingredient-list",
      { ingredients },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
