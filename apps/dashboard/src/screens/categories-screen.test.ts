import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { CategoriesScreen } from "./categories-screen.js";
import type { CategoryDependants, DashboardApi, CategorySummary, Product } from "../api/client.js";
import { t } from "../i18n/t.js";
afterEach(cleanupWidgets);
// The tree/flat toggle persists to localStorage; a leftover value from an earlier test would make
// the "defaults to tree mode" assumption order-dependent.
beforeEach(() => {
  localStorage.clear();
});
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
    getCategoryDependants: vi
      .fn()
      .mockResolvedValue({ products: [], children: [], parentId: null, routes: [] }),
    addProductsToCategory: vi.fn().mockResolvedValue(undefined),
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
it("counts direct memberships and opens category products", async () => {
  const { el } = await mount();
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>('[data-category="food"]')!.click();
  await el.updateComplete;
  const products = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-products"]',
  )!;
  await products.updateComplete;
  expect(products.rows.map((row) => (row as { id: string }).id)).toEqual(["p"]);
});
// Removing a membership that was the reporting category clears it (see #assign); the picker now
// accepts that as a valid, final choice instead of demanding a replacement before submission.
it("saves a membership with no reporting category after removing the primary", async () => {
  const { el, api } = await mount();
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>('[data-category="food"]')!.click();
  await el.updateComplete;
  const products = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-products"]',
  )!;
  await products.updateComplete;
  products.shadowRoot!.querySelector<HTMLElement>('[data-test="remove-membership"]')!.click();
  await el.updateComplete;
  const picker = el.shadowRoot!.querySelector("dashboard-category-membership-picker")!;
  await picker.updateComplete;
  picker.shadowRoot!.querySelector<HTMLElement>('[data-test="save-membership"]')!.click();
  await vi.waitFor(() =>
    expect(api.replaceProductCategories).toHaveBeenCalledWith("p", {
      categoryIds: ["drink"],
      primaryCategoryId: null,
    }),
  );
});
it("still lets you choose a replacement reporting category before saving", async () => {
  const { el, api } = await mount();
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>('[data-category="food"]')!.click();
  await el.updateComplete;
  const products = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-products"]',
  )!;
  await products.updateComplete;
  products.shadowRoot!.querySelector<HTMLElement>('[data-test="remove-membership"]')!.click();
  await el.updateComplete;
  const picker = el.shadowRoot!.querySelector("dashboard-category-membership-picker")!;
  await picker.updateComplete;
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

it("opens the products modal from the name and lists members with lozenges", async () => {
  const fx = apiFixture();
  const lone: Product = {
    ...product,
    id: "r",
    descriptions: { en: "Napkin" },
    categoryIds: ["food"],
    primaryCategoryId: "food",
  };
  fx.api.listCategories.mockResolvedValue([food, { ...drink, color: "#2244aa" }]);
  fx.api.listLibraryProducts.mockResolvedValue([product, lone]);
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
  const modal = [...el.shadowRoot!.querySelectorAll("wt-modal")].find((modal) => modal.open)!;
  expect(modal.open).toBe(true);
  const products = modal.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-products"]',
  )!;
  await products.updateComplete;
  expect(products.rows.map((row) => (row as { id: string }).id).sort()).toEqual(["p", "r"]);
  const lozenges = [...products.shadowRoot!.querySelectorAll("wt-lozenge")];
  expect(lozenges.some((lozenge) => lozenge.textContent?.trim() === "Drinks")).toBe(true);
  // "Napkin" has no membership beyond the reporting category "Food", so its Other categories
  // cell falls back to the muted dash rather than an empty lozenge list.
  expect(products.shadowRoot!.querySelector(".muted")).not.toBeNull();
});

