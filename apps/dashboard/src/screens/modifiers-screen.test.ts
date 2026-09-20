import { afterEach, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { ModifiersScreen } from "./modifiers-screen.js";
import type {
  CatalogueSummary,
  DashboardApi,
  ExtraList,
  ExtraListDependants,
  OptionList,
  OptionListDependants,
  Product,
} from "../api/client.js";
import type { ExtraListForm } from "../widgets/extra-list-form.js";
import type { OptionListForm } from "../widgets/option-list-form.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";

afterEach(cleanupWidgets);

const BREAD = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const RYE = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

/**
 * A product carrying every field the wire type declares. The three names read DIFFERENTLY
 * (CLAUDE.md §3) so a surface reading the customer-facing or kitchen name where the staff name
 * belongs fails instead of passing by coincidence.
 */
function product(overrides: Partial<Product> = {}): Product {
  return {
    id: BREAD,
    modifiers: [],
    modifierIds: [],
    catalogueId: "cat-1",
    categoryId: "category-1",
    categoryIds: ["category-1"],
    primaryCategoryId: "category-1",
    name: "White bread",
    customerName: { es: "Pan blanco" },
    unitId: "unit-each",
    unit: { id: "unit-each", name: { es: "Unidad" }, precision: 0, abbreviation: { es: "ud" } },
    description: null,
    kitchenName: "WHITE",
    dietaryDeclarations: [],
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "reduced",
    active: true,
    soldAlone: false,
    allergens: null,
    dietOverride: null,
    manualAllergens: null,
    image: null,
    variants: [],
    ...overrides,
  };
}

const products: Product[] = [
  product(),
  product({
    id: RYE,
    name: "Rye bread",
    customerName: { es: "Pan de centeno" },
    unitPrice: "1.80",
  }),
];

const catalogues: CatalogueSummary[] = [{ id: "cat-1", name: "Main", active: true, version: 1 }];

/** Staff name, customer-facing name and kitchen name all read differently (CLAUDE.md §3). */
const optionList: OptionList = {
  id: "o1",
  name: "Doneness",
  customerName: { es: "Punto de la carne", en: "How would you like it" },
  kitchenName: "DONE",
  defaultLabelId: "l1",
  active: true,
  labels: [
    {
      id: "l1",
      name: "Rare",
      customerName: { es: "Poco hecho", en: "Pink inside" },
      kitchenName: "RAR",
      available: true,
    },
    {
      id: "l2",
      name: "Well done",
      customerName: { es: "Muy hecho", en: "Cooked through" },
      kitchenName: "WEL",
      available: true,
    },
  ],
};

const extraList: ExtraList = {
  id: "e1",
  name: "Breads",
  customerName: { es: "Elige tu pan", en: "Choose your bread" },
  kitchenName: "BRD",
  minPicks: 1,
  maxPicks: 1,
  active: true,
  items: [
    { id: "i1", productId: BREAD, maxQuantity: 1, preselected: true, price: null },
    { id: "i2", productId: RYE, maxQuantity: 1, preselected: false, price: "0.50" },
  ],
};

const noDependants = { products: [], menus: [] };

function api(overrides: Partial<DashboardApi> = {}) {
  return {
    listOptionLists: vi.fn().mockResolvedValue([optionList]),
    listExtraLists: vi.fn().mockResolvedValue([extraList]),
    listCatalogues: vi.fn().mockResolvedValue(catalogues),
    listProducts: vi.fn().mockResolvedValue(products),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    createOptionList: vi.fn().mockResolvedValue(optionList),
    updateOptionList: vi.fn().mockResolvedValue(optionList),
    deleteOptionList: vi.fn().mockResolvedValue(undefined),
    getOptionListDependants: vi.fn().mockResolvedValue(noDependants),
    createExtraList: vi.fn().mockResolvedValue(extraList),
    updateExtraList: vi.fn().mockResolvedValue(extraList),
    deleteExtraList: vi.fn().mockResolvedValue(undefined),
    getExtraListDependants: vi.fn().mockResolvedValue(noDependants),
    ...overrides,
  } as unknown as DashboardApi;
}

async function mount(client = api()) {
  const { el } = await mountWidget<ModifiersScreen>("dashboard-modifiers-screen", { api: client });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="extra-lists"]')).not.toBeNull(),
  );
  return el;
}

