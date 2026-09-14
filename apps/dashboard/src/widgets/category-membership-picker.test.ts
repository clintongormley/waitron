import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { CategoryMembershipPicker } from "./category-membership-picker.js";
import { setLocale, t } from "../i18n/t.js";
import type { CategorySummary, ProductCategories } from "../api/client.js";

afterEach(cleanupWidgets);
afterEach(() => setLocale("es-ES"));

const food: CategorySummary = {
  id: "food",
  name: { en: "Food" },
  image: null,
  color: "#112233",
  parentId: null,
};
const drink: CategorySummary = {
  id: "drink",
  name: { en: "Drinks" },
  image: null,
  color: null,
  parentId: null,
};

/** Drives a `wt-combobox` the way the real component does when a person picks an option. */
function pick(combobox: HTMLElement, detail: { values: string[] } | { value: string }): void {
  Object.assign(combobox, detail);
  combobox.dispatchEvent(new CustomEvent("wt-change", { detail, bubbles: true, composed: true }));
}

it("emits the chosen category ids and reporting id from the comboboxes", async () => {
  setLocale("en-GB");
  const cats: CategorySummary[] = [
    { id: "food", name: { en: "Food" }, image: null, color: "#112233", parentId: null },
    { id: "drink", name: { en: "Drinks" }, image: null, color: null, parentId: null },
  ];
  const el = await mountWidget<CategoryMembershipPicker>("dashboard-category-membership-picker", {
    categories: cats,
    languages: { defaultLanguage: "en", languages: ["en"] },
    value: { categoryIds: ["food"], primaryCategoryId: "food" },
  });
  // multi-select the drink category
  const multi = el.el.shadowRoot!.querySelector<HTMLElement & { values: string[] }>(
    'wt-combobox[data-test="member-categories"]',
  )!;
  multi.values = ["food", "drink"];
  multi.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { values: ["food", "drink"] },
      bubbles: true,
      composed: true,
    }),
  );
  await el.el.updateComplete;
  const events: { value: ProductCategories }[] = [];
  el.el.addEventListener("wt-submit", (e) => events.push((e as CustomEvent).detail));
  el.el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-membership"]')!.click();
  expect(events[0].value.categoryIds.sort()).toEqual(["drink", "food"]);
});

it("shows the chosen categories as lozenges", async () => {
  const cats: CategorySummary[] = [
    { id: "food", name: { en: "Food" }, image: null, color: "#112233", parentId: null },
  ];
  const el = await mountWidget<CategoryMembershipPicker>("dashboard-category-membership-picker", {
    categories: cats,
    languages: { defaultLanguage: "en", languages: ["en"] },
    value: { categoryIds: ["food"], primaryCategoryId: "food" },
  });
  expect(el.el.shadowRoot!.querySelectorAll("wt-lozenge").length).toBe(1);
});

it("makes the first chosen category the reporting one and keeps it across further picks", async () => {
  const { el } = await mountWidget<CategoryMembershipPicker>(
    "dashboard-category-membership-picker",
    {
      categories: [food, drink],
      languages: { defaultLanguage: "en", languages: ["en"] },
      value: { categoryIds: [], primaryCategoryId: null },
    },
  );
  const multi = el.shadowRoot!.querySelector<HTMLElement>(
    'wt-combobox[data-test="member-categories"]',
  )!;
  pick(multi, { values: ["food"] });
  await el.updateComplete;
  pick(multi, { values: ["food", "drink"] });
  await el.updateComplete;
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-membership"]')!.click();
  expect(submit.mock.calls[0]![0].detail.value).toEqual({
    categoryIds: ["food", "drink"],
    primaryCategoryId: "food",
  });
});

it("clears the reporting category when its category is removed", async () => {
  const { el } = await mountWidget<CategoryMembershipPicker>(
    "dashboard-category-membership-picker",
    {
      categories: [food, drink],
      languages: { defaultLanguage: "en", languages: ["en"] },
      value: { categoryIds: ["food", "drink"], primaryCategoryId: "food" },
    },
  );
  const multi = el.shadowRoot!.querySelector<HTMLElement>(
    'wt-combobox[data-test="member-categories"]',
  )!;
  pick(multi, { values: ["drink"] });
  await el.updateComplete;
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-membership"]')!.click();
  expect(submit.mock.calls[0]![0].detail.value).toEqual({
    categoryIds: ["drink"],
    primaryCategoryId: null,
  });
});

