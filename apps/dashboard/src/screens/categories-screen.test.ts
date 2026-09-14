import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { CategoriesScreen } from "./categories-screen.js";
import type { CategoryDependants, DashboardApi, CategorySummary, Product } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
afterEach(cleanupWidgets);
// Some tests pin the reader locale (en-GB) so a translated string can be asserted against its exact
// English wording; restore the file's default (es-ES) afterwards so later tests are unaffected.
afterEach(() => setLocale("es-ES"));
// The tree/flat toggle persists to localStorage and each table's sort and filters to sessionStorage;
// a leftover value from an earlier test would make the default-view assertions order-dependent.
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
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
// The search box belongs to the table's toolbar, so it is typed into inside wt-data-table's shadow root.
async function typeTableSearch(el: CategoriesScreen, value: string): Promise<void> {
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  const search = table.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
  search.value = value;
  search.dispatchEvent(new Event("input"));
  await el.updateComplete;
  await table.updateComplete;
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
  const primary = picker.shadowRoot!.querySelector<HTMLElement>(
    'wt-combobox[data-test="reporting-category"]',
  )!;
  Object.assign(primary, { value: "drink" });
  primary.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "drink" },
      bubbles: true,
      composed: true,
    }),
  );
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
  await typeTableSearch(el, "Comida");
  // The table keeps every row in `.rows` and narrows what it renders, so count the rendered rows.
  expect(
    el.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!.querySelectorAll("tr[data-row-key]")
      .length,
  ).toBe(1);
});

