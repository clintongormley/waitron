import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./allergen-dietary-picker.js";
import type { AllergenDietaryPicker, AllergenDietaryValue } from "./allergen-dietary-picker.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("allergen-dietary-picker a11y (%s theme)", (theme) => {
  it.each<AllergenDietaryValue>([
    { addAllergens: [], removeAllergens: [], dietary: [] },
    { addAllergens: ["milk"], removeAllergens: ["gluten"], dietary: ["vegan", "vegetarian"] },
  ])("renders value %j accessibly", async (value) => {
    const { host } = await mountWidget<AllergenDietaryPicker>(
      "dashboard-allergen-dietary-picker",
      { value },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
