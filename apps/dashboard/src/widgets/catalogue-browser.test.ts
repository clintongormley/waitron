import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { CategorySummary, DashboardApi, Product } from "../api/client.js";
import type { CatalogueBrowser } from "./catalogue-browser.js";
import "./catalogue-browser.js";
registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  setLocale("en-GB");
});
export const folder = (id: string, name: string, parentId: string | null): CategorySummary => ({
  id,
  name,
  parentId,
});
export const CATEGORIES = [
  folder("d", "Drinks", null),
  folder("b", "Beer", "d"),
  folder("f", "Food", null),
];
const product = (
  id: string,
  name: string,
  primaryCategoryId: string | null,
  active = true,
): Product => ({
  id,
  name,
  primaryCategoryId,
  categoryId: primaryCategoryId,
  active,
  catalogueId: "c",
  modifiers: [],
  customerName: null,
  unitId: "u",
  unit: { id: "u", name: { en: "Each" }, abbreviation: { en: "ea" }, precision: 0 },
  description: null,
  kitchenName: null,
  dietaryDeclarations: [],
  pricingUnit: "each",
  unitPrice: "2.00",
  vatClass: "reduced",
  available: true,
  ordering: "public",
  allergens: null,
  dietOverride: null,
  manualAllergens: null,
  image: null,
  variants: [],
});
export const PRODUCTS = [
  product("cola", "Cola", "d"),
  product("lager", "Lager", "b", false),
  product("burger", "Burger", "f"),
  product("bread", "Bread", null),
];
export async function mountBrowser(overrides: Partial<CatalogueBrowser> = {}) {
  const api = {
    moveCatalogueItems: vi.fn().mockResolvedValue(undefined),
    deleteCatalogueItems: vi.fn().mockResolvedValue(undefined),
    summariseFolders: vi.fn().mockResolvedValue([{ id: "d", folders: 1, products: 2, routes: 1 }]),
    createCategory: vi.fn().mockResolvedValue(folder("new", "Juice", "d")),
    updateCategory: vi.fn().mockResolvedValue(folder("d", "Beverages", null)),
  } as unknown as DashboardApi;
  return (
    await mountWidget<CatalogueBrowser>("dashboard-catalogue-browser", {
      api,
      products: PRODUCTS,
      categories: CATEGORIES,
      ...overrides,
    })
  ).el;
}
export async function tableOf(el: CatalogueBrowser) {
  await el.updateComplete;
  const list = el.shadowRoot!.querySelector("dashboard-product-list")!;
  await list.updateComplete;
  const table = list.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  return table;
}
export async function rowKeys(el: CatalogueBrowser) {
  return [...(await tableOf(el)).shadowRoot!.querySelectorAll<HTMLElement>("tr[data-row-key]")].map(
    (row) => row.dataset.rowKey,
  );
}
export async function typeSearch(el: CatalogueBrowser, value: string) {
  el.shadowRoot!.querySelector('[name="catalogue-search"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
export async function chooseFilter(el: CatalogueBrowser, column: string, value: string) {
  const table = await tableOf(el);
  const select = table.shadowRoot!.querySelector<HTMLSelectElement>(
    `select[data-filter="${column}"]`,
  )!;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await table.updateComplete;
}
const crumbs = (el: CatalogueBrowser) =>
  [...el.shadowRoot!.querySelectorAll("nav.breadcrumb li")].map((li) =>
    li.textContent!.replace("›", "").trim(),
  );
it("shows top-level folders before unfiled products", async () => {
  expect(await rowKeys(await mountBrowser())).toEqual(["folder:d", "folder:f", "bread"]);
});
it("shows only direct children and breadcrumbs inside a folder", async () => {
  const el = await mountBrowser({ folderId: "d" });
  expect(await rowKeys(el)).toEqual(["folder:b", "cola"]);
  expect(crumbs(el)).toEqual(["All products", "Drinks"]);
});
it("keeps folders through both product filters", async () => {
  const el = await mountBrowser({ folderId: "d" });
  await chooseFilter(el, "active", "inactive");
  expect(await rowKeys(el)).toEqual(["folder:b"]);
  await chooseFilter(el, "ordering", "staff_only");
  expect(await rowKeys(el)).toEqual(["folder:b"]);
});
it("sorts a numbered folder before products", async () => {
  expect(
    await rowKeys(await mountBrowser({ categories: [...CATEGORIES, folder("s", "5 Star", null)] })),
  ).toEqual(["folder:s", "folder:d", "folder:f", "bread"]);
});
it("falls back to the top level for a missing folder", async () => {
  const el = await mountBrowser({ folderId: "gone" });
  expect(await rowKeys(el)).toEqual(["folder:d", "folder:f", "bread"]);
  expect(crumbs(el)).toEqual(["All products"]);
});
it("searches globally and restores the previous folder when cleared", async () => {
  const el = await mountBrowser({ folderId: "f" });
  await typeSearch(el, "COL");
  expect(await rowKeys(el)).toEqual(["cola"]);
  expect(
    (await tableOf(el)).shadowRoot!.querySelector('tr[data-row-key="cola"]')!.textContent,
  ).toContain("Drinks");
  expect(crumbs(el)).toEqual([]);
  await typeSearch(el, "");
  expect(await rowKeys(el)).toEqual(["burger"]);
});
it("searches folder paths and product variant names", async () => {
  const el = await mountBrowser({
    products: [
      ...PRODUCTS,
      {
        ...PRODUCTS[0]!,
        id: "sized",
        name: "Coffee",
        variants: [
          {
            id: "v",
            name: "Large cup",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: null,
            active: true,
            available: true,
            effective: { unitPrice: "2.00", vatClass: "reduced", primaryCategoryId: "d" },
          },
        ],
      },
    ],
  });
  await typeSearch(el, "drinks");
  expect(await rowKeys(el)).toEqual(["folder:b", "folder:d", "sized", "cola"]);
  await typeSearch(el, "cup");
  expect(await rowKeys(el)).toEqual(["sized"]);
});
it("lists all products with paths and no breadcrumb in all view", async () => {
  const el = await mountBrowser({ view: "all" });
  expect((await rowKeys(el)).sort()).toEqual(["bread", "burger", "cola"]);
  expect(crumbs(el)).toEqual([]);
});
it("emits folder navigation once and offers accessible folder actions", async () => {
  const el = await mountBrowser();
  const opened = vi.fn();
  el.addEventListener("open-folder", opened);
  const root = (await tableOf(el)).shadowRoot!;
  root.querySelector<HTMLElement>('[data-test="open-d"]')!.click();
  expect(opened).toHaveBeenCalledOnce();
  expect((opened.mock.calls[0]![0] as CustomEvent).detail).toEqual({ folderId: "d" });
  expect(root.querySelector('wt-icon[name="folder"]')).not.toBeNull();
});
it("emits breadcrumb navigation and view changes", async () => {
  const el = await mountBrowser({ folderId: "b" });
  const opened = vi.fn();
  const changed = vi.fn();
  el.addEventListener("open-folder", opened);
  el.addEventListener("view-change", changed);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="crumb-0"]')!.click();
  expect((opened.mock.calls[0]![0] as CustomEvent).detail).toEqual({ folderId: null });
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="view-all"]')!.click();
  expect((changed.mock.calls[0]![0] as CustomEvent).detail).toEqual({ view: "all" });
});
it("creates a folder under the current folder and closes after save", async () => {
  const el = await mountBrowser({ folderId: "d" });
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="new-folder"]')!.click();
  await el.updateComplete;
  const form = el.shadowRoot!.querySelector("dashboard-category-form")!;
  await form.updateComplete;
  form
    .shadowRoot!.querySelector('[name="name"]')!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Juice" } }));
  await form.updateComplete;
  form.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  await vi.waitFor(() =>
    expect(el.api.createCategory).toHaveBeenCalledWith({ name: "Juice", parentId: "d" }),
  );
  await vi.waitFor(() => expect(form.open).toBe(false));
});
it("renames a root folder without adopting the current folder", async () => {
  const el = await mountBrowser({ folderId: "b" });
  const list = el.shadowRoot!.querySelector("dashboard-product-list")!;
  list.dispatchEvent(
    new CustomEvent("rename-folder", { detail: { folderId: "d" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  const form = el.shadowRoot!.querySelector("dashboard-category-form")!;
  await form.updateComplete;
  form
    .shadowRoot!.querySelector('[name="name"]')!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Beverages" } }));
  await form.updateComplete;
  form.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  await vi.waitFor(() =>
    expect(el.api.updateCategory).toHaveBeenCalledWith("d", { name: "Beverages", parentId: null }),
  );
});
it("keeps a refused folder save open with a field error and allows retry", async () => {
  const el = await mountBrowser({ folderId: "d" });
  vi.mocked(el.api.createCategory).mockRejectedValueOnce({ code: "category.invalid" });
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="new-folder"]')!.click();
  await el.updateComplete;
  const form = el.shadowRoot!.querySelector("dashboard-category-form")!;
  await form.updateComplete;
  form
    .shadowRoot!.querySelector('[name="name"]')!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Juice" } }));
  await form.updateComplete;
  form.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  await vi.waitFor(() => expect(form.fieldErrors.name).toBeTruthy());
  expect(form.open).toBe(true);
  expect(form.shadowRoot!.querySelector("wt-form-actions")!.getAttribute("slot")).toBe("footer");
  expect(form.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull();
});

it("creates a top-level folder when the addressed folder is missing", async () => {
  const el = await mountBrowser({ folderId: "gone" });
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="new-folder"]')!.click();
  await el.updateComplete;
  const form = el.shadowRoot!.querySelector("dashboard-category-form")!;
  await form.updateComplete;
  form
    .shadowRoot!.querySelector('[name="name"]')!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Juice" } }));
  await form.updateComplete;
  form.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  await vi.waitFor(() =>
    expect(el.api.createCategory).toHaveBeenCalledWith({ name: "Juice", parentId: null }),
  );
});

it("shows the path only in global views and leaves folder product cells empty", async () => {
  const el = await mountBrowser();
  let table = await tableOf(el);
  expect(table.shadowRoot!.querySelector('input[name="search"]')).toBeNull();
  expect(table.columns.some((column) => column.key === "reporting-category")).toBe(false);
  const row = table.shadowRoot!.querySelector('tr[data-row-key="folder:d"]')!;
  expect(
    [...row.querySelectorAll("td")].slice(1, -1).every((cell) => cell.textContent!.trim() === ""),
  ).toBe(true);
  await typeSearch(el, "beer");
  table = await tableOf(el);
  expect(table.columns.some((column) => column.key === "reporting-category")).toBe(true);
  expect(table.shadowRoot!.querySelector('tr[data-row-key="folder:b"]')!.textContent).toContain(
    "Drinks",
  );
});
it("keeps a variant match on its parent until the manager expands it", async () => {
  const el = await mountBrowser({
    products: [
      {
        ...PRODUCTS[0]!,
        id: "coffee",
        name: "Coffee",
        variants: [
          {
            id: "large",
            name: "Large cup",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: null,
            active: true,
            available: true,
            effective: { unitPrice: "2.00", vatClass: "reduced", primaryCategoryId: "d" },
          },
        ],
      },
    ],
  });
  await typeSearch(el, "cup");
  expect(await rowKeys(el)).toEqual(["coffee"]);
  const table = await tableOf(el);
  table.shadowRoot!.querySelector<HTMLElement>(".tree-toggle")!.click();
  await table.updateComplete;
  expect(await rowKeys(el)).toEqual(["coffee", "coffee:large"]);
});

it.each(["en-GB", "es-ES"])(
  "keeps the search field usable at phone width in %s",
  async (locale) => {
    const { page } = await import("vitest/browser");
    await page.viewport(390, 640);
    setLocale(locale);
    try {
      const el = await mountBrowser();
      setLocale(locale);
      el.requestUpdate();
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector('[name="catalogue-search"]')!.getBoundingClientRect().width,
      ).toBeGreaterThanOrEqual(el.getBoundingClientRect().width * 0.9);
    } finally {
      await page.viewport(1280, 720);
      setLocale("en-GB");
    }
  },
);

export async function press(el: CatalogueBrowser, action: string) {
  const button = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${action}"]`);
  expect(button, action).not.toBeNull();
  button!.click();
  await el.updateComplete;
}
export async function selectKeys(el: CatalogueBrowser, keys: string[]) {
  await press(el, "select");
  for (const key of keys) {
    const checkbox = (await tableOf(el)).shadowRoot!.querySelector<HTMLInputElement>(
      `tr[data-row-key="${key}"] input[type="checkbox"]`,
    );
    expect(checkbox, key).not.toBeNull();
    checkbox!.click();
    await el.updateComplete;
  }
}
export const dialog = (el: CatalogueBrowser) => el.shadowRoot!.querySelector("wt-modal");
const count = (el: CatalogueBrowser) =>
  el.shadowRoot!.querySelector('[data-test="selected-count"]')?.textContent?.trim();
export async function destination(el: CatalogueBrowser, value: string) {
  el.shadowRoot!.querySelector("wt-combobox")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
  await el.updateComplete;
}
it("selects folders and products but never variants", async () => {
  const el = await mountBrowser({
    folderId: "d",
    products: [
      {
        ...PRODUCTS[0]!,
        variants: [
          {
            id: "v",
            name: "Large",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: null,
            active: true,
            available: true,
            effective: { unitPrice: "2.00", vatClass: "reduced", primaryCategoryId: "d" },
          },
        ],
      },
    ],
  });
  await selectKeys(el, ["folder:b", "cola"]);
  const table = await tableOf(el);
  table.shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="cola"] .tree-toggle')?.click();
  await table.updateComplete;
  expect(table.shadowRoot!.querySelector('tr[data-row-key="cola:v"]')).not.toBeNull();
  expect(
    table.shadowRoot!.querySelector('tr[data-row-key="cola:v"] input[type="checkbox"]'),
  ).toBeNull();
  expect(count(el)).toBe("2 selected");
});
it.each(["cancel-selection", "folder", "view", "search", "filter"])(
  "clears selection on %s and keeps selection mode on",
  async (trigger) => {
    const el = await mountBrowser();
    await selectKeys(el, ["bread"]);
    if (trigger === "cancel-selection") await press(el, trigger);
    if (trigger === "folder") el.folderId = "d";
    if (trigger === "view") el.view = "all";
    if (trigger === "search") await typeSearch(el, "bread");
    if (trigger === "filter") await chooseFilter(el, "active", "inactive");
    await el.updateComplete;
    expect(count(el)).toBe("0 selected");
    expect((await tableOf(el)).selectable).toBe(true);
    expect(
      el.shadowRoot!.querySelector("[data-test=move]")!.getAttribute("disabled"),
    ).not.toBeNull();
  },
);
it("requires a move destination, excludes selected folders and descendants, and clears after success", async () => {
  const el = await mountBrowser();
  await selectKeys(el, ["folder:d", "bread"]);
  await press(el, "move");
  const combo = el.shadowRoot!.querySelector("wt-combobox")!;
  expect(combo.required).toBe(true);
  expect(combo.value).toBe("");
  expect(combo.options).toEqual([
    { value: "top", label: "All products (top level)" },
    { value: "f", label: "Food" },
  ]);
  expect(
    el.shadowRoot!.querySelector("[data-test=confirm]")!.getAttribute("disabled"),
  ).not.toBeNull();
  await destination(el, "f");
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledWith(
      { productIds: ["bread"], categoryIds: ["d"] },
      "f",
    ),
  );
  await vi.waitFor(() => expect(dialog(el)).toBeNull());
  expect(count(el)).toBe("0 selected");
});
it("moves products to the explicitly chosen top level", async () => {
  const el = await mountBrowser();
  await selectKeys(el, ["bread"]);
  await press(el, "move");
  await destination(el, "top");
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledWith(
      { productIds: ["bread"], categoryIds: [] },
      null,
    ),
  );
});
it("deletes only completely summarised empty folders without asking", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders).mockResolvedValue([
    { id: "f", folders: 0, products: 0, routes: 0 },
  ]);
  await selectKeys(el, ["folder:f"]);
  await press(el, "delete");
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenCalledWith(
      { productIds: [], categoryIds: ["f"] },
      "move_up",
    ),
  );
  expect(dialog(el)).toBeNull();
  expect(count(el)).toBe("0 selected");
});
it.each(["network", "missing", "partial"])(
  "keeps deletion disabled on %s summary",
  async (state) => {
    const el = await mountBrowser();
    if (state === "network")
      vi.mocked(el.api.summariseFolders).mockRejectedValue(new Error("network"));
    else
      vi.mocked(el.api.summariseFolders).mockResolvedValue(
        state === "missing" ? [] : [{ id: "d", folders: 0, products: 0, routes: 0 }],
      );
    await selectKeys(el, ["folder:d", "folder:f"]);
    await press(el, "delete");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull());
    expect(
      el.shadowRoot!.querySelector("[data-test=confirm]")!.getAttribute("disabled"),
    ).not.toBeNull();
    expect(el.api.deleteCatalogueItems).not.toHaveBeenCalled();
  },
);
it("shows folder contents and routes, defaults to moving up, and sends delete choice", async () => {
  const el = await mountBrowser();
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("1 folder and 2 products"));
  expect(el.shadowRoot!.textContent).toContain("1 kitchen routing rule names");
  const radio = el.shadowRoot!.querySelector<HTMLInputElement>("input[value=delete]")!;
  expect(el.shadowRoot!.querySelector<HTMLInputElement>("input[value=move_up]")!.checked).toBe(
    true,
  );
  radio.click();
  await el.updateComplete;
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenCalledWith(
      { productIds: [], categoryIds: ["d"] },
      "delete",
    ),
  );
});
it("deletes a folder through its own row action", async () => {
  const el = await mountBrowser();
  (await tableOf(el))
    .shadowRoot!.querySelector<HTMLElement>('[data-test="delete-folder-d"]')!
    .click();
  await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenCalledWith(
      { productIds: [], categoryIds: ["d"] },
      "move_up",
    ),
  );
});
it.each([1, 2])("confirms %i product deletion with inactive and sales wording", async (number) => {
  const el = await mountBrowser({ view: "all" });
  await selectKeys(el, number === 1 ? ["bread"] : ["bread", "cola"]);
  await press(el, "delete");
  expect(dialog(el)!.heading).toBe(number === 1 ? "Delete 1 product?" : "Delete 2 products?");
  expect(el.shadowRoot!.textContent).toContain("past sales");
  expect(el.shadowRoot!.textContent).toContain("inactive");
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenCalledWith(
      { productIds: number === 1 ? ["bread"] : ["bread", "cola"], categoryIds: [] },
      "move_up",
    ),
  );
});
it.each(["move", "delete"])(
  "keeps %s refusal open at bottom of body and blocks Escape while busy",
  async (action) => {
    const el = await mountBrowser();
    let reject!: (error: unknown) => void;
    vi.mocked(
      action === "move" ? el.api.moveCatalogueItems : el.api.deleteCatalogueItems,
    ).mockImplementation(
      () =>
        new Promise((_resolve, r) => {
          reject = r;
        }),
    );
    await selectKeys(el, ["bread"]);
    await press(el, action);
    if (action === "move") await destination(el, "f");
    await press(el, "confirm");
    const confirming = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      'wt-button[data-test="confirm"]',
    )!;
    await confirming.updateComplete;
    expect(confirming.shadowRoot!.querySelector("button")!.getAttribute("aria-busy")).toBe("true");
    expect(dialog(el)!.dismissible).toBe(false);
    const cancel = new Event("cancel", { cancelable: true });
    dialog(el)!.shadowRoot!.querySelector("dialog")!.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog(el)!.open).toBe(true);
    reject({ code: "category.parent_cycle" });
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull());
    expect(dialog(el)!.open).toBe(true);
    expect(el.shadowRoot!.querySelector("[role=alert]")!.textContent).toBe(
      "Choose a parent outside this category and its descendants.",
    );
    expect(el.shadowRoot!.querySelector("[role=alert]")!.closest("[slot=footer]")).toBeNull();
    expect(count(el)).toBe("1 selected");
  },
);

