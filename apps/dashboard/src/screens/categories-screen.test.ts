import { userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { CategoriesScreen } from "./categories-screen.js";
import type { CategoryDependants, DashboardApi, CategorySummary, Product } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
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
  modifiers: [],
  name: "Toast",
  customerName: { en: "Buttered toast" },
  unitId: "u1",
  unit: { id: "u1", name: { en: "Each" }, precision: 0, abbreviation: { en: "ea" } },
  description: null,
  kitchenName: null,
  dietaryDeclarations: [],
  labelIds: ["l-happy"],
  primaryCategoryId: "food",
  active: true,
  available: true,
  soldAlone: true,
  variants: [],
};
const happyHour = { id: "l-happy", name: "Happy hour drinks", productCount: 1 };
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
    listLabels: vi.fn().mockResolvedValue([happyHour]),
    setMainCategory: vi.fn().mockResolvedValue({ primaryCategoryId: null }),
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
it("counts the products whose main category it is, and opens them", async () => {
  const { el } = await mount();
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  const count = (id: string) =>
    table.shadowRoot!.querySelectorAll(`tr[data-row-key="${id}"] td`)[1]!.textContent!.trim();
  expect(count("food")).toBe("1");
  expect(count("drink")).toBe("0");
  table.shadowRoot!.querySelector<HTMLElement>('[data-category="food"]')!.click();
  await el.updateComplete;
  const products = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-products"]',
  )!;
  await products.updateComplete;
  expect(products.rows.map((row) => (row as { id: string }).id)).toEqual(["p"]);
});
// Taking a product out of a category leaves it Uncategorised; the dialog opens set to that, so the
// change is still confirmed with Save rather than written at once.
it("takes a product out of the category by saving no main category", async () => {
  const { el, api } = await mount();
  await openProducts(el, "food");
  const dialog = await openMainCategory(el, true);
  expect(mainCategoryCombobox(el).value).toBe("");
  dialog.querySelector<HTMLElement>('[data-test="save-main-category"]')!.click();
  await vi.waitFor(() => expect(api.setMainCategory).toHaveBeenCalledWith("p", null));
});
it("lets you choose another main category before saving", async () => {
  const { el, api } = await mount();
  await openProducts(el, "food");
  const dialog = await openMainCategory(el, true);
  mainCategoryCombobox(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "drink" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  dialog.querySelector<HTMLElement>('[data-test="save-main-category"]')!.click();
  await vi.waitFor(() => expect(api.setMainCategory).toHaveBeenCalledWith("p", "drink"));
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
  expect(api.deleteCategory).toHaveBeenCalledWith("food", { productsTo: null, childrenTo: null });
});

it("opens the products modal from the name and lists members with lozenges", async () => {
  const fx = apiFixture();
  const lone: Product = {
    ...product,
    id: "r",
    name: "Napkin",
    labelIds: [],
    primaryCategoryId: "food",
  };
  fx.api.listCategories.mockResolvedValue([{ ...food, color: "#2244aa" }, drink]);
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
  expect(lozenges.some((lozenge) => lozenge.textContent?.trim() === "Food")).toBe(true);
  // "Napkin" carries no labels, so its Labels cell falls back to the muted dash. The cell lands in the TABLE's shadow root, so read the painted colour back:
  // presence alone passes while the dash renders unmuted.
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
  const q: Product = { ...product, id: "q", name: "Juice", labelIds: [], primaryCategoryId: null };
  const r: Product = { ...product, id: "r", name: "Napkin", labelIds: [], primaryCategoryId: null };
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
  await el.updateComplete;
  // Adding SETS each product's main category, so it is confirmed first and nothing is written yet.
  expect(fx.api.addProductsToCategory).not.toHaveBeenCalled();
  await confirmMove(el);
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
// then sends the whole picked set.
it("adds products using the table's own select-all", async () => {
  const fx = apiFixture();
  const q: Product = { ...product, id: "q", name: "Juice", labelIds: [], primaryCategoryId: null };
  const r: Product = { ...product, id: "r", name: "Napkin", labelIds: [], primaryCategoryId: null };
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
  await confirmMove(el);
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
// shared product table (not as links), and does not list printing routes, although the delete still
// removes them. The table's rows are cell markup in the table's OWN shadow root, so row text is read
// from `table.shadowRoot`, not the dialog, which does not cross into a nested custom element's shadow.
it("titles the delete dialog with the category name, shows affected products, and lists no routes", async () => {
  setLocale("en-GB");
  const { el, api } = await mount();
  api.getCategoryDependants.mockResolvedValue({
    products: [{ id: "p", name: "Toast" }],
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
  // The dependant is listed by its staff name inside the table's shadow root, with no per-row
  // "will be cleared" flag: the warning is a single top block.
  expect(table.shadowRoot!.textContent).toContain("Toast");
  expect(table.shadowRoot!.textContent).not.toContain("will be cleared");
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
    products: [{ id: "p", name: "Toast" }],
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

// The delete popup carries ONE red warning at the top naming every consequence in a single paragraph;
// the affected-products table and the child links stay below it.
it("shows one red warning at the top combining every consequence, and drops the old per-message text", async () => {
  setLocale("en-GB");
  const fx = apiFixture();
  const meals: CategorySummary = {
    id: "meals",
    name: { en: "Meals" },
    image: null,
    color: null,
    parentId: null,
  };
  const foodUnderMeals: CategorySummary = { ...food, parentId: "meals" };
  fx.api.listCategories.mockResolvedValue([meals, foodUnderMeals, drink]);
  fx.api.getCategoryDependants.mockResolvedValue({
    products: [{ id: "p", name: "Toast" }],
    children: [{ id: "breakfast", name: { en: "Breakfast" } }],
    parentId: "meals",
    routes: [],
  });
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(3),
  );
  const list = el.shadowRoot!.querySelector("wt-data-table")!;
  await list.updateComplete;
  list
    .shadowRoot!.querySelector('tr[data-row-key="food"] wt-row-actions')!
    .querySelectorAll("wt-button")[1]!
    .click();
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector('[data-test="delete-dialog"]')!;
  await vi.waitFor(() =>
    expect(dialog.querySelector('[data-test="delete-warning"]')).not.toBeNull(),
  );
  // Exactly one warning paragraph, at the top, flagged as an alert, with the whole combined text.
  const warnings = dialog.querySelectorAll('[data-test="delete-warning"]');
  expect(warnings.length).toBe(1);
  const warning = warnings[0]!;
  expect(warning.getAttribute("role")).toBe("alert");
  expect(warning.textContent!.replace(/\s+/g, " ").trim()).toBe(
    "This cannot be undone. 1 product has it as its main category. It has 1 subcategory.",
  );
  // It has to LOOK like a warning: the paragraph lives in the screen's own shadow root, so the
  // screen's .error rule reaches it — read the painted colour rather than assume it.
  const dangerToken = getComputedStyle(el).getPropertyValue("--wt-color-danger").trim();
  expect(getComputedStyle(warning).color).toBe(hexToRgb(dangerToken));
  // The affected-products table and the child links both still render below the warning.
  expect(
    dialog.querySelector('wt-data-table[data-test="category-delete-products"]'),
  ).not.toBeNull();
  expect([...dialog.querySelectorAll("a")].some((a) => a.textContent?.includes("Breakfast"))).toBe(
    true,
  );
  // None of the old, scattered wording survives: the colon intro or the per-row cleared flag.
  expect(dialog.textContent).not.toContain("Deleting it will:");
  expect(dialog.textContent).not.toContain("will be cleared");
  const table = dialog.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-delete-products"]',
  )!;
  await table.updateComplete;
  expect(table.shadowRoot!.textContent).not.toContain("will be cleared");
});

// A leaf category nothing depends on gets no warning block at all, just the buttons (Delete still
// enables once the empty preview resolves).
it("shows no warning block when nothing depends on the category", async () => {
  const { el } = await mount();
  const list = el.shadowRoot!.querySelector("wt-data-table")!;
  await list.updateComplete;
  list
    .shadowRoot!.querySelector('tr[data-row-key="food"] wt-row-actions')!
    .querySelectorAll("wt-button")[1]!
    .click();
  await el.updateComplete;
  const modal = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    'wt-modal[data-test="delete-dialog"]',
  )!;
  const deleteButton = modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
    'wt-button[variant="danger"]',
  )!;
  await vi.waitFor(() => expect(deleteButton.disabled).toBe(false));
  expect(modal.querySelector('[data-test="delete-warning"]')).toBeNull();
  expect(modal.querySelector('wt-data-table[data-test="category-delete-products"]')).toBeNull();
  expect(modal.querySelector("wt-spinner")).toBeNull();
});

// A product's search haystack includes its labels, not only its name and main category.
it("finds a product by one of its labels", async () => {
  const fx = apiFixture();
  fx.api.listLibraryProducts.mockResolvedValue([product, { ...product, id: "q", labelIds: [] }]);
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(2),
  );
  await openProducts(el, "food");
  const members = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-products"]',
  )!;
  await members.updateComplete;
  expect(members.shadowRoot!.querySelector('tr[data-row-key="p"]')!.textContent).toContain(
    "Happy hour drinks",
  );
  await typeInto(el, "category-products", "Happy hour");
  expect(renderedKeys(el, "category-products")).toEqual(["p"]);
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
  // It has to LOOK like a warning. This node is in the screen's own shadow root, so the screen's
  // .error rule does reach it; read the colour rather than assume.
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

// Two in-flight preview fetches for the SAME category must not let the older one's outcome apply:
// the category id alone cannot tell them apart. The row is opened twice without closing, because a
// real close-then-reopen is flaky: wt-modal's close lands as a `wt-close` event on a later task than
// any fixed wait accounts for.
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
  // Both the fetch's continuation and the Lit update it triggers are microtask work, so
  // `updateComplete` settles the outcome. Await it twice: once for the `.then`, once for the paint.
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

// These two suites assert RENDERED style, not just markup. The name cell's markup is handed to
// wt-data-table as a callback, so it lands in the table's shadow root, where this screen's stylesheet
// does not reach; presence and attribute assertions pass either way.
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

// The stored colour is interpolated into an inline style, so the screen checks it rather than
// trusting it. An unusable value draws the empty swatch.
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

// The placeholder and a real image are different elements under different rules, so each is proven
// separately. The src 404s here; only the box is under test.
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
  ["a different category", "drink", "d"],
  ["the same category", "food", "p"],
])("starts the products dialog with an empty search when reopened for %s", async (_, next, key) => {
  const fx = apiFixture();
  fx.api.listLibraryProducts.mockResolvedValue([
    product,
    { ...product, id: "d", name: "Cola", categoryId: "drink", primaryCategoryId: "drink" },
  ]);
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(2),
  );
  await openProducts(el, "food");
  await typeInto(el, "category-products", "does-not-match");
  expect(renderedKeys(el, "category-products")).toEqual([]);
  await closeProducts(el);
  await openProducts(el, next);
  expect((await tableSearch(el, "category-products")).value).toBe("");
  expect(renderedKeys(el, "category-products")).toEqual([key]);
});

it("starts the add-products list with an empty search each time it opens", async () => {
  const fx = apiFixture();
  const juice: Product = {
    ...product,
    id: "q",
    name: "Juice",
    labelIds: [],
    primaryCategoryId: null,
  };
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
    products: [{ id: "p", name: "Toast" }],
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

it("keeps the products dialog's Close button disabled while a main-category save is in flight", async () => {
  const { el, api } = await mount();
  let finish!: () => void;
  api.setMainCategory.mockReturnValue(
    new Promise((resolve) => {
      finish = () => resolve({ primaryCategoryId: null });
    }),
  );
  await openProducts(el, "food");
  const dialog = await openMainCategory(el, true);
  dialog.querySelector<HTMLElement>('[data-test="save-main-category"]')!.click();
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
  ).toBe("All main categories");
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
  const q: Product = { ...product, id: "q", name: "Juice", labelIds: [], primaryCategoryId: null };
  const r: Product = { ...product, id: "r", name: "Napkin", labelIds: [], primaryCategoryId: null };
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
  await confirmMove(el);
  await vi.waitFor(() => expect(fx.api.addProductsToCategory).toHaveBeenCalledTimes(1));
  expect([...(fx.api.addProductsToCategory.mock.calls[0]![1] as string[])].sort()).toEqual([
    "q",
    "r",
  ]);
});

it("labels each member row's edit action Change main category", async () => {
  setLocale("en-GB");
  const { el } = await mount();
  await openProducts(el, "food");
  const members = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-products"]',
  )!;
  await members.updateComplete;
  const actions = members.shadowRoot!.querySelector('tr[data-row-key="p"] wt-row-actions')!;
  expect(actions.querySelector("wt-button")!.textContent!.trim()).toBe("Change main category");
});

it("offers only categories something refers to in the Parent and Main category filters", async () => {
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
    { ...product, categoryId: "eggs", primaryCategoryId: "eggs" },
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
  await openProducts(el, "eggs");
  const members = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-products"]',
  )!;
  await members.updateComplete;
  // Only Eggs is some product's main category, labelled by its path.
  expect(options(members, "primary")).toEqual([["eggs", "Food / Breakfast / Eggs"]]);
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

// The dashboard names a product by its STAFF name, never by the guest-facing translation. Every
// surface of this screen that names one is covered here in one pass: the members table cell, that
// table's search box, the row-actions menu label, the add-products checkbox label and the
// main-category dialog's opening line. The fixture's two names differ, so each of these fails if the
// customer-facing name is read instead.
it("names a product by its staff name on every surface of the products modal", async () => {
  const { el } = await mount();
  await openProducts(el, "food");
  const members = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-products"]',
  )!;
  await members.updateComplete;
  expect(members.shadowRoot!.textContent).toContain("Toast");
  expect(members.shadowRoot!.textContent).not.toContain("Buttered toast");
  expect(members.shadowRoot!.querySelector("wt-row-actions")!.getAttribute("label")).toBe(
    `${t("categories.actions")}: Toast`,
  );
  // The search box reads the same name the cell shows, so typing what is on screen finds the row…
  await typeInto(el, "category-products", "Toast");
  expect(renderedKeys(el, "category-products")).toEqual(["p"]);
  // …and the guest-facing name, which is not on screen, matches nothing.
  await typeInto(el, "category-products", "Buttered");
  expect(renderedKeys(el, "category-products")).toEqual([]);
});

it("names a product by its staff name in the add-products checkbox label", async () => {
  const fx = apiFixture();
  // Only in Food, so opening Drinks offers it in the add list rather than the member list.
  fx.api.listLibraryProducts.mockResolvedValue([{ ...product, primaryCategoryId: "food" }]);
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(2),
  );
  await openProducts(el, "drink");
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-products"]')!.click();
  await el.updateComplete;
  const addTable = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-add-products"]',
  )!;
  await addTable.updateComplete;
  expect(
    addTable.shadowRoot!.querySelector('[data-test="select-p"]')!.getAttribute("aria-label"),
  ).toBe(`${t("categories.add_products")}: Toast`);
});

