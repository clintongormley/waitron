import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./allergen-picker.js";
import type { AllergenDeclaration } from "../api/client.js";
import type { AllergenPicker } from "./allergen-picker.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("allergen-picker a11y (%s theme)", (theme) => {
  it.each<AllergenDeclaration>([null, {}, { milk: { presence: "contains" } }])(
    "renders declaration %j accessibly",
    async (declaration) => {
      const { host } = await mountWidget<AllergenPicker>(
        "dashboard-allergen-picker",
        { declaration },
        theme,
      );
      await expectNoA11yViolations(host);
    },
  );
  it("renders the searchable picker accessibly", async () => {
    const { el, host } = await mountWidget<AllergenPicker>(
      "dashboard-allergen-picker",
      { declaration: {} },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-allergen]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