// A rejected delete leaves the confirmation open with the reason on it, so the manager can retry
// or cancel rather than losing the dialog and wondering whether the delete happened.
it("keeps the confirmation open and explains a rejected delete, then closes on success", async () => {
  const { el, api } = await mount();
  api.deleteCategory.mockRejectedValueOnce(new Error("network"));
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  // The table sorts by name, so Food is targeted by its key rather than by position.
  const actions = table.shadowRoot!.querySelector('tr[data-row-key="food"] wt-row-actions')!;
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

// The add-products list picks rows with the table's own per-row checkboxes, inside the table's
// shadow root. Selecting two rows and pressing Add sends both ids in one call.
it("adds products via the table's own per-row selection in one call", async () => {
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
  addTable.shadowRoot!.querySelector<HTMLInputElement>('[data-test="select-q"]')!.click();
  await el.updateComplete;
  await addTable.updateComplete;
  addTable.shadowRoot!.querySelector<HTMLInputElement>('[data-test="select-r"]')!.click();
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

// The add table's select-all header box selects every visible (searched/filtered) row, and Add
// then sends the whole picked set — proving the dialog uses the primitive's own select-all rather
// than a screen-side "select all visible" checkbox.
it("adds products using the table's own select-all", async () => {
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
  addTable.shadowRoot!.querySelector<HTMLInputElement>('[data-test="select-all"]')!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-selected"]')!.click();
  await vi.waitFor(() =>
    expect(fx.api.addProductsToCategory).toHaveBeenCalledWith(
      "food",
      expect.arrayContaining(["q", "r"]),
    ),
  );
});

// The member view's footer Close button dismisses the products dialog.
it("closes the products dialog from a footer Close button", async () => {
  const { el } = await mount();
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>('[data-category="food"]')!.click();
  await el.updateComplete;
  const modal = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    'wt-modal[data-test="products-modal"]',
  )!;
  expect(modal.open).toBe(true);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="close-products"]')!.click();
  await el.updateComplete;
  expect(modal.open).toBe(false);
});

// The delete confirmation names the category in its heading, lists the affected products in the
// shared product table (not as links), flags the ones that lose their reporting category, and does
// not list printing routes, although the delete still removes them. The table's rows are cell
// markup in the table's OWN shadow root, so row text is read from `table.shadowRoot`, not the
// dialog, which does not cross into a nested custom element's shadow.
it("titles the delete dialog with the category name, shows affected products, and lists no routes", async () => {
  setLocale("en-GB");
  const { el, api } = await mount();
  api.getCategoryDependants.mockResolvedValue({
    products: [{ id: "p", name: { en: "Toast" }, reporting: true }],
    children: [],
    parentId: null,
    routes: [{ id: "r", station: "Pass", zone: null }],
  });
  // Open the delete dialog for "Food" via its row action, the same path #openDelete uses.
  const list = el.shadowRoot!.querySelector("wt-data-table")!;
  await list.updateComplete;
  list
    .shadowRoot!.querySelector('tr[data-row-key="food"] wt-row-actions')!
    .querySelectorAll("wt-button")[1]!
    .click();
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector('[data-test="delete-dialog"]')!;
  expect(dialog.getAttribute("heading")).toContain("Food");
  await vi.waitFor(() =>
    expect(
      dialog.querySelector('wt-data-table[data-test="category-delete-products"]'),
    ).not.toBeNull(),
  );
  expect(dialog.textContent).not.toContain("route");
  const table = dialog.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-delete-products"]',
  )!;
  await table.updateComplete;
  // The dependant resolves to a full product row inside the table's shadow root, and, since its
  // reporting category is the one being deleted, the cleared-reporting flag shows.
  expect(table.shadowRoot!.textContent).toContain("Toast");
  expect(table.shadowRoot!.textContent).toContain(t("categories.delete_reporting"));
});

it("shows the delete preview with the affected products and child links, disabling Delete until it resolves and listing no routes", async () => {
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
  expect(links.some((link) => link.textContent?.includes("Breakfast"))).toBe(true);
  // The preview does not list printing routes, even when the category has some.
  expect(links.some((link) => link.textContent?.includes("Grill"))).toBe(false);
  expect(modal.textContent).not.toContain("route");
  // The affected product shows inside the shared table's shadow root, not as a link.
  const products = modal.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-delete-products"]',
  )!;
  await products.updateComplete;
  expect(products.shadowRoot!.textContent).toContain("Toast");
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

// Two in-flight preview fetches for the SAME category — from clicking delete on the same row
// twice in a row — must not let the older one's outcome apply once it finally settles: comparing
// the category id alone cannot tell a superseded request from the current one, since both share
// the same id. (Reproducing this via a real close-then-reopen click sequence instead is flaky:
// wt-modal's `.open` change cascades into a native <dialog>-driven `wt-close` event that can land
// on a later task than any fixed wait accounts for. Opening the same row twice needs no close at
// all — `#openDelete` has no guard against being called while already open — so the only thing
// under test is the generation guard itself, not modal-closing timing.)
it("ignores a stale preview response from an earlier open of the same category", async () => {
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
  openDelete(); // first open of the first row — its fetch never resolves yet
  await el.updateComplete;
  openDelete(); // open the SAME category again, without closing — a second, fresh fetch starts
  await el.updateComplete;
  const modal = [...el.shadowRoot!.querySelectorAll("wt-modal")].find((modal) => modal.open)!;
  rejectSecond(new Error("offline")); // the fresh (current) request fails
  await vi.waitFor(() =>
    expect(modal.querySelector('[data-test="dependants-error"]')).not.toBeNull(),
  );
  resolveFirst({ products: [], children: [], parentId: null, routes: [] }); // the stale one lands late
  // A resolved promise's continuation, and the Lit update it triggers, are both microtask work —
  // unlike the flaky close/reopen version of this test, nothing here crosses a native-event
  // macrotask boundary, so `updateComplete` genuinely settles the outcome rather than merely
  // proving it hadn't landed YET. Await it twice: once for the fetch's own `.then`, once for the
  // state change it makes to actually paint.
  await el.updateComplete;
  await el.updateComplete;
  // The stale success must not clear the warning or enable Delete.
  expect(modal.querySelector('[data-test="dependants-error"]')).not.toBeNull();
  const deleteButton = modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
    'wt-button[variant="danger"]',
  )!;
  expect(deleteButton.disabled).toBe(true);
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
  await typeTableSearch(el, "Comida");
  // "Comida" is a disabled translation, so the displayed name never exposes it and nothing matches.
  expect(
    el.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!.querySelectorAll("tr[data-row-key]")
      .length,
  ).toBe(0);
});

it.each([
  ["category.parent_cycle", "parent", "wt-combobox[name=category-parent]"],
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
    const control = form.shadowRoot!.querySelector(selector)!;
    // The parent field is a wt-combobox, which renders its own error inside its shadow root; the
    // other two keep their describedby error span in the form's shadow root.
    if (control.tagName.toLowerCase() === "wt-combobox") {
      const combo = control as HTMLElementTagNameMap["wt-combobox"];
      await combo.updateComplete;
      const errorId = combo
        .shadowRoot!.querySelector(".trigger")!
        .getAttribute("aria-describedby")!;
      expect(combo.shadowRoot!.getElementById(errorId)!.textContent).toBe(form.fieldErrors[field]);
    } else {
      const errorId = control.getAttribute("aria-describedby")!;
      expect(form.shadowRoot!.getElementById(errorId)!.textContent).toBe(form.fieldErrors[field]);
    }
    expect(form.shadowRoot!.querySelector("wt-form-error-summary")!.errors).toContain(
      form.fieldErrors[field],
    );
    expect(form.open).toBe(true);
  },
);

it("shows an Add category button and two labelled view-mode buttons in the header", async () => {
  setLocale("en-GB");
  const { el } = await mount();
  const add = el.shadowRoot!.querySelector('[data-test="create-category"]')!;
  expect(add.textContent!.trim()).toBe("Add category");
  expect(el.shadowRoot!.querySelector('[data-test="mode-tree"]')!.textContent).toContain(
    "Tree view",
  );
  expect(el.shadowRoot!.querySelector('[data-test="mode-flat"]')!.textContent).toContain(
    "Flat view",
  );
});

it("opens the editor from the labelled create button by the heading", async () => {
  const { el } = await mount();
  const add = el.shadowRoot!.querySelector<HTMLElement>('[data-test="create-category"]')!;
  // The create control is a labelled text button, not an icon-only round one.
  expect(add.getAttribute("shape")).not.toBe("round");
  expect(add.textContent).toContain(t("categories.add"));
  add.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("dashboard-category-form")!.open).toBe(true);
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

it("filters by parent in flat mode and hides the filter in tree mode", async () => {
  const { el } = await mount();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="mode-flat"]')!.click();
  await el.updateComplete;
  expect(
    el
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector('select[data-filter="parent"]'),
  ).not.toBeNull();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="mode-tree"]')!.click();
  await el.updateComplete;
  expect(
    el
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector('select[data-filter="parent"]'),
  ).toBeNull();
});