type Table = HTMLElement & {
  rows: unknown[];
  columns: {
    key: string;
    label: string;
    searchValue?: (row: never) => string;
    sortValue?: (row: never) => unknown;
    filter?: unknown;
  }[];
  searchable: boolean;
  searchLabel: string;
  noMatchesMessage: string;
  emptyMessage: string;
  viewKey: string;
  sortKey: string;
  sortDirection: string;
  updateComplete: Promise<unknown>;
  shadowRoot: ShadowRoot;
};

function table(el: ModifiersScreen, testId: string): Table {
  return el.shadowRoot!.querySelector(`[data-test="${testId}"]`) as unknown as Table;
}

/** Switch the page's tabs the way `wt-tabs` announces a choice. */
async function selectTab(el: ModifiersScreen, key: string): Promise<void> {
  const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
  await tabs.updateComplete;
  tabs.shadowRoot!.querySelector<HTMLElement>(`[role="tab"][data-key="${key}"]`)!.click();
  await el.updateComplete;
}

/** Click a control rendered inside a data table's shadow root (a cell's button). */
async function clickInTable(el: ModifiersScreen, testId: string, control: string): Promise<void> {
  const found = table(el, testId);
  await found.updateComplete;
  found.shadowRoot.querySelector<HTMLElement>(`[data-test="${control}"]`)!.click();
  await el.updateComplete;
}

function optionForm(el: ModifiersScreen): OptionListForm {
  return el.shadowRoot!.querySelector<OptionListForm>("dashboard-option-list-form")!;
}
function extraForm(el: ModifiersScreen): ExtraListForm {
  return el.shadowRoot!.querySelector<ExtraListForm>("dashboard-extra-list-form")!;
}

function deleteDialog(el: ModifiersScreen) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    'wt-modal[data-test="delete-dialog"]',
  )!;
}
function detailModal(el: ModifiersScreen) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
    'wt-modal[data-test="detail-modal"]',
  )!;
}
function confirmDelete(el: ModifiersScreen) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="confirm-delete"]',
  )!;
}

/** The entries of a form's shared error summary, in order. */
async function summaryEntries(form: OptionListForm | ExtraListForm) {
  await form.updateComplete;
  const summary = form.shadowRoot!.querySelector("wt-form-error-summary");
  if (summary === null) return [];
  await summary.updateComplete;
  return [...summary.shadowRoot!.querySelectorAll("li")].map((item) => item.textContent);
}

// ---------------------------------------------------------------------------
// The two tabs

it("shows an Extras tab and an Options tab, Extras first", async () => {
  const el = await mount();
  const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
  await tabs.updateComplete;
  const labels = [...tabs.shadowRoot!.querySelectorAll('[role="tab"]')].map((tab) =>
    tab.textContent?.trim(),
  );
  expect(labels).toEqual([t("extras.title"), t("options.title")]);
  expect(
    tabs
      .shadowRoot!.querySelector('[role="tab"][data-key="extras"]')!
      .getAttribute("aria-selected"),
  ).toBe("true");
});

it("switches to the Options tab and lists options lists there", async () => {
  const el = await mount();
  await selectTab(el, "options");
  const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
  expect(
    tabs
      .shadowRoot!.querySelector('[role="tab"][data-key="options"]')!
      .getAttribute("aria-selected"),
  ).toBe("true");
  const options = table(el, "option-lists");
  expect(options.rows).toEqual([optionList]);
});

// A control inside a tab panel is slotted into `wt-tabs`, so a composed `wt-change` it dispatches
// reaches the screen's tab listener under the same event name. Only the tab strip's own choice may
// move the tabs. Delete the `event.target !== event.currentTarget` guard and this goes red.
it("does not change tab when a control inside a panel announces a change", async () => {
  const el = await mount();
  await selectTab(el, "options");
  table(el, "option-lists").dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "extras" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
  expect(
    tabs
      .shadowRoot!.querySelector('[role="tab"][data-key="options"]')!
      .getAttribute("aria-selected"),
  ).toBe("true");
});

it("lists each kind in its own table", async () => {
  const el = await mount();
  expect(table(el, "extra-lists").rows).toEqual([extraList]);
  expect(table(el, "option-lists").rows).toEqual([optionList]);
});

