import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./ingredient-list.js";
import type { IngredientList } from "./ingredient-list.js";
import type { Ingredient } from "../api/client.js";

/**
 * The ingredient list is a PURE DISPLAY widget — no `api`, so no in-flight fetch to settle. It is
 * mounted with `ingredients` assigned as a property, in both themes, and axe is run against the themed
 * host so a color-contrast check means what it means in the app.
 *
 * The fixture covers all THREE allergen states (null=PENDING, {}=none, {…}=declared) so axe sees the
 * whole rendered surface — every branch of the allergen pill plus the per-row Edit control.
 */
const ingredients: Ingredient[] = [
  { id: "i1", name: "Harina de trigo", allergens: null, active: true },
  { id: "i2", name: "Sal", allergens: {}, active: true },
  {
    id: "i3",
    name: "Leche entera",
    allergens: { milk: { presence: "contains" } },
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
