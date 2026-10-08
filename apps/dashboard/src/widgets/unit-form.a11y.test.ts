import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { UnitForm } from "./unit-form.js";
import "./unit-form.js";

afterEach(cleanupWidgets);

const KILOGRAM = {
  id: "u1",
  name: { es: "kilogramo", en: "kilogram" },
  abbreviation: { es: "kg", en: "kg" },
  precision: 3,
};

function saveOf(el: UnitForm) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=submit]")!;
}

describe.each(["light", "dark"] as const)("unit-form a11y (%s theme)", (theme) => {
  it("renders create and edit states accessibly with Save quiet", async () => {
    for (const value of [null, KILOGRAM]) {
      const { el, host } = await mountWidget<UnitForm>(
        "dashboard-unit-form",
        { open: true, locales: ["es", "en"], value },
        theme,
      );
      await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
      expect(saveOf(el).variant).toBe("secondary");
      expect(saveOf(el).disabled).toBe(true);
      await expectNoA11yViolations(host);
    }
  });

  it("renders a changed unit accessibly with Save primary", async () => {
    const { el, host } = await mountWidget<UnitForm>(
      "dashboard-unit-form",
      { open: true, locales: ["es", "en"], value: KILOGRAM },
      theme,
    );
    await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
    el.shadowRoot!.querySelector("[data-test=name-en]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "kilo" } }),
    );
    await el.updateComplete;
    expect(saveOf(el).variant).toBe("primary");
    expect(saveOf(el).disabled).toBe(false);
    await expectNoA11yViolations(host);
  });
});