it("gives each tab its own remembered view key and defaults to Name ascending", async () => {
  const el = await mount();
  const extras = table(el, "extra-lists");
  const options = table(el, "option-lists");
  expect(extras.viewKey).toBe("waitron.modifiers.extras.table");
  expect(options.viewKey).toBe("waitron.modifiers.options.table");
  expect(extras.viewKey).not.toBe(options.viewKey);
  for (const found of [extras, options]) {
    expect(found.sortKey).toBe("name");
    expect(found.sortDirection).toBe("ascending");
  }
});

it("makes each tab's table searchable with a status filter", async () => {
  const el = await mount();
  for (const [testId, label] of [
    ["extra-lists", t("extras.search")],
    ["option-lists", t("options.search")],
  ] as const) {
    const found = table(el, testId);
    expect(found.searchable).toBe(true);
    expect(found.searchLabel).toBe(label);
    expect(found.columns.find((column) => column.key === "status")?.filter).toBeTruthy();
  }
});

it("filters an extras list out by its status", async () => {
  const el = await mount(
    api({
      listExtraLists: vi
        .fn()
        .mockResolvedValue([extraList, { ...extraList, id: "e2", name: "Sauces", active: false }]),
    }),
  );
  const extras = table(el, "extra-lists");
  await extras.updateComplete;
  await vi.waitFor(() => expect(extras.shadowRoot.textContent).toContain("Sauces"));
  const filter = extras.shadowRoot.querySelector<HTMLSelectElement>('[name="status-filter"]')!;
  filter.value = "active";
  filter.dispatchEvent(new Event("change", { bubbles: true }));
  await vi.waitFor(() => expect(extras.shadowRoot.textContent).not.toContain("Sauces"));
  expect(extras.shadowRoot.textContent).toContain("Breads");
});

it("shows each list by its STAFF name, never the customer-facing or kitchen one", async () => {
  const el = await mount();
  const extras = table(el, "extra-lists");
  const options = table(el, "option-lists");
  await extras.updateComplete;
  await options.updateComplete;
  await vi.waitFor(() => expect(extras.shadowRoot.textContent).toContain("Breads"));
  expect(extras.shadowRoot.textContent).not.toContain("Elige tu pan");
  expect(extras.shadowRoot.textContent).not.toContain("BRD");
  await vi.waitFor(() => expect(options.shadowRoot.textContent).toContain("Doneness"));
  expect(options.shadowRoot.textContent).not.toContain("Punto de la carne");
  expect(options.shadowRoot.textContent).not.toContain("DONE");
});

it("lists an options list's labels and an extras list's products by their staff names", async () => {
  const el = await mount();
  const options = table(el, "option-lists");
  await options.updateComplete;
  const labels = options.columns.find((column) => column.key === "labels")!;
  expect(labels.searchValue!(optionList as never)).toBe("Rare, Well done");
  expect(labels.sortValue!(optionList as never)).toBe("Rare, Well done");
  const extras = table(el, "extra-lists");
  await extras.updateComplete;
  const items = extras.columns.find((column) => column.key === "items")!;
  expect(items.searchValue!(extraList as never)).toBe("White bread, Rye bread");
  expect(items.sortValue!(extraList as never)).toBe("White bread, Rye bread");
});

// ---------------------------------------------------------------------------
// Add and Edit

it("opens the extras form from the Extras tab's Add button", async () => {
  const el = await mount();
  const button = el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-extra-list"]')!;
  expect(button.textContent).toContain(t("extras.add"));
  button.click();
  await el.updateComplete;
  expect(extraForm(el).open).toBe(true);
  expect(extraForm(el).value).toBeNull();
  expect(optionForm(el).open).toBe(false);
});

it("opens the options form from the Options tab's Add button", async () => {
  const el = await mount();
  await selectTab(el, "options");
  const button = el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-option-list"]')!;
  expect(button.textContent).toContain(t("options.add"));
  button.click();
  await el.updateComplete;
  expect(optionForm(el).open).toBe(true);
  expect(optionForm(el).value).toBeNull();
  expect(extraForm(el).open).toBe(false);
});

