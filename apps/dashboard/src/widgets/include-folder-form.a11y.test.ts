import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { IncludeFolderForm } from "./include-folder-form.js";
afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("include folder (%s)", (theme) => {
  it.each(["on", "changed", "off", "busy", "refused"] as const)(
    "renders %s accessibly",
    async (state) => {
      const { el, host } = await mountWidget<IncludeFolderForm>(
        "dashboard-include-folder-form",
        {
          open: true,
          menuName: "Drinks list",
          own: { names: { en: "Drinks", es: "Bebidas" }, image: null, color: "#aa3300" },
          value: {
            showAsFolder: state !== "off",
            overrides: { names: { en: "Bar" } },
          },
          languages: { defaultLanguage: "en", languages: ["en", "es"] },
          busy: state === "busy",
          fieldErrors: state === "refused" ? { "names-es": "Check the Spanish name." } : {},
        },
        theme,
      );
      if (state === "changed") {
        el.shadowRoot!.querySelector("[name=names-es]")!.dispatchEvent(
          new CustomEvent("wt-change", {
            detail: { value: "Barra" },
            bubbles: true,
            composed: true,
          }),
        );
        await el.updateComplete;
      }
      await expectNoA11yViolations(host);
    },
  );
});
