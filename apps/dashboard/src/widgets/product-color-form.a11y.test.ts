import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type { ProductColorForm } from "./product-color-form.js";
import "./product-color-form.js";
afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("product colour (%s)", (theme) => {
  it.each(["own", "category's", "category has none", "busy", "refused"] as const)(
    "renders %s accessibly",
    async (state) => {
      const { host } = await mountWidget<ProductColorForm>(
        "dashboard-product-color-form",
        {
          open: true,
          busy: state === "busy",
          name: "Lemonade",
          color: state === "own" || state === "refused" ? "#b12525" : null,
          inherited: state === "category has none" ? null : "#256bb1",
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