it("opens a row's own list in the matching editor", async () => {
  const el = await mount();
  await clickInTable(el, "extra-lists", "edit-extra-e1");
  expect(extraForm(el).open).toBe(true);
  expect(extraForm(el).value).toEqual(extraList);
  await selectTab(el, "options");
  await clickInTable(el, "option-lists", "edit-option-o1");
  expect(optionForm(el).open).toBe(true);
  expect(optionForm(el).value).toEqual(optionList);
});

it("hands the extras form the products the screen loaded", async () => {
  const client = api();
  const el = await mount(client);
  expect(client.listCatalogues).toHaveBeenCalled();
  expect(client.listProducts).toHaveBeenCalledWith("cat-1");
  expect(extraForm(el).products).toEqual(products);
});

it("hands both forms the venue's content languages", async () => {
  const el = await mount();
  expect(extraForm(el).languages).toEqual({ defaultLanguage: "es", languages: ["es", "en"] });
  expect(optionForm(el).languages).toEqual({ defaultLanguage: "es", languages: ["es", "en"] });
});

// ---------------------------------------------------------------------------
// Saving

it("creates an extras list, closes the editor and reloads", async () => {
  const client = api();
  const el = await mount(client);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-extra-list"]')!.click();
  await el.updateComplete;
  const form = extraForm(el);
  form.dispatchEvent(
    new CustomEvent("wt-submit", {
      detail: { value: { ...extraList, items: [] } },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() => expect(form.open).toBe(false));
  expect(client.createExtraList).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(client.listExtraLists).toHaveBeenCalledTimes(2));
});

it("updates the options list that was opened rather than creating one", async () => {
  const client = api();
  const el = await mount(client);
  await selectTab(el, "options");
  await clickInTable(el, "option-lists", "edit-option-o1");
  const form = optionForm(el);
  form.dispatchEvent(
    new CustomEvent("wt-submit", {
      detail: { value: { ...optionList, labels: [] } },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() => expect(form.open).toBe(false));
  expect(client.updateOptionList).toHaveBeenCalledWith("o1", { ...optionList, labels: [] });
  expect(client.createOptionList).not.toHaveBeenCalled();
});

it("keeps a refused save in the form and puts the refusal beside the field it names", async () => {
  const client = api({
    createExtraList: vi
      .fn()
      .mockRejectedValueOnce({ code: "extras.invalid", params: { field: "name" } })
      .mockResolvedValue(extraList),
  });
  const el = await mount(client);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-extra-list"]')!.click();
  await el.updateComplete;
  const form = extraForm(el);
  const submit = () =>
    form.dispatchEvent(
      new CustomEvent("wt-submit", {
        detail: { value: { ...extraList, items: [] } },
        bubbles: true,
        composed: true,
      }),
    );
  submit();
  const message = codeMessage("extras.invalid");
  await vi.waitFor(() => expect(form.fieldErrors.name).toBe(message));
  expect(form.open).toBe(true);
  await vi.waitFor(async () => expect(await summaryEntries(form)).toEqual([message]));
  expect(
    (form.shadowRoot!.querySelector('[name="name"]') as unknown as { error: string }).error,
  ).toBe(message);
  // The second attempt succeeds: the editor closes even though the reload then fails, because a
  // failed refresh after a successful write is a LOAD failure, not a failed save.
  vi.mocked(client.listExtraLists).mockRejectedValue(new Error("load failed"));
  submit();
  await vi.waitFor(() => expect(form.open).toBe(false));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="load-error"]')).not.toBeNull(),
  );
});

it("shows a field-less refusal in the options form's summary and keeps it open", async () => {
  const client = api({
    createOptionList: vi.fn().mockRejectedValue({ code: "options.not_found" }),
  });
  const el = await mount(client);
  await selectTab(el, "options");
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-option-list"]')!.click();
  await el.updateComplete;
  const form = optionForm(el);
  form.dispatchEvent(
    new CustomEvent("wt-submit", {
      detail: { value: { ...optionList, labels: [] } },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(async () =>
    expect(await summaryEntries(form)).toEqual([codeMessage("options.not_found")]),
  );
  expect(form.open).toBe(true);
});

it("closes an editor the form cancels", async () => {
  const el = await mount();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-extra-list"]')!.click();
  await el.updateComplete;
  const form = extraForm(el);
  expect(form.open).toBe(true);
  form.dispatchEvent(new CustomEvent("wt-cancel", { detail: {}, bubbles: true, composed: true }));
  await el.updateComplete;
  expect(form.open).toBe(false);
});

// ---------------------------------------------------------------------------
// Loading

it("shows a failed initial load and retries", async () => {
  const client = api({
    listExtraLists: vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue([extraList]),
  });
  const { el } = await mountWidget<ModifiersScreen>("dashboard-modifiers-screen", { api: client });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="load-error"]')).not.toBeNull(),
  );
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="retry"]')!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="extra-lists"]')).not.toBeNull(),
  );
});

