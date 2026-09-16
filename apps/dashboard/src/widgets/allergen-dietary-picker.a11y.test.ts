import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./allergen-dietary-picker.js";
import type { AllergenDietaryPicker, AllergenDietaryValue } from "./allergen-dietary-picker.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("allergen-dietary-picker a11y (%s theme)", (theme) => {
  it.each<{ label: string; value: AllergenDietaryValue; busy?: boolean }>([
    { label: "empty", value: { allergens: [], dietary: [] } },
    {
      label: "populated",
      value: { allergens: ["milk", "gluten"], dietary: ["vegan", "vegetarian"] },
    },
    { label: "busy", value: { allergens: ["milk"], dietary: ["halal"] }, busy: true },
  ])("renders the $label state accessibly", async ({ value, busy }) => {
    const { host } = await mountWidget<AllergenDietaryPicker>(
      "dashboard-allergen-dietary-picker",
      { value, busy: busy ?? false },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it.each(["allergens", "dietary"] as const)("renders the %s editor accessibly", async (field) => {
    const { el, host } = await mountWidget<AllergenDietaryPicker>(
      "dashboard-allergen-dietary-picker",
      { value: { allergens: ["milk"], dietary: ["vegan"] } },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>(`[data-test="edit-${field}"]`)!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
