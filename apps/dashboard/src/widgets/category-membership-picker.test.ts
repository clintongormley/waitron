import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { CategoryMembershipPicker } from "./category-membership-picker.js";
import { t } from "../i18n/t.js";
import type { CategorySummary } from "../api/client.js";

afterEach(cleanupWidgets);

const food: CategorySummary = {
  id: "food",
  name: { en: "Food" },
  image: null,
  color: null,
  parentId: null,
};
const drink: CategorySummary = {
  id: "drink",
  name: { en: "Drinks" },
  image: null,
  color: null,
  parentId: null,
};

it("submits memberships with no reporting category", async () => {
  const { el } = await mountWidget<CategoryMembershipPicker>(
    "dashboard-category-membership-picker",
    {
      categories: [food, drink],
      locales: ["en"],
      value: { categoryIds: [], primaryCategoryId: null },
    },
  );
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  for (const category of [food, drink]) {
    el.shadowRoot!.querySelector<HTMLInputElement>(`input[value=${category.id}]`)!.click();
    await el.updateComplete;
  }
  // Checking the first category auto-assigns it as primary; explicitly choose "None" instead.
  const primary = el.shadowRoot!.querySelector<HTMLSelectElement>(
    'select[name="primary-category"]',
  )!;
  primary.value = "";
  primary.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-membership"]')!.click();
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0].detail.value).toEqual({
    categoryIds: ["food", "drink"],
    primaryCategoryId: null,
  });
});

it("offers a None option that maps the reporting category to null", async () => {
  const { el } = await mountWidget<CategoryMembershipPicker>(
    "dashboard-category-membership-picker",
    {
      categories: [food],
      locales: ["en"],
      value: { categoryIds: ["food"], primaryCategoryId: "food" },
    },
  );
  const primary = el.shadowRoot!.querySelector<HTMLSelectElement>(
    'select[name="primary-category"]',
  )!;
  const none = primary.querySelector<HTMLOptionElement>('option[value=""]')!;
  expect(none.textContent?.trim()).toBe(t("categories.none"));
  primary.value = "";
  primary.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-membership"]')!.click();
  expect(submit.mock.calls[0]![0].detail.value).toEqual({
    categoryIds: ["food"],
    primaryCategoryId: null,
  });
});