it("defaults the categories table to sorting by name", async () => {
  const { el } = await mount();
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  expect(table.sortKey).toBe("name");
  expect(table.sortDirection).toBe("ascending");
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
  await typeTableSearch(el, "egg");
  // The table renders the match plus its kept ancestors; read the rendered keys, not `.rows`
  // (which still holds every category).
  const ids = [...table.shadowRoot!.querySelectorAll("tr[data-row-key]")]
    .map((row) => row.getAttribute("data-row-key"))
    .sort();
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
  await typeTableSearch(el, "breakfast");

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

/** The search box inside a nested `wt-data-table`, found fresh each time because a reopened dialog
 * may render a new table element. */
async function tableSearch(el: CategoriesScreen, test: string): Promise<HTMLInputElement> {
  await el.updateComplete;
  const table = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    `wt-data-table[data-test="${test}"]`,
  )!;
  await table.updateComplete;
  return table.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!;
}
async function typeInto(el: CategoriesScreen, test: string, value: string): Promise<void> {
  const input = await tableSearch(el, test);
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await tableSearch(el, test);
}
function renderedKeys(el: CategoriesScreen, test: string): string[] {
  const table = el.shadowRoot!.querySelector(`wt-data-table[data-test="${test}"]`)!;
  return [...table.shadowRoot!.querySelectorAll("tr[data-row-key]")].map((row) =>
    row.getAttribute("data-row-key")!,
  );
}
async function openProducts(el: CategoriesScreen, id: string): Promise<void> {
  const list = el.shadowRoot!.querySelector("wt-data-table")!;
  await list.updateComplete;
  list.shadowRoot!.querySelector<HTMLElement>(`[data-category="${id}"]`)!.click();
  await el.updateComplete;
}
/** Clicks a dialog's dismiss button and waits for the native dialog's own `close` to arrive as
 * `wt-close`: that event is queued as a separate task, so reopening before it lands would have the
 * late event close the reopened dialog. */
async function dismiss(el: CategoriesScreen, dialog: string, button: string): Promise<void> {
  const modal = el.shadowRoot!.querySelector(`wt-modal[data-test="${dialog}"]`)!;
  const closed = new Promise((resolve) =>
    modal.addEventListener("wt-close", resolve, { once: true }),
  );
  modal.querySelector<HTMLElement>(button)!.click();
  await closed;
  await el.updateComplete;
}
async function closeProducts(el: CategoriesScreen): Promise<void> {
  await dismiss(el, "products-modal", '[data-test="close-products"]');
}

it.each([
  ["a different category", "drink"],
  ["the same category", "food"],
])("starts the products dialog with an empty search when reopened for %s", async (_, next) => {
  const { el } = await mount();
  await openProducts(el, "food");
  await typeInto(el, "category-products", "does-not-match");
  expect(renderedKeys(el, "category-products")).toEqual([]);
  await closeProducts(el);
  await openProducts(el, next);
  expect((await tableSearch(el, "category-products")).value).toBe("");
  // Toast belongs to both Food and Drinks, so an unfiltered table shows it either way.
  expect(renderedKeys(el, "category-products")).toEqual(["p"]);
});

it("starts the add-products list with an empty search each time it opens", async () => {
  const fx = apiFixture();
  const juice: Product = { ...product, id: "q", descriptions: { en: "Juice" }, categoryIds: [] };
  fx.api.listLibraryProducts.mockResolvedValue([product, juice]);
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(2),
  );
  await openProducts(el, "food");
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-products"]')!.click();
  await typeInto(el, "category-add-products", "does-not-match");
  expect(renderedKeys(el, "category-add-products")).toEqual([]);
  // Cancel returns to the member list without closing the dialog.
  el.shadowRoot!.querySelector<HTMLElement>(
    'wt-modal[data-test="products-modal"] wt-button[slot="cancel"]',
  )!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-products"]')!.click();
  expect((await tableSearch(el, "category-add-products")).value).toBe("");
  expect(renderedKeys(el, "category-add-products")).toEqual(["q"]);
});