it("adds products via the checkbox table in one call", async () => {
  const fx = apiFixture();
  const q: Product = { ...product, id: "q", descriptions: { en: "Juice" }, categoryIds: [] };
  const r: Product = { ...product, id: "r", descriptions: { en: "Napkin" }, categoryIds: [] };
  fx.api.listLibraryProducts.mockResolvedValue([q, r]);
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
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-products"]')!.click();
  await el.updateComplete;
  const addTable = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-add-products"]',
  )!;
  await addTable.updateComplete;
  const pickQ = addTable.shadowRoot!.querySelector<HTMLInputElement>('[data-test="pick-q"]')!;
  pickQ.checked = true;
  pickQ.dispatchEvent(new Event("change", { bubbles: true }));
  const pickR = addTable.shadowRoot!.querySelector<HTMLInputElement>('[data-test="pick-r"]')!;
  pickR.checked = true;
  pickR.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
  const addButton = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="add-selected"]',
  )!;
  expect(addButton.textContent?.trim()).toBe(t("categories.add_selected").replace("{count}", "2"));
  addButton.click();
  await vi.waitFor(() =>
    expect(fx.api.addProductsToCategory).toHaveBeenCalledWith(
      "food",
      expect.arrayContaining(["q", "r"]),
    ),
  );
  expect(fx.api.addProductsToCategory).toHaveBeenCalledTimes(1);
  expect((fx.api.addProductsToCategory.mock.calls[0]![1] as string[]).length).toBe(2);
});

it("shows the delete preview with product, child and route links, disabling Delete until it resolves", async () => {
  const fx = apiFixture();
  let resolveDependants!: (value: CategoryDependants) => void;
  fx.api.getCategoryDependants.mockReturnValue(
    new Promise<CategoryDependants>((resolve) => {
      resolveDependants = resolve;
    }),
  );
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(2),
  );
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  const actions = table.shadowRoot!.querySelector("wt-row-actions")!;
  actions.querySelectorAll("wt-button")[1]!.click();
  await el.updateComplete;
  const modal = [...el.shadowRoot!.querySelectorAll("wt-modal")].find((modal) => modal.open)!;
  const deleteButton = modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
    'wt-button[variant="danger"]',
  )!;
  expect(deleteButton.disabled).toBe(true);
  resolveDependants({
    products: [{ id: "p", name: { en: "Toast" }, reporting: true }],
    children: [{ id: "breakfast", name: { en: "Breakfast" } }],
    parentId: null,
    routes: [{ id: "r1", station: "Grill", zone: "Bar" }],
  });
  await vi.waitFor(() => expect(deleteButton.disabled).toBe(false));
  const links = [...modal.querySelectorAll("a")];
  expect(links.some((link) => link.textContent?.includes("Toast"))).toBe(true);
  expect(links.some((link) => link.textContent?.includes("Breakfast"))).toBe(true);
  expect(links.some((link) => link.textContent?.includes("Grill"))).toBe(true);
});

it("a delete-modal product link points at the product editor", async () => {
  const fx = apiFixture();
  fx.api.getCategoryDependants.mockResolvedValue({
    products: [{ id: "p", name: { en: "Toast" }, reporting: false }],
    children: [],
    parentId: null,
    routes: [],
  });
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(2),
  );
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  const actions = table.shadowRoot!.querySelector("wt-row-actions")!;
  actions.querySelectorAll("wt-button")[1]!.click();
  await el.updateComplete;
  const modal = [...el.shadowRoot!.querySelectorAll("wt-modal")].find((modal) => modal.open)!;
  await vi.waitFor(() => expect(modal.querySelector("a")).not.toBeNull());
  // The app has no client-side navigate() for this — image-library.ts's identical "what uses
  // this" links (packages/media/src/dashboard/image-library.ts) are plain <a href> too, so a real
  // browser navigation is the established mechanism; the pretty-path shape comes from
  // apps/dashboard/src/navigation.ts's dashboardPath (children.catalogue.product = "product").
  expect(modal.querySelector("a")!.getAttribute("href")).toBe("/manage/catalogue/product/p");
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

it("shows a round create button by the heading", async () => {
  const { el } = await mount();
  const add = el.shadowRoot!.querySelector('wt-button[round][data-test="create-category"]');
  expect(add).not.toBeNull();
  expect(add!.getAttribute("aria-label")).toBeTruthy();
});

it("defaults to tree mode and nests children", async () => {
  const fx = apiFixture();
  const breakfast: CategorySummary = {
    id: "breakfast",
    name: { en: "Breakfast" },
    image: null,
    color: null,
    parentId: "food",
  };
  fx.api.listCategories.mockResolvedValue([food, breakfast]);
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await vi.waitFor(() => expect(table.rows.length).toBe(2));
  expect(table.rowParent).toBeDefined();
  await table.updateComplete;
  const rows = [...table.shadowRoot!.querySelectorAll("tr[data-row-key]")];
  const keys = rows.map((row) => row.getAttribute("data-row-key"));
  expect(keys.indexOf("food")).toBeLessThan(keys.indexOf("breakfast"));
  const breakfastRow = table.shadowRoot!.querySelector('tr[data-row-key="breakfast"]')!;
  expect(breakfastRow.getAttribute("aria-level")).toBe("2");
});

it("switches to flat mode and shows a Parent column", async () => {
  const { el } = await mount();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="mode-flat"]')!.click();
  await el.updateComplete;
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  expect(table.rowParent).toBeUndefined();
  const headers = [...table.shadowRoot!.querySelectorAll("th")].map((th) => th.textContent?.trim());
  expect(headers.some((header) => header?.includes(t("categories.parent")))).toBe(true);
});

