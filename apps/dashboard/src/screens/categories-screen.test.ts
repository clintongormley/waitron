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

// A rejected delete leaves the confirmation open with the reason on it, so the manager can retry
// or cancel rather than losing the dialog and wondering whether the delete happened.
it("keeps the confirmation open and explains a rejected delete, then closes on success", async () => {
  const { el, api } = await mount();
  api.deleteCategory.mockRejectedValueOnce(new Error("network"));
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  const actions = table.shadowRoot!.querySelector("wt-row-actions")!;
  actions.querySelectorAll("wt-button")[1]!.click();
  await el.updateComplete;
  const modal = [...el.shadowRoot!.querySelectorAll("wt-modal")].find((modal) => modal.open)!;
  const deleteButton = modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
    'wt-button[variant="danger"]',
  )!;
  await vi.waitFor(() => expect(deleteButton.disabled).toBe(false));
  deleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => expect(modal.querySelector('p[role="alert"]')).not.toBeNull());
  expect(modal.querySelector('p[role="alert"]')!.textContent!.trim()).not.toBe("");
  expect(modal.open).toBe(true);
  // Retrying the same delete succeeds, and the dialog closes itself.
  deleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => expect(modal.open).toBe(false));
  expect(api.deleteCategory).toHaveBeenCalledWith("food");
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
  // cell falls back to the muted dash rather than an empty lozenge list. This cell is handed to
  // wt-data-table as a callback like the name cell, so it lands in the TABLE's shadow root: read
  // the painted colour back, because presence alone passed while the dash rendered unmuted.
  const dash = products.shadowRoot!.querySelector<HTMLElement>('[part~="muted"]');
  expect(dash).not.toBeNull();
  expect(dash!.textContent!.trim()).toBe("—");
  const mutedToken = getComputedStyle(el).getPropertyValue("--wt-color-text-muted").trim();
  expect(getComputedStyle(dash!).color).toBe(hexToRgb(mutedToken));
  // A control in the other direction: a cell that is NOT muted paints the ordinary text colour, so
  // the assertion above is reading the muting and not simply the inherited default.
  const plain = products.shadowRoot!.querySelector<HTMLElement>("td")!;
  expect(getComputedStyle(plain).color).not.toBe(hexToRgb(mutedToken));
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

// Since the delete cascades rather than being refused, this preview is the ONLY warning a manager
// gets about what an irreversible delete will do. A failed fetch must therefore never look like
// "nothing depends on this": it says so, and Delete stays unavailable.
it("says the delete preview failed and keeps Delete disabled", async () => {
  const fx = apiFixture();
  fx.api.getCategoryDependants.mockRejectedValue(new Error("offline"));
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
  await vi.waitFor(() =>
    expect(modal.querySelector('[data-test="dependants-error"]')).not.toBeNull(),
  );
  const warning = modal.querySelector('[data-test="dependants-error"]')!;
  expect(warning.textContent).toContain(t("categories.delete_preview_error"));
  expect(warning.getAttribute("role")).toBe("alert");
  // It has to LOOK like a warning, not just be one. This node is a child of wt-modal in the
  // screen's own shadow root, so the screen's .error rule does reach it — unlike the cell markup
  // this branch had to move onto ::part(). Read the colour rather than assume either way.
  const dangerToken = getComputedStyle(el).getPropertyValue("--wt-color-danger").trim();
  expect(getComputedStyle(warning).color).toBe(hexToRgb(dangerToken));
  // Not still pretending to load, and not offering the delete either.
  expect(modal.querySelector("wt-spinner")).toBeNull();
  const deleteButton = modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
    'wt-button[variant="danger"]',
  )!;
  expect(deleteButton.disabled).toBe(true);
});