it("names the product by its staff name in the main-category dialog", async () => {
  const { el } = await mount();
  await openProducts(el, "food");
  const dialog = await openMainCategory(el, false);
  expect(dialog.querySelector("p")!.textContent!.trim()).toBe("Toast");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function rowAction(el: CategoriesScreen, id: string, index: number): Promise<void> {
  const list = el.shadowRoot!.querySelector("wt-data-table")!;
  await list.updateComplete;
  list
    .shadowRoot!.querySelector(`tr[data-row-key="${id}"] wt-row-actions`)!
    .querySelectorAll<HTMLElement>("wt-button")
    [index]!.click();
  await el.updateComplete;
}
function submitCategory(el: CategoriesScreen, name: Record<string, string>): void {
  el.shadowRoot!.querySelector("dashboard-category-form")!.dispatchEvent(
    new CustomEvent("wt-submit", {
      detail: { value: { name, parentId: null, image: null, color: null } },
      bubbles: true,
      composed: true,
    }),
  );
}
async function sortBy(table: HTMLElementTagNameMap["wt-data-table"], key: string): Promise<void> {
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>(`[data-sort="${key}"]`)!.click();
  await table.updateComplete;
}
function tableKeys(table: Element): string[] {
  return [...table.shadowRoot!.querySelectorAll("tr[data-row-key]")].map((row) =>
    row.getAttribute("data-row-key")!,
  );
}
/** Opens the first member row's main-category dialog: through Change, or through Remove, which
 * opens it set to no category. */
async function openMainCategory(el: CategoriesScreen, remove: boolean) {
  const members = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-products"]',
  )!;
  await members.updateComplete;
  members
    .shadowRoot!.querySelector("wt-row-actions")!
    .querySelector<HTMLElement>(
      remove ? '[data-test="remove-from-category"]' : '[data-test="change-main"]',
    )!
    .click();
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    'wt-modal[data-test="main-category-dialog"]',
  )!;
  await mainCategoryCombobox(el).updateComplete;
  return dialog;
}
function mainCategoryCombobox(el: CategoriesScreen) {
  return el.shadowRoot!.querySelector<
    HTMLElement & { value: string; updateComplete: Promise<unknown> }
  >('wt-modal[data-test="main-category-dialog"] wt-combobox[name="main-category"]')!;
}
async function confirmMove(el: CategoriesScreen): Promise<void> {
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="confirm-move"]')!.click();
  await el.updateComplete;
}