it("counts overlapping selected folders once in the delete consent", async () => {
  const el = await mountBrowser();
  await typeSearch(el, "Drinks");
  vi.mocked(el.api.summariseFolders).mockResolvedValue([
    { id: "d", folders: 1, products: 2, routes: 1 },
    { id: "b", folders: 0, products: 1, routes: 1 },
  ]);
  await selectKeys(el, ["folder:d", "folder:b"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("1 folder and 2 products"));
  expect(el.shadowRoot!.textContent).toContain("1 kitchen routing rule names");
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.deleteCatalogueItems).toHaveBeenCalledWith(
      { productIds: [], categoryIds: ["d", "b"] },
      "move_up",
    ),
  );
});
it("shows a spinner and blocks confirmation while summaries are pending", async () => {
  const el = await mountBrowser();
  let resolve!: (
    value: { id: string; folders: number; products: number; routes: number }[],
  ) => void;
  vi.mocked(el.api.summariseFolders).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  expect(el.shadowRoot!.querySelector("wt-spinner")).not.toBeNull();
  expect(dialog(el)).toBeNull();
  expect(el.api.deleteCatalogueItems).not.toHaveBeenCalled();
  resolve([{ id: "d", folders: 1, products: 2, routes: 0 }]);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-spinner")).toBeNull());
  expect(el.shadowRoot!.querySelector("[data-test=confirm]")!.getAttribute("disabled")).toBeNull();
});

