import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { CategoryForm } from "./category-form.js";
import { CategoryMembershipPicker } from "./category-membership-picker.js";
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
          locales: ["en", "fr"],
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
      { open: true, locales: ["en"], categories: [category] },
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

  it.each(["empty", "selected", "none"] as const)(
    "renders %s membership accessibly",
    async (state) => {
      const { el, host } = await mountWidget<CategoryMembershipPicker>(
        "dashboard-category-membership-picker",
        {
          categories: [category],
          locales: ["en"],
          value: {
            categoryIds: state === "empty" ? [] : [category.id],
            primaryCategoryId: state === "selected" ? category.id : null,
          },
        },
        theme,
      );
      // "none" saves with a category chosen and no reporting category — no longer an error state,
      // but still worth checking it renders (and submits) accessibly.
      if (state === "none") {
        el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-membership"]')!.click();
        await el.updateComplete;
      }
      await expectNoA11yViolations(host);
    },
  );
});