it("opens in the flat view when that was the view last chosen", async () => {
  localStorage.setItem("waitron.categories.mode", "flat");
  const { el } = await mount();
  expect(
    el.shadowRoot!.querySelector('[data-test="mode-flat"]')!.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(el.shadowRoot!.querySelector("wt-data-table")!.rowParent).toBeUndefined();
});

it("opens in the tree view when the remembered view cannot be read", async () => {
  localStorage.setItem("waitron.categories.mode", "flat");
  const read = Storage.prototype.getItem;
  const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
    this: Storage,
    key: string,
  ) {
    if (this === localStorage) throw new DOMException("blocked", "SecurityError");
    return read.call(this, key);
  });
  try {
    const { el } = await mount();
    expect(
      el.shadowRoot!.querySelector('[data-test="mode-tree"]')!.getAttribute("aria-pressed"),
    ).toBe("true");
  } finally {
    spy.mockRestore();
  }
});

it("saves an edited category through the update call and refreshes the list", async () => {
  const { el, api } = await mount();
  await rowAction(el, "food", 0);
  const form = el.shadowRoot!.querySelector("dashboard-category-form")!;
  expect(form.open).toBe(true);
  expect(form.value).toEqual(food);
  const loads = api.listCategories.mock.calls.length;
  submitCategory(el, { en: "Meals" });
  await vi.waitFor(() => expect(form.open).toBe(false));
  expect(api.updateCategory).toHaveBeenCalledWith("food", {
    name: { en: "Meals" },
    parentId: null,
    image: null,
    color: null,
  });
  expect(api.createCategory).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(api.listCategories.mock.calls.length).toBe(loads + 1));
});