it("can move after cancelling a failed delete summary", async () => {
  const el = await mountBrowser();
  vi.mocked(el.api.summariseFolders).mockRejectedValue(new Error("network"));
  await selectKeys(el, ["folder:d"]);
  await press(el, "delete");
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull());
  dialog(el)!.dispatchEvent(new CustomEvent("wt-close"));
  await el.updateComplete;
  await press(el, "move");
  await destination(el, "f");
  expect(el.shadowRoot!.querySelector("[data-test=confirm]")!.getAttribute("disabled")).toBeNull();
  await press(el, "confirm");
  await vi.waitFor(() =>
    expect(el.api.moveCatalogueItems).toHaveBeenCalledWith(
      { productIds: [], categoryIds: ["d"] },
      "f",
    ),
  );
});

it("never opens a confirmation while reading or deleting empty folders and blocks duplicate reads", async () => {
  const el = await mountBrowser();
  let resolve!: (
    value: { id: string; folders: number; products: number; routes: number }[],
  ) => void;
  vi.mocked(el.api.summariseFolders).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  let finish!: () => void;
  vi.mocked(el.api.deleteCatalogueItems).mockImplementation(
    () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  await selectKeys(el, ["folder:f"]);
  await press(el, "delete");
  expect(dialog(el)).toBeNull();
  await press(el, "delete");
  expect(el.api.summariseFolders).toHaveBeenCalledOnce();
  resolve([{ id: "f", folders: 0, products: 0, routes: 0 }]);
  await vi.waitFor(() => expect(el.api.deleteCatalogueItems).toHaveBeenCalledOnce());
  expect(dialog(el)).toBeNull();
  finish();
  await vi.waitFor(() => expect(count(el)).toBe("0 selected"));
});

it("places dialog Cancel on the left and its primary action on the right", async () => {
  const el = await mountBrowser();
  await selectKeys(el, ["bread"]);
  await press(el, "delete");
  const modal = dialog(el)!;
  await modal.updateComplete;
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  await actions.updateComplete;
  const buttons = actions.querySelectorAll("wt-button");
  await Promise.all([...buttons].map((button) => button.updateComplete));
  const midpoint =
    (modal.shadowRoot!.querySelector("dialog")!.getBoundingClientRect().left +
      modal.shadowRoot!.querySelector("dialog")!.getBoundingClientRect().right) /
    2;
  expect(buttons[0]!.getBoundingClientRect().right).toBeLessThan(midpoint);
  expect(buttons[1]!.getBoundingClientRect().left).toBeGreaterThan(midpoint);
});
