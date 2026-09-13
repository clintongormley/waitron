import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { CategoriesScreen } from "./categories-screen.js";
import type { DashboardApi, CategorySummary, Product } from "../api/client.js";
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
const product: Product = {
  catalogueId: "menu",
  categoryId: "food",
  pricingUnit: "each",
  unitPrice: "2",
  vatClass: "general",
  allergens: null,
  manualAllergens: null,
  dietOverride: null,
  image: null,
  id: "p",
  descriptions: { en: "Toast" },
  categoryIds: ["food", "drink"],
  primaryCategoryId: "food",
  active: true,
};
function apiFixture() {
  const api = {
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "en", languages: ["en", "fr"] }),
    listCategories: vi.fn().mockResolvedValue([food, drink]),
    listLibraryProducts: vi.fn().mockResolvedValue([product]),
    createCategory: vi.fn().mockResolvedValue({ ...food, id: "new" }),
    updateCategory: vi.fn().mockResolvedValue(food),
    deleteCategory: vi.fn().mockResolvedValue(undefined),
    replaceProductCategories: vi
      .fn()
      .mockResolvedValue({ categoryIds: ["drink"], primaryCategoryId: "drink" }),
  };
  return { api, client: api as unknown as DashboardApi };
}
async function mount() {
  const fx = apiFixture();
  const mounted = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  await vi.waitFor(() =>
    expect(mounted.el.shadowRoot!.querySelector("wt-data-table")?.rows.length).toBe(2),
  );
  return { ...fx, ...mounted };
}
it("counts direct memberships, opens category products and requires replacement on primary removal", async () => {
  const { el, api } = await mount();
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>('[data-category="food"]')!.click();
  await el.updateComplete;
  const products = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-products"]',
  )!;
  await products.updateComplete;
  expect(products.rows.map((row) => (row as { id: string }).id)).toEqual(["p"]);
  products.shadowRoot!.querySelector<HTMLElement>('[data-test="remove-membership"]')!.click();
  await el.updateComplete;
  const picker = el.shadowRoot!.querySelector("dashboard-category-membership-picker")!;
  await picker.updateComplete;
  picker.shadowRoot!.querySelector<HTMLElement>('[data-test="save-membership"]')!.click();
  expect(api.replaceProductCategories).not.toHaveBeenCalled();
  const primary = picker.shadowRoot!.querySelector<HTMLSelectElement>(
    'select[name="primary-category"]',
  )!;
  primary.value = "drink";
  primary.dispatchEvent(new Event("change", { bubbles: true }));
  await picker.updateComplete;
  picker.shadowRoot!.querySelector<HTMLElement>('[data-test="save-membership"]')!.click();
  await vi.waitFor(() =>
    expect(api.replaceProductCategories).toHaveBeenCalledWith("p", {
      categoryIds: ["drink"],
      primaryCategoryId: "drink",
    }),
  );
});
it("closes after a successful write even when refreshing fails and preserves failed-save drafts", async () => {
  const { el, api } = await mount();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="create-category"]')!.click();
  await el.updateComplete;
  const form = el.shadowRoot!.querySelector("dashboard-category-form")!;
  api.createCategory.mockRejectedValueOnce(new Error("save"));
  form.dispatchEvent(
    new CustomEvent("wt-submit", {
      detail: { value: { name: { en: "New" } } },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() => expect(form.busy).toBe(false));
  expect(form.open).toBe(true);
  api.listCategories.mockRejectedValueOnce(new Error("refresh"));
  form.dispatchEvent(
    new CustomEvent("wt-submit", {
      detail: { value: { name: { en: "New" } } },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() => expect(form.open).toBe(false));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="load-error"]')).not.toBeNull(),
  );
});

it("searches the translated name displayed in the table", async () => {
  const fx = apiFixture();
  fx.api.getContentLanguages.mockResolvedValue({ defaultLanguage: "en", languages: ["en", "es"] });
  fx.api.listCategories.mockResolvedValue([{ ...food, name: { en: "Food", es: "Comida" } }]);
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(1),
  );
  el.shadowRoot!.querySelector('[name="category-search"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Comida" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(1);
});

it("shows deletion dependencies and keeps the confirmation open", async () => {
  const { el, api } = await mount();
  api.deleteCategory.mockRejectedValue({
    code: "category.in_use",
    params: { children: 2, products: 3, routes: 4 },
  });
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  const actions = table.shadowRoot!.querySelector("wt-row-actions")!;
  actions.querySelectorAll("wt-button")[1]!.click();
  await el.updateComplete;
  const modal = [...el.shadowRoot!.querySelectorAll("wt-modal")].find((modal) => modal.open)!;
  modal
    .querySelector('wt-button[variant="danger"]')!
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => expect(modal.textContent).toContain("2"));
  expect(modal.textContent).toContain("3");
  expect(modal.textContent).toContain("4");
  expect(modal.open).toBe(true);
});