// content.translation_required names only a LANGUAGE, so the refusal belongs beside that
// language's name field; with no language it can only be a form-level error.
it("puts a missing-translation refusal beside the name field for the language it names", async () => {
  const { el, api } = await mount();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="create-category"]')!.click();
  await el.updateComplete;
  const form = el.shadowRoot!.querySelector("dashboard-category-form")!;
  const message = codeMessage("content.translation_required");
  api.createCategory.mockRejectedValueOnce({
    code: "content.translation_required",
    params: { language: "fr" },
  });
  submitCategory(el, { en: "New" });
  await vi.waitFor(() => expect(form.fieldErrors).toEqual({ "name-fr": message }));
  expect(form.open).toBe(true);
  await form.updateComplete;
  const field = (locale: string) =>
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      `wt-input[name="category-name-${locale}"]`,
    )!.error;
  expect(field("fr")).toBe(message);
  expect(field("en")).toBe("");

  api.createCategory.mockRejectedValueOnce({ code: "content.translation_required" });
  submitCategory(el, { en: "New" });
  await vi.waitFor(() => expect(form.fieldErrors).toEqual({ save: message }));
});

it("sends one create when the editor submits twice before the first save settles", async () => {
  const { el, api } = await mount();
  const save = deferred<CategorySummary>();
  api.createCategory.mockReturnValueOnce(save.promise);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="create-category"]')!.click();
  await el.updateComplete;
  submitCategory(el, { en: "New" });
  submitCategory(el, { en: "New" });
  save.resolve({ ...food, id: "new" });
  const form = el.shadowRoot!.querySelector("dashboard-category-form")!;
  await vi.waitFor(() => expect(form.open).toBe(false));
  expect(api.createCategory).toHaveBeenCalledOnce();
});

it("keeps the delete confirmation open against Escape and Cancel, and deletes once, while deleting", async () => {
  const { el, api } = await mount();
  const removal = deferred<void>();
  api.deleteCategory.mockReturnValueOnce(removal.promise);
  await rowAction(el, "food", 1);
  const dialog = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    'wt-modal[data-test="delete-dialog"]',
  )!;
  const remove = dialog.querySelector<HTMLElementTagNameMap["wt-button"]>(
    'wt-button[variant="danger"]',
  )!;
  await vi.waitFor(() => expect(remove.disabled).toBe(false));
  remove.click();
  remove.click();
  await el.updateComplete;
  await userEvent.keyboard("{Escape}");
  dialog.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(dialog.open).toBe(true);
  expect(api.deleteCategory).toHaveBeenCalledOnce();
  removal.resolve();
  await vi.waitFor(() => expect(dialog.open).toBe(false));
});

it("closes the open products dialog of a category that is then deleted", async () => {
  const { el } = await mount();
  await openProducts(el, "food");
  const products = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    'wt-modal[data-test="products-modal"]',
  )!;
  expect(products.open).toBe(true);
  await rowAction(el, "food", 1);
  const dialog = el.shadowRoot!.querySelector('wt-modal[data-test="delete-dialog"]')!;
  const remove = dialog.querySelector<HTMLElementTagNameMap["wt-button"]>(
    'wt-button[variant="danger"]',
  )!;
  await vi.waitFor(() => expect(remove.disabled).toBe(false));
  remove.click();
  await vi.waitFor(() => expect(products.open).toBe(false));
});