it("starts the delete preview's product list with an empty search each time it opens", async () => {
  const { el, api } = await mount();
  api.getCategoryDependants.mockResolvedValue({
    products: [{ id: "p", name: { en: "Toast" }, reporting: true }],
    children: [],
    parentId: null,
    routes: [],
  });
  const openDelete = async () => {
    const list = el.shadowRoot!.querySelector("wt-data-table")!;
    await list.updateComplete;
    list
      .shadowRoot!.querySelector('tr[data-row-key="food"] wt-row-actions')!
      .querySelectorAll("wt-button")[1]!
      .click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector('[data-test="category-delete-products"]')).not.toBeNull(),
    );
  };
  await openDelete();
  await typeInto(el, "category-delete-products", "does-not-match");
  expect(renderedKeys(el, "category-delete-products")).toEqual([]);
  await dismiss(el, "delete-dialog", 'wt-button[slot="cancel"]');
  await openDelete();
  expect((await tableSearch(el, "category-delete-products")).value).toBe("");
  expect(renderedKeys(el, "category-delete-products")).toEqual(["p"]);
});

it("keeps the products dialog's Close button disabled while a membership save is in flight", async () => {
  const { el, api } = await mount();
  let finish!: () => void;
  api.replaceProductCategories.mockReturnValue(
    new Promise((resolve) => {
      finish = () => resolve({ categoryIds: ["drink"], primaryCategoryId: null });
    }),
  );
  await openProducts(el, "food");
  const members = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-products"]',
  )!;
  await members.updateComplete;
  members.shadowRoot!.querySelector<HTMLElement>('[data-test="remove-membership"]')!.click();
  await el.updateComplete;
  const picker = el.shadowRoot!.querySelector("dashboard-category-membership-picker")!;
  await picker.updateComplete;
  picker.shadowRoot!.querySelector<HTMLElement>('[data-test="save-membership"]')!.click();
  await el.updateComplete;
  const close = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="close-products"]',
  )!;
  expect(close.disabled).toBe(true);
  expect(close.getAttribute("slot")).toBe("cancel");
  // A person's click lands on the inner native button, which a disabled wt-button disables.
  close.shadowRoot!.querySelector("button")!.click();
  await el.updateComplete;
  const modal = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    'wt-modal[data-test="products-modal"]',
  )!;
  expect(modal.open).toBe(true);
  finish();
  await vi.waitFor(() => expect(close.disabled).toBe(false));
});

