import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { UnitForm } from "./unit-form.js";
import "./unit-form.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("unit-form a11y (%s theme)", (theme) => {
  it("renders create and edit states accessibly", async () => {
    for (const value of [
      null,
      {
        id: "u1",
        name: { es: "kilogramo", en: "kilogram" },
        abbreviation: { es: "kg", en: "kg" },
        precision: 3,
      },
    ]) {
      const { el, host } = await mountWidget<UnitForm>(
        "dashboard-unit-form",
        { open: true, locales: ["es", "en"], value },
        theme,
      );
      await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
      await expectNoA11yViolations(host);
    }
  });
});