it("keeps the products dialog open when a different category is deleted", async () => {
  const { el } = await mount();
  await openProducts(el, "drink");
  const products = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    'wt-modal[data-test="products-modal"]',
  )!;
  await rowAction(el, "food", 1);
  const dialog = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    'wt-modal[data-test="delete-dialog"]',
  )!;
  const remove = dialog.querySelector<HTMLElementTagNameMap["wt-button"]>(
    'wt-button[variant="danger"]',
  )!;
  await vi.waitFor(() => expect(remove.disabled).toBe(false));
  remove.click();
  await vi.waitFor(() => expect(dialog.open).toBe(false));
  expect(products.open).toBe(true);
});

it("adds nothing when Add is pressed with no product picked", async () => {
  const fx = apiFixture();
  fx.api.listLibraryProducts.mockResolvedValue([
    { ...product, id: "q", labelIds: [], primaryCategoryId: null },
  ]);
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(2),
  );
  await openProducts(el, "food");
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-products"]')!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-selected"]')!.click();
  await el.updateComplete;
  expect(fx.api.addProductsToCategory).not.toHaveBeenCalled();
});

/** Mounts with one uncategorised product, opens Food's add list and picks it. */
async function pickForFood() {
  const fx = apiFixture();
  fx.api.listLibraryProducts.mockResolvedValue([
    { ...product, id: "q", name: "Juice", labelIds: [], primaryCategoryId: null },
  ]);
  const mounted = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  const { el } = mounted;
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(2),
  );
  await openProducts(el, "food");
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-products"]')!.click();
  await el.updateComplete;
  const addTable = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-add-products"]',
  )!;
  await addTable.updateComplete;
  addTable.shadowRoot!.querySelector<HTMLInputElement>('[data-test="select-q"]')!.click();
  await el.updateComplete;
  const add = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="add-selected"]',
  )!;
  return { ...fx, ...mounted, addTable, add };
}

it("explains a refused add and keeps the add list and its picks open", async () => {
  const { el, api, add } = await pickForFood();
  api.addProductsToCategory.mockRejectedValueOnce({ code: "product.not_found" });
  add.click();
  await confirmMove(el);
  const products = el.shadowRoot!.querySelector('wt-modal[data-test="products-modal"]')!;
  await vi.waitFor(() =>
    expect(products.querySelector('p[role="alert"]')?.textContent).toBe(
      codeMessage("product.not_found"),
    ),
  );
  expect(
    el.shadowRoot!.querySelector('wt-data-table[data-test="category-add-products"]'),
  ).not.toBeNull();
  expect(add.disabled).toBe(false);
});

it("keeps the products dialog open against Escape and a close, and adds once, while adding", async () => {
  const { el, api, add, addTable } = await pickForFood();
  const adding = deferred<void>();
  api.addProductsToCategory.mockReturnValueOnce(adding.promise);
  add.click();
  await el.updateComplete;
  const move = el.shadowRoot!.querySelector<HTMLElement>('[data-test="confirm-move"]')!;
  move.click();
  move.click();
  await el.updateComplete;
  const products = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    'wt-modal[data-test="products-modal"]',
  )!;
  addTable.shadowRoot!.querySelector<HTMLInputElement>(".table-search")!.focus();
  await userEvent.keyboard("{Escape}");
  products.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(products.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(products.open).toBe(true);
  expect(api.addProductsToCategory).toHaveBeenCalledOnce();
  adding.resolve();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="category-products"]')).not.toBeNull(),
  );
  expect(products.open).toBe(true);
});

it("closes the main-category dialog from its Cancel without saving", async () => {
  const { el, api } = await mount();
  await openProducts(el, "food");
  const dialog = await openMainCategory(el, false);
  expect(dialog.open).toBe(true);
  expect(mainCategoryCombobox(el).value).toBe("food");
  dialog.querySelector<HTMLElement>('wt-button[slot="cancel"]')!.click();
  await el.updateComplete;
  expect(dialog.open).toBe(false);
  expect(api.setMainCategory).not.toHaveBeenCalled();
});

it("explains a refused main-category save and keeps its dialog open", async () => {
  const { el, api } = await mount();
  api.setMainCategory.mockRejectedValueOnce({ code: "category.not_found" });
  await openProducts(el, "food");
  const dialog = await openMainCategory(el, true);
  dialog.querySelector<HTMLElement>('[data-test="save-main-category"]')!.click();
  await vi.waitFor(() =>
    expect(dialog.querySelector('p[role="alert"]')?.textContent).toBe(
      codeMessage("category.not_found"),
    ),
  );
  expect(dialog.open).toBe(true);
});

it("keeps the main-category dialog open against Escape and a close, and saves once, while saving", async () => {
  const { el, api } = await mount();
  const saving = deferred<{ primaryCategoryId: string | null }>();
  api.setMainCategory.mockReturnValueOnce(saving.promise);
  await openProducts(el, "food");
  const dialog = await openMainCategory(el, true);
  const save = dialog.querySelector<HTMLElement>('[data-test="save-main-category"]')!;
  save.click();
  save.click();
  await el.updateComplete;
  expect(dialog.contains(el.shadowRoot!.activeElement)).toBe(true);
  await userEvent.keyboard("{Escape}");
  dialog.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(dialog.open).toBe(true);
  expect(api.setMainCategory).toHaveBeenCalledOnce();
  saving.resolve({ primaryCategoryId: null });
  await vi.waitFor(() => expect(dialog.open).toBe(false));
});

