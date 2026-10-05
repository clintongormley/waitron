import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type { CategoryDetailsForm } from "./category-details-form.js";
import "./category-details-form.js";
afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("category details (%s)", (theme) => {
  it.each(["coloured", "uncoloured", "invalid", "busy", "refused"] as const)(
    "renders %s accessibly",
    async (state) => {
      const { el, host } = await mountWidget<CategoryDetailsForm>(
        "dashboard-category-details-form",
        {
          open: true,
          busy: state === "busy",
          value: {
            id: "d",
            name: "Drinks",
            parentId: null,
            color: state === "uncoloured" ? null : "#b12525",
          },
          errors:
            state === "refused"
              ? {
                  name: codeMessage("category.name_taken"),
                  color: t("editor.field_rejected"),
                  _form: codeMessage("server.internal"),
                }
              : {},
        },
        theme,
      );
      if (state === "invalid") {
        el.shadowRoot!.querySelector('wt-input[name="category-name"]')!.dispatchEvent(
          new CustomEvent("wt-change", { detail: { value: "" }, bubbles: true, composed: true }),
        );
        await el.updateComplete;
        el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
        await el.updateComplete;
      }
      await expectNoA11yViolations(host);
    },
  );
});