it("submits memberships with no reporting category", async () => {
  const { el } = await mountWidget<CategoryMembershipPicker>(
    "dashboard-category-membership-picker",
    {
      categories: [food, drink],
      languages: { defaultLanguage: "en", languages: ["en"] },
      value: { categoryIds: [], primaryCategoryId: null },
    },
  );
  const multi = el.shadowRoot!.querySelector<HTMLElement>(
    'wt-combobox[data-test="member-categories"]',
  )!;
  pick(multi, { values: ["food"] });
  await el.updateComplete;
  pick(multi, { values: ["food", "drink"] });
  await el.updateComplete;
  // Choosing the first category auto-assigns it as reporting; explicitly choose "None" instead.
  const reporting = el.shadowRoot!.querySelector<HTMLElement>(
    'wt-combobox[data-test="reporting-category"]',
  )!;
  pick(reporting, { value: "" });
  await el.updateComplete;
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
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
      languages: { defaultLanguage: "en", languages: ["en"] },
      value: { categoryIds: ["food"], primaryCategoryId: "food" },
    },
  );
  const reporting = el.shadowRoot!.querySelector<
    HTMLElement & { options: { value: string; label: string }[] }
  >('wt-combobox[data-test="reporting-category"]')!;
  const none = reporting.options.find((option) => option.value === "");
  expect(none?.label).toBe(t("categories.none"));
  pick(reporting, { value: "" });
  await el.updateComplete;
  const submit = vi.fn();
  el.addEventListener("wt-submit", submit);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-membership"]')!.click();
  expect(submit.mock.calls[0]![0].detail.value).toEqual({
    categoryIds: ["food"],
    primaryCategoryId: null,
  });
});

it("labels both comboboxes' search, empty and count text in the reader's language", async () => {
  const { el } = await mountWidget<CategoryMembershipPicker>(
    "dashboard-category-membership-picker",
    {
      categories: [food, drink],
      languages: { defaultLanguage: "en", languages: ["en"] },
      value: { categoryIds: ["food", "drink"], primaryCategoryId: "food" },
    },
  );
  for (const test of ["member-categories", "reporting-category"]) {
    const combobox = el.shadowRoot!.querySelector<
      HTMLElement & { updateComplete: Promise<unknown> }
    >(`wt-combobox[data-test="${test}"]`)!;
    await combobox.updateComplete;
    const search = combobox.shadowRoot!.querySelector<HTMLInputElement>("input.search")!;
    expect(search.placeholder).toBe(t("categories.combobox_search"));
    search.value = "zzz";
    search.dispatchEvent(new Event("input"));
    await combobox.updateComplete;
    expect(combobox.shadowRoot!.textContent).toContain(t("categories.combobox_no_results"));
  }
  const multi = el.shadowRoot!.querySelector<HTMLElement>(
    'wt-combobox[data-test="member-categories"]',
  )!;
  expect(multi.shadowRoot!.querySelector(".value")!.textContent!.trim()).toBe(
    t("categories.combobox_selected").replace("{count}", "2"),
  );
});

it("gives both comboboxes a semantic field name", async () => {
  const { el } = await mountWidget<CategoryMembershipPicker>(
    "dashboard-category-membership-picker",
    {
      categories: [food, drink],
      languages: { defaultLanguage: "en", languages: ["en"] },
      value: { categoryIds: ["food"], primaryCategoryId: "food" },
    },
  );
  expect(
    el
      .shadowRoot!.querySelector('wt-combobox[data-test="member-categories"]')!
      .getAttribute("name"),
  ).toBe("category-membership");
  expect(
    el
      .shadowRoot!.querySelector('wt-combobox[data-test="reporting-category"]')!
      .getAttribute("name"),
  ).toBe("primary-category");
});