it("closes the main-category dialog after a save even when the refresh fails", async () => {
  const { el, api } = await mount();
  await openProducts(el, "food");
  const dialog = await openMainCategory(el, true);
  api.listCategories.mockRejectedValueOnce(new Error("refresh"));
  dialog.querySelector<HTMLElement>('[data-test="save-main-category"]')!.click();
  await vi.waitFor(() => expect(dialog.open).toBe(false));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="load-error"]')).not.toBeNull(),
  );
});

it("sorts the flat list by parent path, top-level categories first", async () => {
  const { el } = await mountNested();
  await chooseMode(el, "flat");
  const list = el.shadowRoot!.querySelector("wt-data-table")!;
  await sortBy(list, "parent");
  expect(tableKeys(list)).toEqual(["food", "drink", "juice", "breakfast"]);
});

it("sorts and filters a category's products by name and main category", async () => {
  const fx = apiFixture();
  fx.api.listCategories.mockResolvedValue([food, breakfastUnderFood, drink]);
  const jam: Product = {
    ...product,
    id: "jam",
    name: "Jam",
    categoryId: "breakfast",
    primaryCategoryId: "breakfast",
  };
  fx.api.listLibraryProducts.mockResolvedValue([product, jam]);
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(3),
  );
  await openProducts(el, "food");
  await includeBelow(el);
  const members = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-products"]',
  )!;
  await members.updateComplete;
  expect(tableKeys(members)).toEqual(["p", "jam"]);
  const mainCell = (key: string) =>
    members.shadowRoot!.querySelectorAll(`tr[data-row-key="${key}"] td`)[1]!.textContent!.trim();
  expect(mainCell("jam")).toBe("Food / Breakfast");
  expect(mainCell("p")).toBe("Food");

  await sortBy(members, "name");
  expect(tableKeys(members)).toEqual(["jam", "p"]);
  await sortBy(members, "name");
  expect(tableKeys(members)).toEqual(["p", "jam"]);
  await sortBy(members, "primary");
  expect(tableKeys(members)).toEqual(["p", "jam"]);

  const filter = members.shadowRoot!.querySelector<HTMLSelectElement>(
    'select[data-filter="primary"]',
  )!;
  filter.value = "food";
  filter.dispatchEvent(new Event("change"));
  await members.updateComplete;
  expect(tableKeys(members)).toEqual(["p"]);
});

it("counts more than one product and subcategory in the plural in the delete warning", async () => {
  setLocale("en-GB");
  const { el, api } = await mount();
  api.getCategoryDependants.mockResolvedValue({
    products: [
      { id: "p", name: "Toast" },
      { id: "q", name: "Jam" },
    ],
    children: [
      { id: "breakfast", name: { en: "Breakfast" } },
      { id: "lunch", name: { en: "Lunch" } },
    ],
    parentId: null,
    routes: [],
  });
  const { dialog } = await openFoodDelete(el);
  expect(
    dialog.querySelector('[data-test="delete-warning"]')!.textContent!.replace(/\s+/g, " ").trim(),
  ).toBe(
    "This cannot be undone. 2 products have it as their main category. It has 2 subcategories.",
  );
});

it.each(["Cancel", "a close"])(
  "clears a refused main-category save's message when the window is left by %s",
  async (way) => {
    const { el, api } = await mount();
    api.setMainCategory.mockRejectedValueOnce({ code: "category.not_found" });
    await openProducts(el, "food");
    const dialog = await openMainCategory(el, true);
    dialog.querySelector<HTMLElement>('[data-test="save-main-category"]')!.click();
    await vi.waitFor(() => expect(dialog.querySelector('p[role="alert"]')).not.toBeNull());
    if (way === "Cancel") dialog.querySelector<HTMLElement>('wt-button[slot="cancel"]')!.click();
    else dialog.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(dialog.open).toBe(false);
    const products = el.shadowRoot!.querySelector('wt-modal[data-test="products-modal"]')!;
    expect(products.querySelector('p[role="alert"]')).toBeNull();
  },
);

/** Opens Food's delete dialog and waits for its preview. */
async function openFoodDelete(el: CategoriesScreen) {
  await rowAction(el, "food", 1);
  const dialog = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    'wt-modal[data-test="delete-dialog"]',
  )!;
  const remove = dialog.querySelector<HTMLElementTagNameMap["wt-button"]>(
    'wt-button[variant="danger"]',
  )!;
  await vi.waitFor(() => expect(remove.disabled).toBe(false));
  const picker = (name: string) =>
    dialog.querySelector<
      HTMLElement & {
        value: string;
        placeholder: string;
        error: string;
        options: { value: string; label: string }[];
        updateComplete: Promise<unknown>;
      }
    >(`wt-combobox[name="${name}"]`)!;
  return { dialog, remove, picker };
}
const everything: CategoryDependants = {
  products: [{ id: "p", name: "Toast" }],
  children: [{ id: "breakfast", name: { en: "Breakfast" } }],
  parentId: null,
  routes: [],
};

it("prefills the delete dialog's two pickers with the category's parent", async () => {
  const fx = apiFixture();
  const meals: CategorySummary = { ...drink, id: "meals", name: { en: "Meals" } };
  fx.api.listCategories.mockResolvedValue([
    meals,
    { ...food, parentId: "meals" },
    breakfastUnderFood,
    drink,
  ]);
  fx.api.getCategoryDependants.mockResolvedValue({ ...everything, parentId: "meals" });
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(4),
  );
  const { picker } = await openFoodDelete(el);
  expect(picker("products-to").value).toBe("meals");
  expect(picker("children-to").value).toBe("meals");
  // Neither may be the category being deleted, and its subcategories cannot move below themselves.
  expect(picker("products-to").options.map((option) => option.value)).toEqual([
    "",
    "drink",
    "meals",
    "breakfast",
  ]);
  expect(picker("children-to").options.map((option) => option.value)).toEqual([
    "",
    "drink",
    "meals",
  ]);
});