// A failure on one category must not poison the next one the manager opens.
it("clears a failed delete preview when the dialog is reopened", async () => {
  const fx = apiFixture();
  fx.api.getCategoryDependants.mockRejectedValueOnce(new Error("offline"));
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(2),
  );
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  const openDelete = (index: number) => {
    const actions = [...table.shadowRoot!.querySelectorAll("wt-row-actions")][index]!;
    actions.querySelectorAll("wt-button")[1]!.click();
  };
  openDelete(0);
  await el.updateComplete;
  const modal = [...el.shadowRoot!.querySelectorAll("wt-modal")].find((modal) => modal.open)!;
  await vi.waitFor(() =>
    expect(modal.querySelector('[data-test="dependants-error"]')).not.toBeNull(),
  );
  modal.querySelector<HTMLElementTagNameMap["wt-button"]>('wt-button[slot="cancel"]')!.click();
  await el.updateComplete;
  openDelete(1);
  await el.updateComplete;
  const deleteButton = modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
    'wt-button[variant="danger"]',
  )!;
  // `updateComplete` inside the retry: the second fetch resolves on its own microtask, so the
  // assertion has to wait for the state change AND for lit to paint it.
  await vi.waitFor(async () => {
    await el.updateComplete;
    expect(deleteButton.disabled).toBe(false);
  });
  expect(modal.querySelector('[data-test="dependants-error"]')).toBeNull();
});

// Reopening the SAME category's delete dialog while its first preview fetch is still in flight
// must not let that stale fetch's outcome apply once it finally settles — comparing the category
// id alone cannot tell a superseded request from the current one, since both share the same id.
it("ignores a stale preview response from the same category's earlier open", async () => {
  const fx = apiFixture();
  let resolveFirst!: (value: CategoryDependants) => void;
  let rejectSecond!: (error: Error) => void;
  fx.api.getCategoryDependants
    .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
    .mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectSecond = reject)));
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(2),
  );
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  const openDelete = () => {
    const actions = table.shadowRoot!.querySelectorAll("wt-row-actions")[0]!;
    actions.querySelectorAll("wt-button")[1]!.click();
  };
  openDelete(); // first open of "food" — its fetch never resolves yet
  await el.updateComplete;
  const modal = [...el.shadowRoot!.querySelectorAll("wt-modal")].find((modal) => modal.open)!;
  modal.querySelector<HTMLElementTagNameMap["wt-button"]>('wt-button[slot="cancel"]')!.click();
  // The cancel click closes the dialog directly, which also flips wt-modal's `.open` property,
  // triggering the native <dialog>'s own "close" event, which bubbles back as `wt-close` and calls
  // the same close handler again — a second, cascaded update whose native event can land on a
  // later task than `updateComplete` flushes. Give it a real macrotask to land before reopening,
  // or the second open below can race a still-in-flight close and have it wipe the new state.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  openDelete(); // reopen the SAME category — a fresh fetch starts
  await el.updateComplete;
  rejectSecond(new Error("offline")); // the fresh (current) request fails
  await vi.waitFor(async () => {
    await el.updateComplete;
    expect(modal.querySelector('[data-test="dependants-error"]')).not.toBeNull();
  });
  resolveFirst({ products: [], children: [], parentId: null, routes: [] }); // the stale one lands late
  // The stale success races the error paint on its own microtask; give it a real macrotask so a
  // wrongly-applied resolution has landed before asserting it was ignored, not just "not yet seen".
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  // The stale success must not clear the warning or enable Delete.
  expect(modal.querySelector('[data-test="dependants-error"]')).not.toBeNull();
  const deleteButton = modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
    'wt-button[variant="danger"]',
  )!;
  expect(deleteButton.disabled).toBe(true);
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
  ["category.color_invalid", "color", "input[type=color]"],
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
  const add = el.shadowRoot!.querySelector('wt-button[shape="round"][data-test="create-category"]');
  expect(add).not.toBeNull();
  expect(add!.getAttribute("aria-label")).toBeTruthy();
  // A stale bare `round` attribute is inert since wt-button only reads `shape`, but the DOM would
  // still carry it harmlessly, so assert actual rendering — the button's own inner element must be
  // circular, not the plain rectangular default.
  await (add as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  const inner = add!.shadowRoot!.querySelector("button")!;
  const rect = inner.getBoundingClientRect();
  expect(rect.width).toBeCloseTo(rect.height, 0);
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

// These two suites assert RENDERED style, not just markup. The name column's cell markup is handed
// to wt-data-table as a cell callback, so it lands in wt-data-table's shadow root rather than this
// screen's — and a stylesheet only styles nodes inside the shadow root that adopted it. Presence and
// attribute assertions pass either way, which is how a release where no swatch, no thumbnail box and
// no muting ever appeared in the browser still went green. Reading geometry and colour back is what
// distinguishes "the element is there" from "the element is visible".
it("renders each name with its colour square, sized and bordered from tokens", async () => {
  const fx = apiFixture();
  fx.api.listCategories.mockResolvedValue([{ ...food, color: "#b12525" }]);
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await vi.waitFor(() => expect(table.rows.length).toBe(1));
  await table.updateComplete;
  const swatch = table.shadowRoot!.querySelector<HTMLElement>('[part~="swatch"]')!;
  expect(swatch.getAttribute("style")).toContain("#b12525");

  // The colour is data, applied inline, so it survives even unstyled — the box around it does not.
  const styles = getComputedStyle(swatch);
  expect(styles.backgroundColor).toBe("rgb(177, 37, 37)");
  const space4 = getComputedStyle(el).getPropertyValue("--wt-space-4").trim();
  expect(styles.width).toBe(space4);
  expect(styles.height).toBe(space4);
  expect(styles.borderTopWidth).toBe("1px");
  const box = swatch.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);

  // The thumbnail placeholder shares the same cell and the same failure mode.
  const placeholder = table.shadowRoot!.querySelector<HTMLElement>(
    '[part~="thumbnail-placeholder"]',
  )!;
  const tapMin = getComputedStyle(el).getPropertyValue("--wt-tap-min").trim();
  expect(getComputedStyle(placeholder).width).toBe(tapMin);
  expect(placeholder.getBoundingClientRect().height).toBeGreaterThan(0);
});