it("words each filter's catch-all option as All …, like the other screens' filters", async () => {
  setLocale("en-GB");
  const { el } = await mount();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="mode-flat"]')!.click();
  await el.updateComplete;
  const list = el.shadowRoot!.querySelector("wt-data-table")!;
  await list.updateComplete;
  expect(
    list.shadowRoot!.querySelector('select[data-filter="parent"] option')!.textContent!.trim(),
  ).toBe("All parents");
  await openProducts(el, "food");
  const members = el.shadowRoot!.querySelector('wt-data-table[data-test="category-products"]')!;
  await (members as HTMLElementTagNameMap["wt-data-table"]).updateComplete;
  expect(
    members.shadowRoot!.querySelector('select[data-filter="primary"] option')!.textContent!.trim(),
  ).toBe("All reporting categories");
});

it("restores the categories table's sort after the screen is reopened, but not its search", async () => {
  const first = await mount();
  const table = first.el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>('button[data-sort="name"]')!.click();
  await table.updateComplete;
  expect(table.sortDirection).toBe("descending");
  await typeTableSearch(first.el, "Food");
  cleanupWidgets();

  const { el } = await mount();
  const reopened = el.shadowRoot!.querySelector("wt-data-table")!;
  await reopened.updateComplete;
  expect(reopened.sortKey).toBe("name");
  expect(reopened.sortDirection).toBe("descending");
  expect(reopened.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!.value).toBe("");
  expect(
    [...reopened.shadowRoot!.querySelectorAll("tr[data-row-key]")].map((row) =>
      row.getAttribute("data-row-key"),
    ),
  ).toEqual(["food", "drink"]);
});

it("keeps a picked product picked after a search hides it, and adds it with the rest", async () => {
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
  await openProducts(el, "food");
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-products"]')!.click();
  await tableSearch(el, "category-add-products");
  const addTable = () =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
      'wt-data-table[data-test="category-add-products"]',
    )!;
  addTable().shadowRoot!.querySelector<HTMLInputElement>('[data-test="select-q"]')!.click();
  await typeInto(el, "category-add-products", "Napkin");
  expect(renderedKeys(el, "category-add-products")).toEqual(["r"]);
  addTable().shadowRoot!.querySelector<HTMLInputElement>('[data-test="select-r"]')!.click();
  await el.updateComplete;
  const add = el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-selected"]')!;
  expect(add.textContent!.trim()).toBe(t("categories.add_selected").replace("{count}", "2"));
  add.click();
  await vi.waitFor(() => expect(fx.api.addProductsToCategory).toHaveBeenCalledTimes(1));
  expect([...(fx.api.addProductsToCategory.mock.calls[0]![1] as string[])].sort()).toEqual([
    "q",
    "r",
  ]);
});

it("labels each member row's edit action Edit product categories", async () => {
  setLocale("en-GB");
  const { el } = await mount();
  await openProducts(el, "food");
  const members = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-products"]',
  )!;
  await members.updateComplete;
  const actions = members.shadowRoot!.querySelector('tr[data-row-key="p"] wt-row-actions')!;
  expect(actions.querySelector("wt-button")!.textContent!.trim()).toBe("Edit product categories");
});

it("offers only categories something refers to in the Parent and Reporting category filters", async () => {
  const fx = apiFixture();
  const breakfast: CategorySummary = {
    id: "breakfast",
    name: { en: "Breakfast" },
    image: null,
    color: null,
    parentId: "food",
  };
  const eggs: CategorySummary = {
    ...breakfast,
    id: "eggs",
    name: { en: "Eggs" },
    parentId: "breakfast",
  };
  fx.api.listCategories.mockResolvedValue([food, breakfast, eggs, drink]);
  fx.api.listLibraryProducts.mockResolvedValue([
    { ...product, categoryIds: ["food", "eggs"], primaryCategoryId: "eggs" },
  ]);
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  const list = el.shadowRoot!.querySelector("wt-data-table")!;
  await vi.waitFor(() => expect(list.rows.length).toBe(4));
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="mode-flat"]')!.click();
  await el.updateComplete;
  const options = (table: Element, filter: string) =>
    [
      ...table.shadowRoot!.querySelectorAll<HTMLOptionElement>(
        `select[data-filter="${filter}"] option`,
      ),
    ]
      .slice(1)
      .map((option) => [option.value, option.textContent!.trim()]);
  await list.updateComplete;
  // Food and Breakfast are parents, labelled by path; Eggs and Drinks are nobody's parent.
  expect(options(list, "parent")).toEqual([
    ["food", "Food"],
    ["breakfast", "Food / Breakfast"],
  ]);
  await openProducts(el, "food");
  const members = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-products"]',
  )!;
  await members.updateComplete;
  // Only Eggs is some product's reporting category, labelled by its own name.
  expect(options(members, "primary")).toEqual([["eggs", "Eggs"]]);
});

