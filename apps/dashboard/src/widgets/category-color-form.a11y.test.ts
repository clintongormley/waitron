import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type { CategoryColorForm } from "./category-color-form.js";
import "./category-color-form.js";
afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("category colour (%s)", (theme) => {
  it.each(["coloured", "uncoloured", "busy", "refused"] as const)(
    "renders %s accessibly",
    async (state) => {
      const { host } = await mountWidget<CategoryColorForm>(
        "dashboard-category-color-form",
        {
          open: true,
          busy: state === "busy",
          heading: "Colour of Drinks",
          color: state === "uncoloured" ? null : "#b12525",
          errors:
            state === "refused"
              ? { color: t("editor.field_rejected"), _form: codeMessage("server.internal") }
              : {},
        },
        theme,
      );
      await expectNoA11yViolations(host);
    },
  );
});
