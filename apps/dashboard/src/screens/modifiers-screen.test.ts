import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import {
  chooseOption,
  expectRowMenusOnScreen,
  formMessageOf,
} from "@waitron/ui/src/test-helpers.js";
import { ModifiersScreen } from "./modifiers-screen.js";
import type {
  CatalogueSummary,
  DashboardApi,
  ExtraList,
  ExtraListDependants,
  ExtraListRow,
  OptionListDependants,
  OptionListRow,
  Product,
} from "../api/client.js";
import type { ExtraListForm } from "../widgets/extra-list-form.js";
import type { OptionListForm } from "../widgets/option-list-form.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";

afterEach(cleanupWidgets);
afterEach(() => setLocale("es-ES"));
// Each tab's table remembers its sort and its status filter in sessionStorage under its own
// `viewKey`, so a filter one test chooses would otherwise be restored into every later mount.
beforeEach(() => sessionStorage.clear());
// The column chooser remembers each tab's chosen columns in localStorage, which outlives a test.
const columnKeys = [
  "waitron.modifiers.extras.table:columns",
  "waitron.modifiers.options.table:columns",
];
beforeEach(() => columnKeys.forEach((key) => localStorage.removeItem(key)));
afterEach(() => columnKeys.forEach((key) => localStorage.removeItem(key)));
// The screen reads and writes the chosen tab in the path, so every test starts from the screen's own
// route rather than from wherever the previous file left the browser.
beforeEach(() => history.replaceState(null, "", "/manage/modifiers"));

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
    catalogueId: "cat-1",
    categoryId: "category-1",
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
    available: true,
    ordering: "not_sold_separately",
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
const optionList: OptionListRow = {
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
  usage: { products: 2 },
};

const extraList: ExtraListRow = {
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
  usage: { products: 2 },
};

const noExtraDependants: ExtraListDependants = { products: [] };
const noOptionDependants: OptionListDependants = { products: [] };

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
    getOptionListDependants: vi.fn().mockResolvedValue(noOptionDependants),
    createExtraList: vi.fn().mockResolvedValue(extraList),
    updateExtraList: vi.fn().mockResolvedValue(extraList),
    deleteExtraList: vi.fn().mockResolvedValue(undefined),
    getExtraListDependants: vi.fn().mockResolvedValue(noExtraDependants),
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

async function selectTab(el: ModifiersScreen, key: string): Promise<void> {
  const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
  await tabs.updateComplete;
  tabs.shadowRoot!.querySelector<HTMLElement>(`[role="tab"][data-key="${key}"]`)!.click();
  await el.updateComplete;
}

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

