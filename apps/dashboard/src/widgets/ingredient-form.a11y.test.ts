import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./ingredient-form.js";
import type { IngredientForm } from "./ingredient-form.js";
import type { Ingredient } from "../api/client.js";

/**
 * A closed <dialog> renders nothing to test, so it is mounted with `open = true` and its wt-dialog's
 * first render is settled before axe runs. The ingredient's allergens are DECLARED, so the allergen
 * picker renders a declared row with enabled controls, which a PENDING picker would not.
 */
const INGREDIENT: Ingredient = {
  id: "ing-1",
  name: "Leche entera",
  allergens: { milk: { presence: "contains", source: "vaca" } },
  dietaryOrigin: "dairy",
  active: false,
};

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("ingredient-form a11y (%s theme)", (theme) => {
  it("renders accessibly when open", async () => {
    const { el, host } = await mountWidget<IngredientForm>(
      "dashboard-ingredient-form",
      { open: true, ingredient: INGREDIENT },
      theme,
    );
    const wtDialog = el.shadowRoot!.querySelector("wt-dialog")!;
    await (wtDialog as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    const picker = el.shadowRoot!.querySelector("dashboard-allergen-picker")!;
    await (picker as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    await expectNoA11yViolations(host);
  });
});