// The placeholder above and a real image are different elements under different rules, so the
// styling has to be proven separately for each. The src 404s here; only the box is under test.
// The stored colour is interpolated into an inline style attribute, so the screen checks it rather
// than trusting it — the same guard wt-lozenge applies. An unusable value draws the empty swatch.
it("draws the empty swatch for a colour that is not #rrggbb", async () => {
  const fx = apiFixture();
  fx.api.listCategories.mockResolvedValue([{ ...food, color: "red; background-image: url(x)" }]);
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await vi.waitFor(() => expect(table.rows.length).toBe(1));
  await table.updateComplete;
  const swatch = table.shadowRoot!.querySelector<HTMLElement>('[part~="swatch"]')!;
  expect(swatch.getAttribute("part")).toContain("swatch-none");
  expect(swatch.getAttribute("style")).toBeNull();
  expect(getComputedStyle(swatch).backgroundImage).toBe("none");
});

it("sizes a category's thumbnail image from tokens", async () => {
  const fx = apiFixture();
  fx.api.listCategories.mockResolvedValue([{ ...food, image: "cheese.png" }]);
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await vi.waitFor(() => expect(table.rows.length).toBe(1));
  await table.updateComplete;
  const thumbnail = table.shadowRoot!.querySelector<HTMLElement>('[part~="thumbnail"]')!;
  expect(thumbnail.tagName).toBe("IMG");
  const tapMin = getComputedStyle(el).getPropertyValue("--wt-tap-min").trim();
  expect(getComputedStyle(thumbnail).width).toBe(tapMin);
  expect(getComputedStyle(thumbnail).height).toBe(tapMin);
  expect(getComputedStyle(thumbnail).objectFit).toBe("cover");
});

it("paints a tree-mode ancestor row's name in the muted colour", async () => {
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
  el.shadowRoot!.querySelector('[name="category-search"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "breakfast" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  await table.updateComplete;

  // The colour lands on the <button> inside wt-button's OWN shadow root, one boundary further in
  // than the cell markup — so read it there rather than off the host.
  const painted = async (id: string) => {
    const host = table.shadowRoot!.querySelector<
      HTMLElement & { updateComplete: Promise<unknown> }
    >(`[data-category="${id}"]`)!;
    await host.updateComplete;
    return getComputedStyle(host.shadowRoot!.querySelector('[part="button"]')!).color;
  };
  const mutedToken = getComputedStyle(el).getPropertyValue("--wt-color-text-muted").trim();
  const ancestor = await painted("food");
  const match = await painted("breakfast");
  expect(ancestor).not.toBe(match);
  expect(ancestor).toBe(hexToRgb(mutedToken));
});

/** `getComputedStyle().color` always reports `rgb(...)`; the tokens are authored as hex. */
function hexToRgb(hex: string): string {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

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
