import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { CategoryForm } from "./category-form.js";
import { html, render } from "lit";
import { categoryField, labelsField } from "./classification-fields.js";
afterEach(cleanupWidgets);
const category = {
  id: "food",
  name: { en: "Food", fr: "Cuisine" },
  image: null,
  color: null,
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
          languages: { defaultLanguage: "en", languages: ["en", "fr"] },
          categories: [category],
          value: state === "edit" ? category : null,
          busy: state === "busy",
          fieldErrors:
            state === "server-error"
              ? { parent: "Choose another parent.", image: "Choose an existing image." }
              : {},
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
  it("names the colour radiogroup and every one of its options", async () => {
    const { el } = await mountWidget<CategoryForm>(
      "dashboard-category-form",
      {
        open: true,
        languages: { defaultLanguage: "en", languages: ["en"] },
        categories: [category],
      },
      theme,
    );
    const group = el.shadowRoot!.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-label")).toBeTruthy();
    const options = [...group.querySelectorAll('[role="radio"]')];
    expect(options.length).toBeGreaterThan(1);
    for (const option of options) {
      const name = option.getAttribute("aria-label") ?? option.textContent?.trim();
      expect(name).toBeTruthy();
    }
  });

  it.each(["none", "chosen", "invalid", "disabled"] as const)(
    "renders the main-category and labels fields %s accessibly",
    async (state) => {
      const { el, host } = await mountWidget<HTMLDivElement>("div", {}, theme);
      render(
        html`${categoryField({
          name: "primary",
          label: "Main category",
          categories: [category],
          languages: { defaultLanguage: "en", languages: ["en"] },
          value: state === "chosen" ? category.id : null,
          noneLabel: "Uncategorised",
          error: state === "invalid" ? "Choose another category." : "",
          disabled: state === "disabled",
          change: () => {},
        })}
        ${labelsField({
          labels: [
            { id: "l1", name: "Alcoholic" },
            { id: "l2", name: "Happy hour drinks" },
          ],
          value: state === "none" ? [] : ["l1", "l2"],
          error: state === "invalid" ? "Choose each label once." : "",
          disabled: state === "disabled",
          change: () => {},
        })}`,
        el,
      );
      const fields = [
        ...el.querySelectorAll<HTMLElement & { updateComplete: Promise<unknown> }>("wt-combobox"),
      ];
      expect(fields).toHaveLength(2);
      await Promise.all(fields.map((field) => field.updateComplete));
      await expectNoA11yViolations(host);
    },
  );
});