it("prefills Uncategorised and the top level when a top-level category is deleted", async () => {
  const { el, api } = await mount();
  api.getCategoryDependants.mockResolvedValue(everything);
  const { picker, remove } = await openFoodDelete(el);
  expect(picker("products-to").value).toBe("");
  expect(picker("products-to").placeholder).toBe(t("categories.uncategorised"));
  expect(picker("children-to").value).toBe("");
  expect(picker("children-to").placeholder).toBe(t("categories.top_level"));
  remove.click();
  await vi.waitFor(() =>
    expect(api.deleteCategory).toHaveBeenCalledWith("food", { productsTo: null, childrenTo: null }),
  );
});

it("deletes with the destinations chosen in the two pickers", async () => {
  const { el, api } = await mount();
  api.getCategoryDependants.mockResolvedValue(everything);
  const { picker, remove } = await openFoodDelete(el);
  picker("products-to").dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "drink" }, bubbles: true, composed: true }),
  );
  picker("children-to").dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "drink" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  remove.click();
  await vi.waitFor(() =>
    expect(api.deleteCategory).toHaveBeenCalledWith("food", {
      productsTo: "drink",
      childrenTo: "drink",
    }),
  );
});

it("shows only the picker for what the category actually holds", async () => {
  const { el, api } = await mount();
  api.getCategoryDependants.mockResolvedValue({ ...everything, children: [] });
  const { dialog } = await openFoodDelete(el);
  expect(dialog.querySelector('wt-combobox[name="products-to"]')).not.toBeNull();
  expect(dialog.querySelector('wt-combobox[name="children-to"]')).toBeNull();
});

it("puts a refused destination beside the picker it names", async () => {
  const { el, api } = await mount();
  api.getCategoryDependants.mockResolvedValue(everything);
  api.deleteCategory.mockRejectedValueOnce({
    code: "category.reassign_invalid",
    params: { field: "childrenTo" },
  });
  const { dialog, picker, remove } = await openFoodDelete(el);
  remove.click();
  await vi.waitFor(() =>
    expect(picker("children-to").error).toBe(codeMessage("category.reassign_invalid")),
  );
  expect(picker("products-to").error).toBe("");
  expect(dialog.open).toBe(true);
  // Choosing again clears the refusal it was about.
  picker("children-to").dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "drink" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(picker("children-to").error).toBe("");
});

it("retries a failed load from the Retry button", async () => {
  const fx = apiFixture();
  fx.api.listCategories.mockRejectedValueOnce(new Error("offline"));
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="load-error"]')).not.toBeNull(),
  );
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="load-error"] + wt-button')!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(2),
  );
  expect(el.shadowRoot!.querySelector('[data-test="load-error"]')).toBeNull();
});

it("ignores a stale preview failure that lands after a fresh preview succeeded", async () => {
  const { el, api } = await mount();
  const first = deferred<CategoryDependants>();
  const second = deferred<CategoryDependants>();
  api.getCategoryDependants.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await rowAction(el, "food", 1);
  await rowAction(el, "food", 1);
  const dialog = el.shadowRoot!.querySelector('wt-modal[data-test="delete-dialog"]')!;
  const remove = dialog.querySelector<HTMLElementTagNameMap["wt-button"]>(
    'wt-button[variant="danger"]',
  )!;
  second.resolve({ products: [], children: [], parentId: null, routes: [] });
  await vi.waitFor(() => expect(remove.disabled).toBe(false));
  first.reject(new Error("offline"));
  await el.updateComplete;
  await el.updateComplete;
  expect(dialog.querySelector('[data-test="dependants-error"]')).toBeNull();
  expect(remove.disabled).toBe(false);
});

it("dismisses each dialog with Escape when nothing is being saved", async () => {
  const { el } = await mount();
  await openProducts(el, "food");
  const products = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    'wt-modal[data-test="products-modal"]',
  )!;
  // Chromium closes every modal opened since the last user activation on one Escape, so a real
  // click inside the products dialog first keeps the main-category dialog from sharing its group.
  await userEvent.click(products.querySelector('[data-test="category-products"]')!);
  const main = await openMainCategory(el, false);
  expect(main.open).toBe(true);
  main.querySelector<HTMLElement>('[data-test="save-main-category"]')!.focus();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(main.open).toBe(false));
  expect(products.open).toBe(true);

  el.shadowRoot!.querySelector<HTMLElement>('[data-test="close-products"]')!.focus();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(products.open).toBe(false));

  await rowAction(el, "food", 1);
  const dialog = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    'wt-modal[data-test="delete-dialog"]',
  )!;
  await dialog.updateComplete;
  dialog.querySelector<HTMLElement>('wt-button[slot="cancel"]')!.focus();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(dialog.open).toBe(false));
});

