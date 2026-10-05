import { afterEach, describe, expect, it } from "vitest";
import { html, render } from "lit";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { categoryPathField } from "./classification-fields.js";
afterEach(cleanupWidgets);
const category = {
  id: "food",
  name: "Food",
  parentId: null,
  color: null,
};
describe.each(["light", "dark"] as const)("category path field (%s)", (theme) => {
  it.each(["none", "chosen", "invalid", "disabled"] as const)(
    "renders %s accessibly",
    async (state) => {
      const { el, host } = await mountWidget<HTMLDivElement>("div", {}, theme);
      render(
        html`${categoryPathField({
          name: "primary",
          label: "Category",
          actionLabel: "Change",
          categories: [category],
          value: state === "chosen" ? category.id : null,
          noneLabel: "Uncategorised",
          missingLabel: "Unavailable selection",
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