it("refreshes with the passive client without replacing an open draft", async () => {
  const background = api();
  const liveData = new LiveData();
  const client = api({ background, liveData });
  const el = await mount(client);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-extra-list"]')!.click();
  await el.updateComplete;
  const form = extraForm(el);
  form
    .shadowRoot!.querySelector('[name="name"]')!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Draft" } }));
  await form.updateComplete;
  liveData.invalidate([{ type: "extra_lists", id: "e1" }]);
  await vi.waitFor(() => expect(background.listExtraLists).toHaveBeenCalled());
  expect(
    (form.shadowRoot!.querySelector('[name="name"]') as unknown as { value: string }).value,
  ).toBe("Draft");
});

// ---------------------------------------------------------------------------
// The detail modal

it("opens a detail modal listing the products and menus that carry the list, with Edit and Close", async () => {
  const client = api({
    getExtraListDependants: vi.fn().mockResolvedValue({
      products: [{ id: "p1", name: "Hamburguesa" }],
      menus: [{ id: "mn1", name: "Menú del día" }],
    }),
  });
  const el = await mount(client);
  await clickInTable(el, "extra-lists", "open-extra-e1");
  const modal = detailModal(el);
  expect(modal.open).toBe(true);
  expect(client.getExtraListDependants).toHaveBeenCalledWith("e1");
  const usage = table(el, "list-usage");
  await vi.waitFor(() => expect(usage.shadowRoot.textContent).toContain("Hamburguesa"));
  expect(usage.shadowRoot.textContent).toContain("Menú del día");
  expect(usage.rows).toEqual([
    { id: "p1", name: "Hamburguesa", type: "product" },
    { id: "mn1", name: "Menú del día", type: "menu" },
  ]);
  expect(usage.searchable).toBe(true);
  expect(usage.columns.find((column) => column.key === "type")?.filter).toBeTruthy();
  // The modal's own actions: Edit hands the list to its editor, Close dismisses it.
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="detail-edit"]')!.click();
  await el.updateComplete;
  expect(modal.open).toBe(false);
  expect(extraForm(el).open).toBe(true);
  expect(extraForm(el).value).toEqual(extraList);
});

it("filters the detail modal's table by item type", async () => {
  const client = api({
    getOptionListDependants: vi.fn().mockResolvedValue({
      products: [{ id: "p1", name: "Hamburguesa" }],
      menus: [{ id: "mn1", name: "Menú del día" }],
    }),
  });
  const el = await mount(client);
  await selectTab(el, "options");
  await clickInTable(el, "option-lists", "open-option-o1");
  const usage = table(el, "list-usage");
  await vi.waitFor(() => expect(usage.shadowRoot.textContent).toContain("Hamburguesa"));
  const filter = usage.shadowRoot.querySelector<HTMLSelectElement>('[name="type-filter"]')!;
  filter.value = "menu";
  filter.dispatchEvent(new Event("change", { bubbles: true }));
  await vi.waitFor(() => expect(usage.shadowRoot.textContent).not.toContain("Hamburguesa"));
  expect(usage.shadowRoot.textContent).toContain("Menú del día");
});

it("shows a spinner then Close in the detail modal, and closes it", async () => {
  let resolve!: (value: ExtraListDependants) => void;
  const client = api({
    getExtraListDependants: vi
      .fn()
      .mockReturnValue(new Promise<ExtraListDependants>((r) => (resolve = r))),
  });
  const el = await mount(client);
  await clickInTable(el, "extra-lists", "open-extra-e1");
  const modal = detailModal(el);
  expect(modal.querySelector("wt-spinner")).not.toBeNull();
  resolve({ products: [], menus: [] });
  await vi.waitFor(() => expect(modal.querySelector("wt-spinner")).toBeNull());
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="close-detail"]')!.click();
  await el.updateComplete;
  expect(modal.open).toBe(false);
});