const breakfastUnderFood: CategorySummary = {
  id: "breakfast",
  name: { en: "Breakfast" },
  image: null,
  color: null,
  parentId: "food",
};
const juiceUnderDrink: CategorySummary = {
  ...breakfastUnderFood,
  id: "juice",
  name: { en: "Juice" },
  parentId: "drink",
};
/** Mounts the screen over two parents with one child each, waiting for all four rows. */
async function mountNested() {
  const fx = apiFixture();
  fx.api.listCategories.mockResolvedValue([food, breakfastUnderFood, drink, juiceUnderDrink]);
  const mounted = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  const list = mounted.el.shadowRoot!.querySelector("wt-data-table")!;
  await vi.waitFor(() => expect(list.rows.length).toBe(4));
  return { ...fx, ...mounted, list };
}
async function chooseMode(el: CategoriesScreen, mode: "flat" | "tree"): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="mode-${mode}"]`)!.click();
  await el.updateComplete;
  await el.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
}
function parentFilter(el: CategoriesScreen): HTMLSelectElement {
  return el
    .shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector<HTMLSelectElement>('select[data-filter="parent"]')!;
}
function listedKeys(el: CategoriesScreen): string[] {
  return [
    ...el
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelectorAll("tr[data-row-key]"),
  ].map((row) => row.getAttribute("data-row-key")!);
}

it("keeps a Parent filter chosen in flat mode through tree mode and a reopened screen", async () => {
  const first = await mountNested();
  await chooseMode(first.el, "flat");
  parentFilter(first.el).value = "food";
  parentFilter(first.el).dispatchEvent(new Event("change"));
  await first.list.updateComplete;
  expect(listedKeys(first.el)).toEqual(["breakfast"]);
  await chooseMode(first.el, "tree");
  expect(listedKeys(first.el)).toHaveLength(4); // no Parent column, so the choice hides nothing
  cleanupWidgets();

  const { el, list } = await mountNested();
  await list.updateComplete;
  expect(list.rowParent).toBeDefined(); // reopened in tree mode, where there is no Parent column
  await chooseMode(el, "flat");
  expect(parentFilter(el).value).toBe("food");
  expect(listedKeys(el)).toEqual(["breakfast"]);
});

it("resets the Parent filter to All parents when the chosen parent stops being one", async () => {
  const { el, api, list } = await mountNested();
  await chooseMode(el, "flat");
  parentFilter(el).value = "food";
  parentFilter(el).dispatchEvent(new Event("change"));
  await list.updateComplete;
  expect(listedKeys(el)).toEqual(["breakfast"]);
  // Deleting Food's only child leaves Food a parent of nothing, so the filter no longer offers it.
  api.listCategories.mockResolvedValue([food, drink, juiceUnderDrink]);
  list
    .shadowRoot!.querySelector('tr[data-row-key="breakfast"] wt-row-actions')!
    .querySelectorAll("wt-button")[1]!
    .click();
  await el.updateComplete;
  const modal = [...el.shadowRoot!.querySelectorAll("wt-modal")].find((each) => each.open)!;
  const deleteButton = modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
    'wt-button[variant="danger"]',
  )!;
  await vi.waitFor(() => expect(deleteButton.disabled).toBe(false));
  deleteButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => expect(list.rows.length).toBe(3));
  await list.updateComplete;
  expect(parentFilter(el).value).toBe("");
  expect(listedKeys(el).sort()).toEqual(["drink", "food", "juice"]);
});