/** The message a list form shows about a failed Save. */
async function bottomOf(form: OptionListForm | ExtraListForm) {
  await form.updateComplete;
  const actions = form.shadowRoot!.querySelector("wt-form-actions")!;
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
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

it("puts only the active tab's Add action beside the tablist", async () => {
  const el = await mount();
  const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
  await tabs.updateComplete;
  expect(tabs.querySelector('[slot="actions"] [data-test="add-extra-list"]')).not.toBeNull();
  expect(tabs.querySelector<HTMLElement>('[data-test="add-extra-list"]')!.checkVisibility()).toBe(
    true,
  );
  expect(tabs.querySelector('[slot="actions"] [data-test="add-option-list"]')).toBeNull();
  expect(tabs.querySelector('[slot="extras"] [data-test="add-extra-list"]')).toBeNull();
  await selectTab(el, "options");
  expect(tabs.querySelector('[slot="actions"] [data-test="add-option-list"]')).not.toBeNull();
  expect(tabs.querySelector<HTMLElement>('[data-test="add-option-list"]')!.checkVisibility()).toBe(
    true,
  );
  expect(tabs.querySelector('[slot="actions"] [data-test="add-extra-list"]')).toBeNull();
  expect(tabs.querySelector('[slot="options"] [data-test="add-option-list"]')).toBeNull();
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

it("keeps the Extras tab and its path when a control inside it announces a change", async () => {
  const el = await mount();
  el.shadowRoot!.querySelector('[slot="extras"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "options" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-tabs")!.value).toBe("extras");
  expect(location.pathname).toBe("/manage/modifiers/view/extras");
});

it("records the chosen tab in the path and walks back to the previous one", async () => {
  const el = await mount();
  expect(location.pathname).toBe("/manage/modifiers/view/extras");

  await selectTab(el, "options");
  expect(location.pathname).toBe("/manage/modifiers/view/options");

  history.back();
  await vi.waitFor(() => expect(location.pathname).toBe("/manage/modifiers/view/extras"));
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-tabs")!.value).toBe("extras"));
});

it("opens on the tab the path names", async () => {
  history.replaceState(null, "", "/manage/modifiers/view/options");
  const el = await mount();
  expect(el.shadowRoot!.querySelector("wt-tabs")!.value).toBe("options");
  expect(table(el, "option-lists").rows).toEqual([optionList]);
});

it("falls back to Extras for an unknown tab without adding a history entry", async () => {
  history.replaceState(null, "", "/manage/modifiers/view/bogus");
  const before = history.length;
  const el = await mount();
  expect(el.shadowRoot!.querySelector("wt-tabs")!.value).toBe("extras");
  expect(location.pathname).toBe("/manage/modifiers/view/extras");
  expect(history.length).toBe(before);
});

describe("a path naming one list", () => {
  it("opens the options list the path names in its editor, on the Options tab", async () => {
    history.replaceState(null, "", "/manage/modifiers/view/options/list/o1");
    const el = await mount();
    await vi.waitFor(() => expect(optionForm(el).open).toBe(true));
    expect(optionForm(el).value).toEqual(optionList);
    expect(el.shadowRoot!.querySelector("wt-tabs")!.value).toBe("options");
    expect(extraForm(el).open).toBe(false);
  });

  it("opens the extras list the path names in its editor", async () => {
    history.replaceState(null, "", "/manage/modifiers/view/extras/list/e1");
    const el = await mount();
    await vi.waitFor(() => expect(extraForm(el).open).toBe(true));
    expect(extraForm(el).value).toEqual(extraList);
    expect(optionForm(el).open).toBe(false);
  });

  it("opens nothing for a list it does not hold, and drops it from the path without a history entry", async () => {
    history.replaceState(null, "", "/manage/modifiers/view/options/list/gone");
    const before = history.length;
    const el = await mount();
    await vi.waitFor(() => expect(location.pathname).toBe("/manage/modifiers/view/options"));
    expect(optionForm(el).open).toBe(false);
    expect(history.length).toBe(before);
  });

  it("drops the list from the path, without a history entry, when its editor closes", async () => {
    history.replaceState(null, "", "/manage/modifiers/view/options/list/o1");
    const before = history.length;
    const el = await mount();
    await vi.waitFor(() => expect(optionForm(el).open).toBe(true));
    optionForm(el).dispatchEvent(new CustomEvent("wt-cancel", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(optionForm(el).open).toBe(false);
    expect(location.pathname).toBe("/manage/modifiers/view/options");
    expect(history.length).toBe(before);
  });

  it("drops the list from the path once its editor saves", async () => {
    history.replaceState(null, "", "/manage/modifiers/view/extras/list/e1");
    const el = await mount();
    await vi.waitFor(() => expect(extraForm(el).open).toBe(true));
    extraForm(el).dispatchEvent(
      new CustomEvent("wt-submit", {
        detail: { value: { name: "Breads" } },
        bubbles: true,
        composed: true,
      }),
    );
    await vi.waitFor(() => expect(extraForm(el).open).toBe(false));
    expect(location.pathname).toBe("/manage/modifiers/view/extras");
  });

  it("leaves the path alone when a row opens an editor", async () => {
    history.replaceState(null, "", "/manage/modifiers/view/options");
    const before = history.length;
    const el = await mount();
    const options = table(el, "option-lists");
    await options.updateComplete;
    const row = options.shadowRoot.querySelector<HTMLElement>('tbody tr[data-row-key="o1"]')!;
    await userEvent.click(row.querySelector<HTMLElement>(".row-activate")!, {
      position: { x: 2, y: 2 },
    });
    await el.updateComplete;
    expect(optionForm(el).open).toBe(true);
    expect(location.pathname).toBe("/manage/modifiers/view/options");
    expect(history.length).toBe(before);
  });

  it("drops the list from the path when the tab changes, still as a history entry", async () => {
    history.replaceState(null, "", "/manage/modifiers/view/extras");
    history.pushState(null, "", "/manage/modifiers/view/options/list/o1");
    const el = await mount();
    await vi.waitFor(() => expect(optionForm(el).open).toBe(true));
    await selectTab(el, "extras");
    expect(location.pathname).toBe("/manage/modifiers/view/extras");
    history.back();
    await vi.waitFor(() =>
      expect(location.pathname).toBe("/manage/modifiers/view/options/list/o1"),
    );
  });
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
  const filter = extras.shadowRoot.querySelector<HTMLElement>('[name="status-filter"]')!;
  await chooseOption(filter, "active");
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

it.each([
  ["en-GB", "Options"],
  ["es-ES", "Opciones"],
])("heads the options column %s as %s", async (locale, heading) => {
  setLocale(locale as "en-GB" | "es-ES");
  const el = await mount();
  const options = table(el, "option-lists");
  await options.updateComplete;
  expect(options.columns.find((column) => column.key === "labels")?.label).toBe(heading);
});

// ---------------------------------------------------------------------------
// Status and Used by

/** The text the Used by cell shows on the row of the list named `name`. */
async function usedByText(el: ModifiersScreen, testId: string, name: string): Promise<string> {
  const found = table(el, testId);
  await found.updateComplete;
  const row = [...found.shadowRoot.querySelectorAll("tbody tr")].find((each) =>
    each.textContent!.includes(name),
  );
  const index = found.columns.findIndex((column) => column.key === "usedBy");
  return row!.querySelectorAll("td")[index]!.textContent!.trim().replace(/\s+/g, " ");
}

describe("the column chooser", () => {
  for (const [testId, kind, detail, detailLabel] of [
    ["extra-lists", "extras", "items", "extras.items"],
    ["option-lists", "options", "labels", "options.labels"],
  ] as const) {
    it(`offers every ${kind} column but the name and the actions, and remembers a hidden one`, async () => {
      const el = await mount();
      const found = table(el, testId);
      await vi.waitFor(() => expect(found.shadowRoot.querySelector("tbody tr")).not.toBeNull());
      const root = found.shadowRoot;
      expect(root.querySelector(".columns-trigger")!.textContent!.trim()).toBe(t("table.columns"));
      const boxes = [...root.querySelectorAll<HTMLInputElement>("input[data-column]")];
      expect(boxes.map((box) => [box.dataset.column, box.checked])).toEqual([
        [detail, true],
        ["usedBy", true],
        ["status", true],
      ]);
      const headerTexts = () =>
        [...root.querySelectorAll("thead th")].map((th) => th.textContent!.trim());
      expect(headerTexts()).toContain(t(detailLabel));
      boxes[0]!.checked = false;
      boxes[0]!.dispatchEvent(new Event("change"));
      await found.updateComplete;
      expect(headerTexts()).not.toContain(t(detailLabel));
      expect(JSON.parse(localStorage.getItem(`waitron.modifiers.${kind}.table:columns`)!)).toEqual({
        [detail]: false,
      });
    });
  }
});

describe("in English", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => setLocale("es-ES"));

  it("shows each list's status as Active or Inactive, and filters by the same two words", async () => {
    expect([t("extras.active"), t("extras.inactive")]).toEqual(["Active", "Inactive"]);
    expect([t("options.active"), t("options.inactive")]).toEqual(["Active", "Inactive"]);
    const el = await mount(
      api({
        listExtraLists: vi
          .fn()
          .mockResolvedValue([
            extraList,
            { ...extraList, id: "e2", name: "Sauces", active: false },
          ]),
      }),
    );
    for (const [testId, kind] of [
      ["extra-lists", "extras"],
      ["option-lists", "options"],
    ] as const) {
      const status = table(el, testId).columns.find((column) => column.key === "status")!;
      expect(status.filter).toMatchObject({
        options: [
          { value: "active", label: t(`${kind}.active`) },
          { value: "inactive", label: t(`${kind}.inactive`) },
        ],
      });
    }
    const extras = table(el, "extra-lists");
    await vi.waitFor(() => expect(extras.shadowRoot.textContent).toContain("Sauces"));
    const rows = [...extras.shadowRoot.querySelectorAll("tbody tr")].map((row) => row.textContent!);
    expect(rows.find((row) => row.includes("Sauces"))).toContain("Inactive");
    expect(rows.find((row) => row.includes("Breads"))).toContain("Active");
    expect(extras.shadowRoot.textContent).not.toContain("In use");
  });

  it("says how many products carry each list, and Not used at zero", async () => {
    const el = await mount(
      api({
        listExtraLists: vi
          .fn()
          .mockResolvedValue([
            extraList,
            { ...extraList, id: "e2", name: "Sauces", usage: { products: 1 } },
            { ...extraList, id: "e3", name: "Toppings", usage: { products: 0 } },
            { ...extraList, id: "e4", name: "Dips", usage: { products: 0 } },
          ]),
        listOptionLists: vi
          .fn()
          .mockResolvedValue([
            optionList,
            { ...optionList, id: "o2", name: "Milk", usage: { products: 1 } },
            { ...optionList, id: "o3", name: "Size", usage: { products: 0 } },
          ]),
      }),
    );
    await vi.waitFor(() =>
      expect(table(el, "extra-lists").shadowRoot.textContent).toContain("Toppings"),
    );
    expect(await usedByText(el, "extra-lists", "Breads")).toBe("2 products");
    expect(await usedByText(el, "extra-lists", "Sauces")).toBe("1 product");
    expect(await usedByText(el, "extra-lists", "Toppings")).toBe("Not used");
    expect(await usedByText(el, "extra-lists", "Dips")).toBe("Not used");
    expect(await usedByText(el, "option-lists", "Doneness")).toBe("2 products");
    expect(await usedByText(el, "option-lists", "Milk")).toBe("1 product");
    expect(await usedByText(el, "option-lists", "Size")).toBe("Not used");
    // Nothing to list, so nothing to open.
    expect(
      table(el, "extra-lists").shadowRoot.querySelector('[data-test="used-by-extra-e4"]'),
    ).toBeNull();
    expect(
      table(el, "option-lists").shadowRoot.querySelector('[data-test="used-by-option-o3"]'),
    ).toBeNull();
  });

  it("sorts and searches the Used by column by what it counts", async () => {
    const el = await mount();
    const extras = table(el, "extra-lists").columns.find((column) => column.key === "usedBy")!;
    const options = table(el, "option-lists").columns.find((column) => column.key === "usedBy")!;
    expect(extras.label).toBe(t("modifiers.used_by"));

    expect(extras.sortValue!(extraList as never)).toBe(2);
    expect(extras.sortValue!({ ...extraList, usage: { products: 1 } } as never)).toBe(1);
    expect(options.sortValue!(optionList as never)).toBe(2);
    expect(extras.searchValue!(extraList as never)).toBe("2 products");
    expect(options.searchValue!(optionList as never)).toBe("2 products");
    // "Not used" is what the cell shows at zero, so it is what a search finds.
    expect(options.searchValue!({ ...optionList, usage: { products: 0 } } as never)).toBe(
      "Not used",
    );
  });

  it("shows the list's name as plain text and opens Used by from the count", async () => {
    const el = await mount();
    const extras = table(el, "extra-lists");
    await vi.waitFor(() => expect(extras.shadowRoot.textContent).toContain("Breads"));
    const name = extras.columns.find((column) => column.key === "name")!;
    expect((name as unknown as { cell: (row: unknown) => unknown }).cell(extraList)).toBe("Breads");
    expect(extras.shadowRoot.querySelector('[data-test="open-extra-e1"]')).toBeNull();
    const count = extras.shadowRoot.querySelector<HTMLElement>('[data-test="used-by-extra-e1"]')!;
    expect(count.localName).toBe("wt-button");
    expect(count.getAttribute("variant")).toBe("ghost");
    expect(count.textContent!.trim()).toBe("2 products");
    count.click();
    await el.updateComplete;
    expect(detailModal(el).open).toBe(true);
    expect(detailModal(el).heading).toBe("Used by Breads");
  });

  // Two lists used by the same number of things would otherwise read the same to a screen reader.
  it("names each count button after its own list, keeping the count as its visible text", async () => {
    const el = await mount(
      api({
        listExtraLists: vi
          .fn()
          .mockResolvedValue([extraList, { ...extraList, id: "e2", name: "Sauces" }]),
      }),
    );
    const extras = table(el, "extra-lists");
    await vi.waitFor(() =>
      expect(extras.shadowRoot.querySelector('[data-test="used-by-extra-e2"]')).not.toBeNull(),
    );
    const named = (id: string) => {
      const count = extras.shadowRoot.querySelector(`[data-test="used-by-extra-${id}"]`)!;
      return {
        name: count.shadowRoot!.querySelector("button")!.getAttribute("aria-label"),
        text: count.textContent!.trim(),
      };
    };
    expect(named("e1")).toEqual({
      name: "Used by Breads: 2 products",
      text: "2 products",
    });
    expect(named("e2")).toEqual({
      name: "Used by Sauces: 2 products",
      text: "2 products",
    });
  });

  // A class rule in the screen would reach nothing: the cell renders inside the table's shadow root.
  it("draws the count like a link", async () => {
    const el = await mount();
    const extras = table(el, "extra-lists");
    await vi.waitFor(() =>
      expect(extras.shadowRoot.querySelector('[data-test="used-by-extra-e1"]')).not.toBeNull(),
    );
    const button = extras.shadowRoot
      .querySelector('[data-test="used-by-extra-e1"]')!
      .shadowRoot!.querySelector("button")!;
    const style = getComputedStyle(button);
    expect(style.textDecorationLine).toBe("underline");
    expect(style.fontWeight).toBe("400");
    // No inline padding, so the count starts where the column's header and "Not used" start.
    expect([style.paddingLeft, style.paddingRight]).toEqual(["0px", "0px"]);
  });

  it("keeps its product count aligned at phone width", async () => {
    const [width, height] = [window.innerWidth, window.innerHeight];
    const el = await mount();
    try {
      await page.viewport(390, 844);
      const extras = table(el, "extra-lists");
      await vi.waitFor(() =>
        expect(extras.shadowRoot.querySelector('[data-test="used-by-extra-e1"]')).not.toBeNull(),
      );
      const button = extras.shadowRoot
        .querySelector('[data-test="used-by-extra-e1"]')!
        .shadowRoot!.querySelector("button")!;
      expect(getComputedStyle(button).textAlign).toBe("start");
      expect(
        extras.shadowRoot.querySelector('[data-test="used-by-extra-e1"]')!.textContent!.trim(),
      ).toBe("2 products");
    } finally {
      await page.viewport(width, height);
    }
  });

  it.each([
    ["extras", "product_modifiers", "extra-lists", "listExtraLists", "3 products"],
    ["options", "product_modifiers", "option-lists", "listOptionLists", "3 products"],
  ] as const)(
    "refreshes the %s Used by count when only %s changes",
    async (_kind, type, testId, read, expected) => {
      const background = api({
        listExtraLists: vi.fn().mockResolvedValue([{ ...extraList, usage: { products: 3 } }]),
        listOptionLists: vi.fn().mockResolvedValue([{ ...optionList, usage: { products: 3 } }]),
      });
      const liveData = new LiveData();
      const el = await mount(api({ background, liveData }));
      const name = testId === "extra-lists" ? "Breads" : "Doneness";
      await vi.waitFor(async () =>
        expect(await usedByText(el, testId, name)).toMatch(/^2 products/),
      );
      liveData.invalidate([{ type: String(type), id: "changed-elsewhere" }]);
      await vi.waitFor(() => expect(background[read]).toHaveBeenCalled());
      await vi.waitFor(async () => expect(await usedByText(el, testId, name)).toBe(expected));
    },
  );
});

it("counts in Spanish, with the singular forms", async () => {
  expect([t("extras.active"), t("extras.inactive")]).toEqual(["Activa", "Inactiva"]);
  const el = await mount(
    api({
      listExtraLists: vi
        .fn()
        .mockResolvedValue([
          extraList,
          { ...extraList, id: "e2", name: "Sauces", usage: { products: 1 } },
          { ...extraList, id: "e3", name: "Dips", usage: { products: 0 } },
        ]),
    }),
  );
  await vi.waitFor(() => expect(table(el, "extra-lists").shadowRoot.textContent).toContain("Dips"));
  expect(await usedByText(el, "extra-lists", "Breads")).toBe("2 productos");
  expect(await usedByText(el, "extra-lists", "Sauces")).toBe("1 producto");
  expect(await usedByText(el, "extra-lists", "Dips")).toBe("Sin usar");
  // "Usado en Breads" would read as used inside the list; the popup asks where the list is used.
  expect(t("modifiers.used_by")).toBe("Usado en");
  await clickInTable(el, "extra-lists", "used-by-extra-e1");
  expect(detailModal(el).heading).toBe("Dónde se usa Breads");
  const count = table(el, "extra-lists").shadowRoot.querySelector(
    '[data-test="used-by-extra-e1"]',
  )!;
  expect(count.shadowRoot!.querySelector("button")!.getAttribute("aria-label")).toBe(
    "Dónde se usa Breads: 2 productos",
  );
});

// ---------------------------------------------------------------------------
// Add and Edit

it("opens an options editor from its row while Used by opens only the products popup", async () => {
  const el = await mount();
  await selectTab(el, "options");
  const options = table(el, "option-lists");
  await options.updateComplete;
  const row = options.shadowRoot.querySelector<HTMLElement>('tbody tr[data-row-key="o1"]')!;
  await userEvent.click(row.querySelector<HTMLElement>(".row-activate")!, {
    position: { x: 2, y: 2 },
  });
  await el.updateComplete;
  expect(optionForm(el).open).toBe(true);
  expect(optionForm(el).value).toEqual(optionList);
  optionForm(el).dispatchEvent(new CustomEvent("wt-cancel", { bubbles: true, composed: true }));
  await el.updateComplete;

  const usedBy = row.querySelector<HTMLElement>("td:nth-child(3)")!;
  await userEvent.click(usedBy, { position: { x: 2, y: 2 } });
  await el.updateComplete;
  expect(optionForm(el).open).toBe(false);
  expect(detailModal(el).open).toBe(false);
  await userEvent.click(usedBy.querySelector<HTMLElement>('[data-test="used-by-option-o1"]')!);
  await el.updateComplete;
  expect(detailModal(el).open).toBe(true);
  expect(optionForm(el).open).toBe(false);
});

it("keeps an unused options list's Used by cell outside row activation", async () => {
  const el = await mount(
    api({
      listOptionLists: vi.fn().mockResolvedValue([{ ...optionList, usage: { products: 0 } }]),
    }),
  );
  await selectTab(el, "options");
  const options = table(el, "option-lists");
  await options.updateComplete;
  const usedBy = options.shadowRoot.querySelector<HTMLElement>(
    'tbody tr[data-row-key="o1"] td:nth-child(3)',
  )!;
  expect(usedBy.textContent?.trim()).toBe(t("modifiers.not_used"));
  const box = usedBy.getBoundingClientRect();
  expect(options.shadowRoot.elementFromPoint(box.x + 2, box.y + 2)).toBe(usedBy);
  await userEvent.click(usedBy, { position: { x: 2, y: 2 } });
  expect(optionForm(el).open).toBe(false);
});

it("marks Delete as dangerous in an options row menu", async () => {
  const el = await mount();
  await selectTab(el, "options");
  const options = table(el, "option-lists");
  await options.updateComplete;
  expect(
    options.shadowRoot
      .querySelector<HTMLElement>('[data-test="delete-option-o1"]')
      ?.getAttribute("variant"),
  ).toBe("danger");
});

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
  await vi.waitFor(async () => expect(await bottomOf(form)).toBe(t("form.fix_fields")));
  expect(
    (form.shadowRoot!.querySelector('[name="name"]') as unknown as { error: string }).error,
  ).toBe(message);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="save"]')!
      .disabled,
  ).toBe(false);
  // The second attempt succeeds: the editor closes even though the reload then fails, because a
  // failed refresh after a successful write is a LOAD failure, not a failed save.
  vi.mocked(client.listExtraLists).mockRejectedValue(new Error("load failed"));
  submit();
  await vi.waitFor(() => expect(form.open).toBe(false));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="load-error"]')).not.toBeNull(),
  );
});