it("says the detail modal's read failed rather than showing an empty list", async () => {
  const client = api({
    getExtraListDependants: vi.fn().mockRejectedValue(new Error("offline")),
  });
  const el = await mount(client);
  await clickInTable(el, "extra-lists", "open-extra-e1");
  const modal = detailModal(el);
  await vi.waitFor(() => expect(modal.querySelector('[data-test="usage-error"]')).not.toBeNull());
  expect(modal.querySelector('[data-test="usage-error"]')!.textContent).toContain(
    t("modifiers.usage_error"),
  );
  expect(modal.querySelector('[data-test="list-usage"]')).toBeNull();
});

it("dismisses the detail modal when it closes itself", async () => {
  const el = await mount();
  await clickInTable(el, "extra-lists", "open-extra-e1");
  const modal = detailModal(el);
  expect(modal.open).toBe(true);
  modal.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(modal.open).toBe(false);
});

// ---------------------------------------------------------------------------
// Deleting

it("previews the products and menus a deleted extras list would touch, and NO order count", async () => {
  const client = api({
    getExtraListDependants: vi.fn().mockResolvedValue({
      products: [{ id: "p1", name: "Café" }],
      menus: [{ id: "mn1", name: "Desayuno" }],
    }),
  });
  const el = await mount(client);
  await clickInTable(el, "extra-lists", "delete-extra-e1");
  const dialog = deleteDialog(el);
  await vi.waitFor(() =>
    expect(dialog.querySelector('[data-test="delete-warning"]')).not.toBeNull(),
  );
  const warning = dialog.querySelector('[data-test="delete-warning"]')!;
  expect(warning.getAttribute("role")).toBe("alert");
  expect(warning.textContent).toContain(t("modifiers.delete_warning_intro"));
  expect(warning.textContent).toContain(
    t("modifiers.delete_warning_products").replace("{count}", "1"),
  );
  expect(warning.textContent).toContain(
    t("modifiers.delete_warning_menus").replace("{count}", "1"),
  );
  const deleteProducts = table(el, "list-delete-products");
  const deleteMenus = table(el, "list-delete-menus");
  await vi.waitFor(() => expect(deleteProducts.shadowRoot.textContent).toContain("Café"));
  await vi.waitFor(() => expect(deleteMenus.shadowRoot.textContent).toContain("Desayuno"));
  expect(deleteProducts.searchLabel).toBe(t("modifiers.search_products"));
  expect(deleteProducts.noMatchesMessage).toBe(t("modifiers.products_no_matches"));
  expect(deleteMenus.searchLabel).toBe(t("modifiers.search_menus"));
  expect(deleteMenus.noMatchesMessage).toBe(t("modifiers.menus_no_matches"));
  // Neither kind previews an order count, and neither delete is ever blocked by one: options never
  // touch an order, and an extras-list delete leaves an open order's child lines alone (spec
  // 2026-09-18-one-product-model-design.md §3.5, §9.2).
  expect(dialog.querySelector('[data-test="orders-block"]')).toBeNull();
  expect(dialog.textContent).not.toContain(t("modifiers.delete_orders_block"));
  expect(confirmDelete(el).disabled).toBe(false);
});

it("previews the products and menus a deleted options list would touch, and NO order count", async () => {
  const client = api({
    getOptionListDependants: vi.fn().mockResolvedValue({
      products: [{ id: "p1", name: "Solomillo" }],
      menus: [{ id: "mn1", name: "Menú noche" }],
    }),
  });
  const el = await mount(client);
  await selectTab(el, "options");
  await clickInTable(el, "option-lists", "delete-option-o1");
  const dialog = deleteDialog(el);
  await vi.waitFor(() =>
    expect(dialog.querySelector('[data-test="delete-warning"]')).not.toBeNull(),
  );
  expect(table(el, "list-delete-products").rows).toEqual([{ id: "p1", name: "Solomillo" }]);
  expect(table(el, "list-delete-menus").rows).toEqual([{ id: "mn1", name: "Menú noche" }]);
  expect(dialog.querySelector('[data-test="orders-block"]')).toBeNull();
  expect(confirmDelete(el).disabled).toBe(false);
});

