import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { SectionDetailsForm } from "./section-details-form.js";
afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("section details (%s)", (theme) => {
  it.each(["create", "edit", "changed", "invalid", "busy", "refused"] as const)(
    "renders %s accessibly",
    async (state) => {
      const { el, host } = await mountWidget<SectionDetailsForm>(
        "dashboard-section-details-form",
        {
          open: true,
          heading: "Section details",
          languages: { defaultLanguage: "en", languages: ["en", "es"] },
          busy: state === "busy",
          value:
            state === "edit" || state === "changed"
              ? {
                  id: "s",
                  internalName: "Starters",
                  names: { en: "To begin", es: "Para empezar" },
                  image: null,
                  color: "#aa3300",
                  members: [],
                }
              : null,
          refusal:
            state === "refused"
              ? {
                  code: "menu_section.translation_required",
                  params: { field: "names", language: "es" },
                }
              : null,
        },
        theme,
      );
      if (state === "changed") {
        el.shadowRoot!.querySelector("[name=internalName]")!.dispatchEvent(
          new CustomEvent("wt-change", {
            detail: { value: "Mains" },
            bubbles: true,
            composed: true,
          }),
        );
        await el.updateComplete;
      }
      if (state === "invalid") {
        el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
        await el.updateComplete;
      }
      await expectNoA11yViolations(host);
    },
  );
});