it("puts a refusal to offer a product with Active variants beside that item's product", async () => {
  const client = api({
    updateExtraList: vi.fn().mockRejectedValue({
      code: "extras.product_has_variants",
      params: { field: "items.1.productId", productId: RYE },
      status: 409,
    }),
  });
  const el = await mount(client);
  await clickInTable(el, "extra-lists", "edit-extra-e1");
  const form = extraForm(el);
  form.dispatchEvent(
    new CustomEvent("wt-submit", {
      detail: { value: extraList },
      bubbles: true,
      composed: true,
    }),
  );
  const productError = () =>
    form.shadowRoot!.querySelector('[data-test="item-1-product-error"]')?.textContent;
  await vi.waitFor(() => expect(productError()).toBe(codeMessage("extras.product_has_variants")));
  expect(productError()).not.toBe(codeMessage("test.unmapped_code"));
  expect(form.shadowRoot!.querySelector('[data-test="item-0-product-error"]')).toBeNull();
  expect(form.open).toBe(true);
});

it("shows a field-less refusal in the options form's bottom message and keeps it open", async () => {
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
  await vi.waitFor(async () => expect(await bottomOf(form)).toBe(codeMessage("options.not_found")));
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

it("opens a Used by modal listing the products that carry the list, with Edit and Close", async () => {
  const client = api({
    getExtraListDependants: vi.fn().mockResolvedValue({
      products: [{ id: "p1", name: "Hamburguesa" }],
    }),
  });
  const el = await mount(client);
  await clickInTable(el, "extra-lists", "used-by-extra-e1");
  const modal = detailModal(el);
  expect(modal.open).toBe(true);
  expect(modal.heading).toBe(t("modifiers.used_by_named").replace("{name}", "Breads"));
  expect(client.getExtraListDependants).toHaveBeenCalledWith("e1");
  const usage = table(el, "list-usage");
  await vi.waitFor(() => expect(usage.shadowRoot.textContent).toContain("Hamburguesa"));
  expect(usage.rows).toEqual([{ id: "p1", name: "Hamburguesa", type: "product" }]);
  expect(usage.searchable).toBe(true);
  expect(usage.columns.map((column) => column.key)).toEqual(["name"]);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="detail-edit"]')!.click();
  await el.updateComplete;
  expect(modal.open).toBe(false);
  expect(extraForm(el).open).toBe(true);
  expect(extraForm(el).value).toEqual(extraList);
});

it("lists only products in an options list's Used by table, with no Type column", async () => {
  const client = api({
    getOptionListDependants: vi.fn().mockResolvedValue({
      products: [
        { id: "p1", name: "Solomillo" },
        { id: "p2", name: "Entrecot" },
      ],
    }),
  });
  const el = await mount(client);
  await selectTab(el, "options");
  await clickInTable(el, "option-lists", "used-by-option-o1");
  const modal = detailModal(el);
  const heading = t("modifiers.used_by_named").replace("{name}", "Doneness");
  expect(modal.heading).toBe(heading);
  const usage = table(el, "list-usage");
  await vi.waitFor(() => expect(usage.shadowRoot.textContent).toContain("Solomillo"));
  expect(usage.columns.map((column) => column.key)).toEqual(["name"]);
  expect(usage.rows).toEqual([
    { id: "p1", name: "Solomillo", type: "product" },
    { id: "p2", name: "Entrecot", type: "product" },
  ]);
  expect(usage.searchLabel).toBe(t("modifiers.search_products"));
  expect(usage.noMatchesMessage).toBe(t("modifiers.products_no_matches"));
  expect(usage.emptyMessage).toBe(t("modifiers.no_product_usage"));
  expect(usage.getAttribute("aria-label")).toBe(heading);
});

it("shows a spinner then Close in the detail modal, and closes it", async () => {
  let resolve!: (value: ExtraListDependants) => void;
  const client = api({
    getExtraListDependants: vi
      .fn()
      .mockReturnValue(new Promise<ExtraListDependants>((r) => (resolve = r))),
  });
  const el = await mount(client);
  await clickInTable(el, "extra-lists", "used-by-extra-e1");
  const modal = detailModal(el);
  expect(modal.querySelector("wt-spinner")).not.toBeNull();
  resolve({ products: [] });
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
  await clickInTable(el, "extra-lists", "used-by-extra-e1");
  const modal = detailModal(el);
  await vi.waitFor(() => expect(modal.querySelector('[data-test="usage-error"]')).not.toBeNull());
  expect(modal.querySelector('[data-test="usage-error"]')!.textContent).toContain(
    t("modifiers.usage_error"),
  );
  expect(modal.querySelector('[data-test="list-usage"]')).toBeNull();
});

it("dismisses the detail modal when it closes itself", async () => {
  const el = await mount();
  await clickInTable(el, "extra-lists", "used-by-extra-e1");
  const modal = detailModal(el);
  expect(modal.open).toBe(true);
  modal.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(modal.open).toBe(false);
});

// ---------------------------------------------------------------------------
// Deleting

it("previews the products a deleted extras list would touch, and NO order count", async () => {
  const client = api({
    getExtraListDependants: vi.fn().mockResolvedValue({
      products: [{ id: "p1", name: "Café" }],
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
  const deleteProducts = table(el, "list-delete-products");
  await vi.waitFor(() => expect(deleteProducts.shadowRoot.textContent).toContain("Café"));
  expect(deleteProducts.searchLabel).toBe(t("modifiers.search_products"));
  expect(deleteProducts.noMatchesMessage).toBe(t("modifiers.products_no_matches"));
  expect(dialog.querySelector('[data-test="orders-block"]')).toBeNull();
  expect(confirmDelete(el).disabled).toBe(false);
});

it("previews only the products a deleted options list would touch, and NO order count", async () => {
  const client = api({
    getOptionListDependants: vi.fn().mockResolvedValue({
      products: [{ id: "p1", name: "Solomillo" }],
    }),
  });
  const el = await mount(client);
  await selectTab(el, "options");
  await clickInTable(el, "option-lists", "delete-option-o1");
  const dialog = deleteDialog(el);
  await vi.waitFor(() =>
    expect(dialog.querySelector('[data-test="delete-warning"]')).not.toBeNull(),
  );
  expect(dialog.querySelector('[data-test="delete-warning"]')!.textContent!.trim()).toBe(
    [
      t("modifiers.delete_warning_intro"),
      t("modifiers.delete_warning_products").replace("{count}", "1"),
    ].join(" "),
  );
  expect(table(el, "list-delete-products").rows).toEqual([{ id: "p1", name: "Solomillo" }]);
  expect(dialog.querySelector('[data-test="list-delete-menus"]')).toBeNull();
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
  resolve({ products: [] });
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
  const actions = dialog.querySelector("wt-form-actions")!;
  await vi.waitFor(async () =>
    expect((await formMessageOf(actions))?.textContent).toBe(codeMessage("extras.not_found")),
  );
  const message = await formMessageOf(actions);
  expect(dialog.shadowRoot!.querySelector(".body")!.contains(message)).toBe(true);
  expect(actions.shadowRoot!.querySelector("[data-error]")).toBeNull();
  expect(dialog.textContent).not.toContain(codeMessage("extras.not_found"));
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

it("clears a failed delete preview when the dialog is reopened", async () => {
  const client = api({
    getExtraListDependants: vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ products: [] }),
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

// Two fetches for the same list in flight at once, the older settling late: the race the
// generation guard exists for.
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
  resolveFirst({ products: [] });
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
  resolveSecond({ products: [] });
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
  await clickInTable(el, "extra-lists", "used-by-extra-e1");
  await clickInTable(el, "extra-lists", "used-by-extra-e1");
  const modal = detailModal(el);
  rejectSecond(new Error("offline"));
  await vi.waitFor(() => expect(modal.querySelector('[data-test="usage-error"]')).not.toBeNull());
  resolveFirst({ products: [] });
  await el.updateComplete;
  await el.updateComplete;
  expect(modal.querySelector('[data-test="usage-error"]')).not.toBeNull();
});

// ---------------------------------------------------------------------------
// Searching the tables

async function search(found: Table, text: string): Promise<string> {
  await found.updateComplete;
  const box = found.shadowRoot.querySelector<HTMLInputElement>('input[name="search"]')!;
  box.value = text;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  await found.updateComplete;
  return found.shadowRoot.querySelector("tbody")!.textContent!;
}

it("finds a list by its name and by the status it shows", async () => {
  const el = await mount(
    api({
      listExtraLists: vi
        .fn()
        .mockResolvedValue([extraList, { ...extraList, id: "e2", name: "Sauces", active: false }]),
    }),
  );
  const extras = table(el, "extra-lists");

  const byName = await search(extras, "Sauces");
  expect(byName).toContain("Sauces");
  expect(byName).not.toContain("Breads");

  const byStatus = await search(extras, t("extras.inactive"));
  expect(byStatus).toContain("Sauces");
  expect(byStatus).not.toContain("Breads");
});

it("finds a detail-modal product row by its name", async () => {
  const client = api({
    getExtraListDependants: vi.fn().mockResolvedValue({
      products: [{ id: "p1", name: "Hamburguesa" }],
    }),
  });
  const el = await mount(client);
  await clickInTable(el, "extra-lists", "used-by-extra-e1");
  const usage = table(el, "list-usage");
  await vi.waitFor(() => expect(usage.shadowRoot.textContent).toContain("Hamburguesa"));

  const byName = await search(usage, "Hamburguesa");
  expect(byName).toContain("Hamburguesa");
  expect(byName).not.toContain("Menú del día");
});

it("switches back to the Extras tab from Options", async () => {
  const el = await mount();
  await selectTab(el, "options");
  await selectTab(el, "extras");
  expect(el.shadowRoot!.querySelector("wt-tabs")!.value).toBe("extras");
  expect(location.pathname).toBe("/manage/modifiers/view/extras");
});

// ---------------------------------------------------------------------------
// Products for the extras form

it("offers the extras form no products once the venue has no catalogue left", async () => {
  const client = api({
    listCatalogues: vi.fn().mockResolvedValueOnce(catalogues).mockResolvedValue([]),
  });
  const el = await mount(client);
  await vi.waitFor(() => expect(extraForm(el).products).toEqual(products));

  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-extra-list"]')!.click();
  await el.updateComplete;
  extraForm(el).dispatchEvent(
    new CustomEvent("wt-submit", {
      detail: { value: { ...extraList, items: [] } },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() => expect(client.listCatalogues).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(extraForm(el).products).toEqual([]));
  expect(client.listProducts).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// Saving

function submitFrom(form: HTMLElement, value: unknown): void {
  form.dispatchEvent(
    new CustomEvent("wt-submit", { detail: { value }, bubbles: true, composed: true }),
  );
}

it("updates the extras list that was opened rather than creating one", async () => {
  const client = api();
  const el = await mount(client);
  await clickInTable(el, "extra-lists", "edit-extra-e1");
  const form = extraForm(el);
  const input = { ...extraList, name: "Breads and rolls" };
  submitFrom(form, input);
  await vi.waitFor(() => expect(form.open).toBe(false));
  expect(client.updateExtraList).toHaveBeenCalledWith("e1", input);
  expect(client.createExtraList).not.toHaveBeenCalled();
});

it("sends one save when two submissions arrive before the first answers", async () => {
  let resolve!: (value: ExtraList) => void;
  const client = api({
    createExtraList: vi
      .fn()
      .mockImplementation(() => new Promise<ExtraList>((done) => (resolve = done))),
  });
  const el = await mount(client);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-extra-list"]')!.click();
  await el.updateComplete;
  const form = extraForm(el);
  submitFrom(form, { ...extraList, items: [] });
  submitFrom(form, { ...extraList, items: [] });
  expect(client.createExtraList).toHaveBeenCalledTimes(1);
  resolve(extraList);
  await vi.waitFor(() => expect(form.open).toBe(false));
  expect(client.createExtraList).toHaveBeenCalledTimes(1);
});

it("ignores a submission when no editor is open", async () => {
  const client = api();
  const el = await mount(client);
  submitFrom(optionForm(el), { ...optionList, labels: [] });
  await el.updateComplete;
  expect(client.createOptionList).not.toHaveBeenCalled();
  expect(client.updateOptionList).not.toHaveBeenCalled();
  expect(optionForm(el).fieldErrors).toEqual({});
  expect(optionForm(el).busy).toBe(false);
});

it.each([
  ["extras", "add-extra-list", extraForm, "createExtraList"],
  ["options", "add-option-list", optionForm, "createOptionList"],
] as const)(
  "keeps the %s editor open when it is cancelled while its save is in flight",
  async (tab, addButton, formOf, create) => {
    let resolve!: (value: unknown) => void;
    const client = api({
      [create]: vi.fn().mockImplementation(() => new Promise((done) => (resolve = done))),
    });
    const el = await mount(client);
    await selectTab(el, tab);
    el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${addButton}"]`)!.click();
    await el.updateComplete;
    const form = formOf(el);
    submitFrom(form, tab === "extras" ? { ...extraList, items: [] } : { ...optionList });
    await el.updateComplete;
    form.dispatchEvent(new CustomEvent("wt-cancel", { detail: {}, bubbles: true, composed: true }));
    await el.updateComplete;
    expect(form.open).toBe(true);
    resolve(tab === "extras" ? extraList : optionList);
    await vi.waitFor(() => expect(form.open).toBe(false));
  },
);

it("names only the products in the delete warning when no menu carries the list", async () => {
  const client = api({
    getExtraListDependants: vi.fn().mockResolvedValue({
      products: [
        { id: "p1", name: "Café" },
        { id: "p2", name: "Tostada" },
      ],
    }),
  });
  const el = await mount(client);
  await clickInTable(el, "extra-lists", "delete-extra-e1");
  const dialog = deleteDialog(el);
  await vi.waitFor(() =>
    expect(dialog.querySelector('[data-test="delete-warning"]')).not.toBeNull(),
  );
  expect(dialog.querySelector('[data-test="delete-warning"]')!.textContent!.trim()).toBe(
    [
      t("modifiers.delete_warning_intro"),
      t("modifiers.delete_warning_products").replace("{count}", "2"),
    ].join(" "),
  );
});

function escape(target: HTMLElement, key = "Escape"): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    composed: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

it("holds the delete dialog open while its delete is in flight, then closes it", async () => {
  let resolve!: () => void;
  const client = api({
    deleteExtraList: vi
      .fn()
      .mockImplementation(() => new Promise<void>((done) => (resolve = done))),
  });
  const el = await mount(client);
  await clickInTable(el, "extra-lists", "delete-extra-e1");
  const dialog = deleteDialog(el);
  await vi.waitFor(() => expect(confirmDelete(el).disabled).toBe(false));
  expect(escape(dialog)).toBe(false);

  confirmDelete(el).click();
  confirmDelete(el).click();
  await el.updateComplete;
  expect(client.deleteExtraList).toHaveBeenCalledTimes(1);
  expect(escape(dialog)).toBe(true);
  expect(escape(dialog, "Enter")).toBe(false);
  dialog.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(dialog.open).toBe(true);

  resolve();
  await vi.waitFor(() => expect(dialog.open).toBe(false));
  expect(client.deleteExtraList).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// The detail modal's Edit

it("opens no editor from the detail modal when a refresh has removed the list", async () => {
  const background = api({ listExtraLists: vi.fn().mockResolvedValue([]) });
  const liveData = new LiveData();
  const client = api({ background, liveData });
  const el = await mount(client);
  await clickInTable(el, "extra-lists", "used-by-extra-e1");
  const modal = detailModal(el);
  expect(modal.open).toBe(true);
  liveData.invalidate([{ type: "extra_lists", id: "e1" }]);
  await vi.waitFor(() => expect(table(el, "extra-lists").rows).toEqual([]));

  el.shadowRoot!.querySelector<HTMLElement>('[data-test="detail-edit"]')!.click();
  await el.updateComplete;
  expect(modal.open).toBe(false);
  expect(extraForm(el).open).toBe(false);
});

it("opens one editor when Edit is pressed twice before the modal closes", async () => {
  const el = await mount();
  await clickInTable(el, "extra-lists", "used-by-extra-e1");
  const edit = el.shadowRoot!.querySelector<HTMLElement>('[data-test="detail-edit"]')!;
  edit.click();
  edit.click();
  await el.updateComplete;
  expect(detailModal(el).open).toBe(false);
  expect(extraForm(el).open).toBe(true);
  expect(extraForm(el).value).toEqual(extraList);
});

describe("the modifier list tables at phone width", () => {
  // A long unbroken list name widens the name column past a phone's screen.
  const longName = "Panes-artesanos-de-masa-madre-del-obrador-de-la-esquina";
  const phoneApi = () =>
    api({
      listExtraLists: vi
        .fn()
        .mockResolvedValue([extraList, { ...extraList, id: "e2", name: longName }]),
      listOptionLists: vi
        .fn()
        .mockResolvedValue([optionList, { ...optionList, id: "o2", name: longName }]),
    });
  it.each(
    ["en-GB", "es-ES"].flatMap((locale) =>
      [
        { tab: "extras", testId: "extra-lists" },
        { tab: "options", testId: "option-lists" },
      ].map(({ tab, testId }) => ({ locale, tab, testId })),
    ),
  )(
    "keeps every $tab row's menu on screen and uncovered at 390 px while the other columns scroll sideways ($locale)",
    async ({ locale, tab, testId }) => {
      const width = window.innerWidth,
        height = window.innerHeight;
      const before = currentLocale();
      try {
        setLocale(locale);
        await page.viewport(390, 844);
        expect(window.innerWidth).toBe(390);
        const el = await mount(phoneApi());
        await selectTab(el, tab);
        const found = table(el, testId);
        await found.updateComplete;
        expectRowMenusOnScreen(found, 2);
      } finally {
        setLocale(before);
        await page.viewport(width, height);
      }
    },
  );
});