it("keeps Delete disabled behind a spinner until the preview resolves", async () => {
  let resolve!: (value: OptionListDependants) => void;
  const client = api({
    getOptionListDependants: vi
      .fn()
      .mockReturnValue(new Promise<OptionListDependants>((r) => (resolve = r))),
  });
  const el = await mount(client);
  await selectTab(el, "options");
  await clickInTable(el, "option-lists", "delete-option-o1");
  const dialog = deleteDialog(el);
  expect(dialog.querySelector("wt-spinner")).not.toBeNull();
  expect(confirmDelete(el).disabled).toBe(true);
  resolve({ products: [], menus: [] });
  await vi.waitFor(() => expect(confirmDelete(el).disabled).toBe(false));
  expect(dialog.querySelector("wt-spinner")).toBeNull();
});

it("shows no warning and enables Delete when nothing depends on the list", async () => {
  const el = await mount();
  await clickInTable(el, "extra-lists", "delete-extra-e1");
  const dialog = deleteDialog(el);
  await vi.waitFor(() => expect(confirmDelete(el).disabled).toBe(false));
  expect(dialog.querySelector('[data-test="delete-warning"]')).toBeNull();
  expect(dialog.querySelector('[data-test="list-delete-products"]')).toBeNull();
  expect(dialog.querySelector('[data-test="list-delete-menus"]')).toBeNull();
  expect(dialog.querySelector("wt-spinner")).toBeNull();
});

it("says the delete preview failed and keeps Delete disabled", async () => {
  const client = api({
    getExtraListDependants: vi.fn().mockRejectedValue(new Error("offline")),
  });
  const el = await mount(client);
  await clickInTable(el, "extra-lists", "delete-extra-e1");
  const dialog = deleteDialog(el);
  await vi.waitFor(() =>
    expect(dialog.querySelector('[data-test="dependants-error"]')).not.toBeNull(),
  );
  const error = dialog.querySelector('[data-test="dependants-error"]')!;
  expect(error.textContent).toContain(t("modifiers.delete_preview_error"));
  expect(error.getAttribute("role")).toBe("alert");
  expect(dialog.querySelector("wt-spinner")).toBeNull();
  expect(confirmDelete(el).disabled).toBe(true);
});

it("keeps a refused delete in the dialog with its reason, then closes and reloads on success", async () => {
  const client = api({
    deleteExtraList: vi
      .fn()
      .mockRejectedValueOnce({ code: "extras.not_found", params: { extraListId: "e1" } })
      .mockResolvedValue(undefined),
  });
  const el = await mount(client);
  await clickInTable(el, "extra-lists", "delete-extra-e1");
  const dialog = deleteDialog(el);
  await vi.waitFor(() => expect(confirmDelete(el).disabled).toBe(false));
  expect(client.deleteExtraList).not.toHaveBeenCalled();
  confirmDelete(el).click();
  await vi.waitFor(() => expect(dialog.textContent).toContain(codeMessage("extras.not_found")));
  expect(dialog.open).toBe(true);
  confirmDelete(el).click();
  await vi.waitFor(() => expect(dialog.open).toBe(false));
  expect(client.deleteExtraList).toHaveBeenLastCalledWith("e1");
  await vi.waitFor(() => expect(client.listExtraLists).toHaveBeenCalledTimes(2));
});

it("deletes the options list the Options tab's row named", async () => {
  const client = api();
  const el = await mount(client);
  await selectTab(el, "options");
  await clickInTable(el, "option-lists", "delete-option-o1");
  await vi.waitFor(() => expect(confirmDelete(el).disabled).toBe(false));
  confirmDelete(el).click();
  await vi.waitFor(() => expect(client.deleteOptionList).toHaveBeenCalledWith("o1"));
  expect(client.deleteExtraList).not.toHaveBeenCalled();
});