it("filters by name keeping ancestors in tree mode", async () => {
  const fx = apiFixture();
  const breakfast: CategorySummary = {
    id: "breakfast",
    name: { en: "Breakfast" },
    image: null,
    color: null,
    parentId: "food",
  };
  const eggs: CategorySummary = {
    id: "eggs",
    name: { en: "Eggs" },
    image: null,
    color: null,
    parentId: "breakfast",
  };
  fx.api.listCategories.mockResolvedValue([food, breakfast, eggs, drink]);
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await vi.waitFor(() => expect(table.rows.length).toBe(4));
  el.shadowRoot!.querySelector('[name="category-search"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "egg" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  const ids = table.rows.map((row) => (row as CategorySummary).id).sort();
  expect(ids).toEqual(["breakfast", "eggs", "food"]);
  // Food and Breakfast are kept only to show Eggs's ancestor path, not because they matched "egg"
  // themselves — they should render muted while the actual match does not.
  await table.updateComplete;
  const muted = (id: string) =>
    table.shadowRoot!.querySelector(`[data-category="${id}"]`)!.hasAttribute("data-muted");
  expect(muted("food")).toBe(true);
  expect(muted("breakfast")).toBe(true);
  expect(muted("eggs")).toBe(false);
});

it("renders each name with its colour square", async () => {
  const fx = apiFixture();
  fx.api.listCategories.mockResolvedValue([{ ...food, color: "#b12525" }]);
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await vi.waitFor(() => expect(table.rows.length).toBe(1));
  await table.updateComplete;
  const swatch = table.shadowRoot!.querySelector<HTMLElement>(".swatch")!;
  expect(swatch.getAttribute("style")).toContain("#b12525");
});

it("opens the category editor from a ?category= deep link", async () => {
  const previous = location.href;
  const linked = new URL(previous);
  linked.searchParams.set("category", "food");
  history.replaceState(null, "", linked);
  try {
    const { el } = await mount();
    await vi.waitFor(() =>
      expect((el as unknown as { editorOpen: boolean }).editorOpen).toBe(true),
    );
    expect((el as unknown as { edited: CategorySummary | null }).edited?.id).toBe("food");
    expect(new URL(location.href).searchParams.get("category")).toBeNull();
  } finally {
    history.replaceState(null, "", previous);
  }
});

it("ignores a ?category= deep link for an unknown id", async () => {
  const previous = location.href;
  const linked = new URL(previous);
  linked.searchParams.set("category", "nope");
  history.replaceState(null, "", linked);
  try {
    const { el } = await mount();
    expect((el as unknown as { editorOpen: boolean }).editorOpen).toBe(false);
  } finally {
    history.replaceState(null, "", previous);
  }
});
