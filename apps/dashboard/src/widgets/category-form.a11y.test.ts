import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { CategoryForm } from "./category-form.js";
import { html, render } from "lit";
import { categoryField } from "./classification-fields.js";
afterEach(cleanupWidgets);
const category = {
  id: "food",
  name: "Food",
  parentId: null,
};
describe.each(["light", "dark"] as const)("category forms (%s)", (theme) => {
  it.each(["create", "edit", "invalid", "busy", "server-error"] as const)(
    "renders %s accessibly",
    async (state) => {
      const { el, host } = await mountWidget<CategoryForm>(
        "dashboard-category-form",
        {
          open: true,
          categories: [category],
          value: state === "edit" ? category : null,
          busy: state === "busy",
          fieldErrors: state === "server-error" ? { parent: "Choose another parent." } : {},
        },
        theme,
      );
      if (state === "invalid") {
        el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
        await el.updateComplete;
      }
      await expectNoA11yViolations(host);
    },
  );
  it.each(["none", "chosen", "invalid", "disabled"] as const)(
    "renders the main-category field %s accessibly",
    async (state) => {
      const { el, host } = await mountWidget<HTMLDivElement>("div", {}, theme);
      render(
        html`${categoryField({
          name: "primary",
          label: "Main category",
          categories: [category],
          value: state === "chosen" ? category.id : null,
          noneLabel: "Uncategorised",
          error: state === "invalid" ? "Choose another category." : "",
          disabled: state === "disabled",
          change: () => {},
        })}`,
        el,
      );
      const fields = [
        ...el.querySelectorAll<HTMLElement & { updateComplete: Promise<unknown> }>("wt-combobox"),
      ];
      expect(fields).toHaveLength(1);
      await Promise.all(fields.map((field) => field.updateComplete));
      await expectNoA11yViolations(host);
    },
  );
});