// A failed preview on one list must not poison the next dialog: reopening mints a fresh generation,
// so the stale rejection is discarded.
it("clears a failed delete preview when the dialog is reopened", async () => {
  const client = api({
    getExtraListDependants: vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ products: [], menus: [] }),
  });
  const el = await mount(client);
  await clickInTable(el, "extra-lists", "delete-extra-e1");
  const dialog = deleteDialog(el);
  await vi.waitFor(() =>
    expect(dialog.querySelector('[data-test="dependants-error"]')).not.toBeNull(),
  );
  dialog.querySelector<HTMLElement>('wt-button[slot="cancel"]')!.click();
  await el.updateComplete;
  await clickInTable(el, "extra-lists", "delete-extra-e1");
  await vi.waitFor(async () => {
    await el.updateComplete;
    expect(confirmDelete(el).disabled).toBe(false);
  });
  expect(dialog.querySelector('[data-test="dependants-error"]')).toBeNull();
});

// The reopen test above lets the first fetch settle before reopening, so it never has two requests
// in flight — it cannot catch a stale response clobbering a fresh one. These two exercise the race
// the generation guard exists for: two fetches for the SAME list at once, the older settling LATE.
// Remove EITHER `if (generation === this.#deleteGeneration)` check in #loadDependants and one goes
// red (proven by deletion).
it("ignores a stale preview success from an earlier open of the same list", async () => {
  let resolveFirst!: (value: ExtraListDependants) => void;
  let rejectSecond!: (error: Error) => void;
  const client = api({
    getExtraListDependants: vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<ExtraListDependants>((resolve) => (resolveFirst = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise<ExtraListDependants>((_resolve, reject) => (rejectSecond = reject)),
      ),
  });
  const el = await mount(client);
  await clickInTable(el, "extra-lists", "delete-extra-e1");
  await clickInTable(el, "extra-lists", "delete-extra-e1");
  const dialog = deleteDialog(el);
  rejectSecond(new Error("offline"));
  await vi.waitFor(() =>
    expect(dialog.querySelector('[data-test="dependants-error"]')).not.toBeNull(),
  );
  resolveFirst({ products: [], menus: [] });
  await el.updateComplete;
  await el.updateComplete;
  expect(dialog.querySelector('[data-test="dependants-error"]')).not.toBeNull();
  expect(confirmDelete(el).disabled).toBe(true);
});

it("ignores a stale preview failure from an earlier open of the same list", async () => {
  let rejectFirst!: (error: Error) => void;
  let resolveSecond!: (value: ExtraListDependants) => void;
  const client = api({
    getExtraListDependants: vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<ExtraListDependants>((_resolve, reject) => (rejectFirst = reject)),
      )
      .mockImplementationOnce(
        () => new Promise<ExtraListDependants>((resolve) => (resolveSecond = resolve)),
      ),
  });
  const el = await mount(client);
  await clickInTable(el, "extra-lists", "delete-extra-e1");
  await clickInTable(el, "extra-lists", "delete-extra-e1");
  const dialog = deleteDialog(el);
  resolveSecond({ products: [], menus: [] });
  await vi.waitFor(() => expect(confirmDelete(el).disabled).toBe(false));
  rejectFirst(new Error("offline"));
  await el.updateComplete;
  await el.updateComplete;
  expect(dialog.querySelector('[data-test="dependants-error"]')).toBeNull();
  expect(confirmDelete(el).disabled).toBe(false);
});

// The same generation guard on the DETAIL modal's read.
it("ignores a stale detail read from an earlier open of the same list", async () => {
  let resolveFirst!: (value: ExtraListDependants) => void;
  let rejectSecond!: (error: Error) => void;
  const client = api({
    getExtraListDependants: vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<ExtraListDependants>((resolve) => (resolveFirst = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise<ExtraListDependants>((_resolve, reject) => (rejectSecond = reject)),
      ),
  });
  const el = await mount(client);
  await clickInTable(el, "extra-lists", "open-extra-e1");
  await clickInTable(el, "extra-lists", "open-extra-e1");
  const modal = detailModal(el);
  rejectSecond(new Error("offline"));
  await vi.waitFor(() => expect(modal.querySelector('[data-test="usage-error"]')).not.toBeNull());
  resolveFirst({ products: [], menus: [] });
  await el.updateComplete;
  await el.updateComplete;
  expect(modal.querySelector('[data-test="usage-error"]')).not.toBeNull();
});