it("adds a category membership without removing the product's existing primary", async () => {
  const fx = apiFixture();
  fx.api.listLibraryProducts.mockResolvedValue([
    { ...product, categoryIds: ["drink"], primaryCategoryId: "drink" },
  ]);
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(2),
  );
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>('[data-category="food"]')!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-product"]')!.click();
  await el.updateComplete;
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>(
    'select[name="category-product"]',
  )!;
  select.value = "p";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
  const picker = el.shadowRoot!.querySelector("dashboard-category-membership-picker")!;
  await picker.updateComplete;
  picker.shadowRoot!.querySelector<HTMLElement>('[data-test="save-membership"]')!.click();
  await vi.waitFor(() =>
    expect(fx.api.replaceProductCategories).toHaveBeenCalledWith("p", {
      categoryIds: ["drink", "food"],
      primaryCategoryId: "drink",
    }),
  );
});

it("does not search disabled translations that are absent from the displayed category name", async () => {
  const fx = apiFixture();
  fx.api.getContentLanguages.mockResolvedValue({ defaultLanguage: "en", languages: ["en"] });
  fx.api.listCategories.mockResolvedValue([{ ...food, name: { en: "Food", es: "Comida" } }]);
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(1),
  );
  el.shadowRoot!.querySelector('[name="category-search"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Comida" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-data-table")!.rows).toEqual([]);
});

it.each([
  ["category.parent_cycle", "parent", "select[name=category-parent]"],
  ["category.image_not_found", "image", "dashboard-image-upload"],
])(
  "explains %s beside the rejected field and in the form summary",
  async (code, field, selector) => {
    const { el, api } = await mount();
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="create-category"]')!.click();
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-category-form")!;
    api.createCategory.mockRejectedValueOnce({ code });
    form.dispatchEvent(
      new CustomEvent("wt-submit", {
        detail: { value: { name: { en: "New" }, parentId: "food", image: "photo.jpg" } },
        bubbles: true,
        composed: true,
      }),
    );
    await vi.waitFor(() => expect(form.fieldErrors[field]).toBeTruthy());
    await form.updateComplete;
    const input = form.shadowRoot!.querySelector(selector)!;
    const errorId = input.getAttribute("aria-describedby")!;
    expect(form.shadowRoot!.getElementById(errorId)!.textContent).toBe(form.fieldErrors[field]);
    expect(form.shadowRoot!.querySelector("wt-form-error-summary")!.errors).toContain(
      form.fieldErrors[field],
    );
    expect(form.open).toBe(true);
  },
);

it("opens the directly assigned products from an image-usage category link", async () => {
  const previous = location.href;
  const linked = new URL(previous);
  linked.searchParams.set("category", "food");
  history.replaceState(null, "", linked);
  try {
    const { el } = await mount();
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
          '[data-test="category-products"]',
        )?.rows,
      ).toEqual([product]),
    );
  } finally {
    history.replaceState(null, "", previous);
  }
});