async function includeBelow(el: CategoriesScreen): Promise<void> {
  const toggle = el.shadowRoot!.querySelector<HTMLElement & { checked: boolean }>(
    'wt-switch[name="include-descendants"]',
  )!;
  toggle.checked = true;
  toggle.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

it("lists the products below the category too once its toggle is on", async () => {
  const fx = apiFixture();
  const eggs: CategorySummary = { ...breakfastUnderFood, id: "eggs", parentId: "breakfast" };
  fx.api.listCategories.mockResolvedValue([food, breakfastUnderFood, eggs, drink]);
  fx.api.listLibraryProducts.mockResolvedValue([
    product,
    { ...product, id: "b", name: "Porridge", primaryCategoryId: "breakfast" },
    { ...product, id: "e", name: "Omelette", primaryCategoryId: "eggs" },
    { ...product, id: "d", name: "Cola", primaryCategoryId: "drink" },
    { ...product, id: "u", name: "Napkin", primaryCategoryId: null },
  ]);
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(4),
  );
  await openProducts(el, "food");
  const toggle = el.shadowRoot!.querySelector<HTMLElement & { checked: boolean; label: string }>(
    'wt-switch[name="include-descendants"]',
  )!;
  expect(toggle.checked).toBe(false);
  expect(toggle.label).toBe(t("categories.include_descendants"));
  const keys = async () => {
    const table = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
      'wt-data-table[data-test="category-products"]',
    )!;
    await table.updateComplete;
    return table.rows.map((row) => (row as Product).id).sort();
  };
  expect(await keys()).toEqual(["p"]);
  await includeBelow(el);
  expect(await keys()).toEqual(["b", "e", "p"]);
  // A product below the category is in a subcategory, so only Change is offered on its row, never
  // "Remove from this category".
  const members = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-products"]',
  )!;
  await members.updateComplete;
  const actions = (key: string) =>
    [
      ...members.shadowRoot!.querySelectorAll(`tr[data-row-key="${key}"] wt-row-actions wt-button`),
    ].map((button) => button.getAttribute("data-test"));
  expect(actions("p")).toEqual(["change-main", "remove-from-category"]);
  expect(actions("e")).toEqual(["change-main"]);
});

it("confirms how many products Add moves, naming the category, before moving them", async () => {
  setLocale("en-GB");
  const fx = apiFixture();
  const cocktails: CategorySummary = { ...drink, id: "cocktails", name: { en: "Cocktails" } };
  fx.api.listCategories.mockResolvedValue([food, cocktails]);
  fx.api.listLibraryProducts.mockResolvedValue([
    product,
    { ...product, id: "q", name: "Juice", primaryCategoryId: null },
    { ...product, id: "r", name: "Negroni", primaryCategoryId: "food" },
  ]);
  const { el } = await mountWidget<CategoriesScreen>("dashboard-categories-screen", {
    api: fx.client,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-data-table")!.rows.length).toBe(2),
  );
  await openProducts(el, "cocktails");
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-products"]')!.click();
  await el.updateComplete;
  const addTable = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    'wt-data-table[data-test="category-add-products"]',
  )!;
  await addTable.updateComplete;
  addTable.shadowRoot!.querySelector<HTMLInputElement>('[data-test="select-all"]')!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-selected"]')!.click();
  await el.updateComplete;
  const confirm = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    'wt-modal[data-test="move-confirm"]',
  )!;
  expect(confirm.open).toBe(true);
  expect(confirm.getAttribute("heading")).toBe("Move 3 products to Cocktails?");
  // Cancel goes back to the add list with the picks kept, and moves nothing.
  confirm.querySelector<HTMLElement>('wt-button[slot="cancel"]')!.click();
  await el.updateComplete;
  expect(confirm.open).toBe(false);
  expect(fx.api.addProductsToCategory).not.toHaveBeenCalled();
  expect(
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-selected"]')!.textContent!.trim(),
  ).toBe(t("categories.add_selected").replace("{count}", "3"));
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-selected"]')!.click();
  await confirmMove(el);
  await vi.waitFor(() => expect(fx.api.addProductsToCategory).toHaveBeenCalledOnce());
  expect([...(fx.api.addProductsToCategory.mock.calls[0]![1] as string[])].sort()).toEqual([
    "p",
    "q",
    "r",
  ]);
});

it("words a one-product move in the singular", async () => {
  setLocale("en-GB");
  const { el } = await pickForFood();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-selected"]')!.click();
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector('wt-modal[data-test="move-confirm"]')!.getAttribute("heading"),
  ).toBe("Move 1 product to Food?");
});

describe("tabs", () => {
  beforeEach(() => history.replaceState(null, "", "/manage/categories"));
  function tabs(el: CategoriesScreen) {
    return el.shadowRoot!.querySelector<HTMLElement & { value: string }>("wt-tabs")!;
  }

  it("records the Labels tab in the path and walks back to the categories", async () => {
    const { el } = await mount();
    expect(tabs(el).value).toBe("categories");
    expect(location.pathname).toBe("/manage/categories/view/categories");
    tabs(el).dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "labels" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(location.pathname).toBe("/manage/categories/view/labels");
    expect(el.shadowRoot!.querySelector('[slot="labels"] dashboard-labels-panel')).not.toBeNull();
    history.back();
    await vi.waitFor(() => expect(location.pathname).toBe("/manage/categories/view/categories"));
    await vi.waitFor(() => expect(tabs(el).value).toBe("categories"));
  });

  it("opens on the Labels tab when the path names it", async () => {
    history.replaceState(null, "", "/manage/categories/view/labels");
    const { el } = await mount();
    expect(tabs(el).value).toBe("labels");
  });

  it("falls back to the categories for an unknown tab without adding a history entry", async () => {
    history.replaceState(null, "", "/manage/categories/view/bogus");
    const before = history.length;
    const { el } = await mount();
    expect(tabs(el).value).toBe("categories");
    expect(location.pathname).toBe("/manage/categories/view/categories");
    expect(history.length).toBe(before);
  });

  it("ignores a change event from a control inside a tab", async () => {
    const { el } = await mount();
    el.shadowRoot!.querySelector('[slot="categories"]')!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "labels" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(tabs(el).value).toBe("categories");
  });
});
