import type { LitElement } from "lit";
import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CatalogueSummary,
  CategorySummary,
  DashboardApi,
  ExtraList,
  ExtraListInput,
  SectionDetails,
  MenuStructure,
  OptionList,
  OptionListInput,
  Product,
  ProductEditorInput,
  ProductEditorValue,
  Unit,
} from "../api/client.js";
import type { ProductChildKind } from "../state/product-child-create.js";
import type { AddToMenus } from "../widgets/add-to-menus.js";
import type { ProductEditor } from "../widgets/product-editor.js";
import type { CatalogueBrowser } from "../widgets/catalogue-browser.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "../widgets/test-helpers.js";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { CatalogueScreen } from "./catalogue-screen.js";

const catalogues: CatalogueSummary[] = [
  { id: "cat-a", name: "Comida", active: true, version: 1 },
  { id: "cat-b", name: "Bebidas", active: true, version: 1 },
];
const categories: CategorySummary[] = [{ id: "c1", name: "Entrantes", parentId: null }];
const units: Unit[] = [
  { id: "u1", name: { es: "unidad" }, abbreviation: { es: "u" }, precision: 0 },
];
// The two kinds of modifier list the product editor attaches. Staff, customer-facing and kitchen
// names differ in each, so an assertion on the editor's rows can tell which one a surface read.
const extraLists: ExtraList[] = [
  {
    id: "ex-1",
    name: "Salsas",
    customerName: { es: "Elige una salsa" },
    kitchenName: "SALSA",
    minPicks: 0,
    maxPicks: null,
    active: true,
    items: [],
  },
];
const optionLists: OptionList[] = [
  {
    id: "opt-list-1",
    name: "Punto",
    customerName: { es: "Punto de la carne" },
    kitchenName: "PUNTO",
    defaultLabelId: null,
    active: true,
    labels: [],
  },
];
const extraInput: ExtraListInput = {
  name: "Panes",
  customerName: null,
  kitchenName: null,
  minPicks: 0,
  maxPicks: null,
  active: true,
  items: [],
};
const optionInput: OptionListInput = {
  name: "Corte",
  customerName: null,
  kitchenName: null,
  defaultLabelId: null,
  active: true,
  labels: [],
};
const products: Product[] = [
  {
    id: "p1",
    modifiers: [],
    catalogueId: "cat-a",
    categoryId: "c1",
    primaryCategoryId: "c1",
    name: "Croquetas",
    customerName: { es: "Croquetas caseras de jamón" },
    unitId: "u1",
    unit: { id: "u1", name: { es: "Unidad" }, precision: 0, abbreviation: { es: "ud" } },
    description: null,
    kitchenName: null,
    dietaryDeclarations: [],
    pricingUnit: "each",
    unitPrice: "8.50",
    vatClass: "reduced",
    active: true,
    available: true,
    ordering: "public",
    allergens: null,
    dietOverride: null,
    manualAllergens: null,
    image: null,
    variants: [],
  },
];
const value: ProductEditorValue = {
  id: "p1",
  parentId: null,
  inherited: null,
  name: "Croquetas",
  customerName: { es: "Croquetas caseras de jamón" },
  description: { es: "Cremosas" },
  kitchenName: "CROQUETAS",
  image: null,
  unitId: "u1",
  unitPrice: "8.50",
  active: true,
  available: true,
  ordering: "public",
  vatClass: "reduced",
  variants: [],
  primaryCategoryId: "c1",
  // One attachment the editor's Modifiers section shows, so the tests below can tell an unrelated
  // save carrying it back untouched from one that wipes it.
  modifiers: [{ kind: "options", id: "opt-list-1" }],
  allergens: {},
  dietaryDeclarations: ["vegetarian"],
  courseId: null,
};

// Drinks is on both menus. A section's customer-facing name differs from its internal one, so the
// Add to menus step reading the wrong one shows text the assertions refuse.
const drinksNode = {
  memberId: "m-drinks",
  ref: { kind: "section" as const, sectionId: "s-drinks" },
  internalName: "Drinks list",
  names: {},
  image: null,
  color: null,
  ownerMenuId: "menu-lunch",
  children: [
    {
      memberId: "m-beer",
      ref: { kind: "section" as const, sectionId: "s-beer" },
      internalName: "Beer list",
      names: {},
      image: null,
      color: null,
      ownerMenuId: "menu-lunch",
      children: [],
    },
  ],
};
const structures: Record<string, MenuStructure> = {
  "cat-a": {
    rootSectionId: "root-a",
    root: {
      id: "root-a",
      internalName: "Lunch Menu",
      names: {},
      image: null,
      color: null,
      members: [],
    },
    includable: [],
    includedBy: [],
    nodes: [drinksNode],
  },
  "cat-b": {
    rootSectionId: "root-b",
    root: {
      id: "root-b",
      internalName: "Lunch Menu",
      names: {},
      image: null,
      color: null,
      members: [],
    },
    includable: [],
    includedBy: [],
    nodes: [drinksNode],
  },
};
const sections: SectionDetails[] = [
  {
    id: "s-drinks",
    internalName: "Drinks list",
    names: { es: "Bebidas frías" },
    image: null,
    color: null,
    members: [],
  },
  {
    id: "s-beer",
    internalName: "Beer list",
    names: { es: "Cervezas de barril" },
    image: null,
    color: null,
    members: [],
  },
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  const api = {
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    listCatalogues: vi.fn().mockResolvedValue(catalogues),
    listCategories: vi.fn().mockResolvedValue(categories),
    listUnits: vi.fn().mockResolvedValue(units),
    listExtraLists: vi.fn().mockResolvedValue(extraLists),
    listOptionLists: vi.fn().mockResolvedValue(optionLists),
    createExtraList: vi.fn().mockResolvedValue({ ...extraLists[0], id: "ex-new", name: "Panes" }),
    createOptionList: vi
      .fn()
      .mockResolvedValue({ ...optionLists[0], id: "opt-new", name: "Corte" }),
    updateExtraList: vi.fn().mockResolvedValue(extraLists[0]),
    updateOptionList: vi.fn().mockResolvedValue(optionLists[0]),
    listStations: vi.fn().mockResolvedValue([]),
    listCourses: vi.fn().mockResolvedValue([]),
    listProducts: vi
      .fn()
      .mockImplementation((id: string) => Promise.resolve(id === "cat-a" ? products : [])),
    listMadeAt: vi.fn().mockResolvedValue({
      [products[0]!.id]: {
        stationId: "bar",
        stationName: "Bar",
        noPreparation: false,
        noReplacement: false,
        variesByZone: false,
      },
    }),
    getFolderRouting: vi.fn().mockResolvedValue({
      claims: [],
      exceptions: [],
      unassigned: { folders: [], products: [] },
      defaultStationId: null,
      stations: [],
    }),
    getProductEditor: vi.fn().mockResolvedValue(value),
    createProductEditor: vi.fn().mockResolvedValue({ ...value, id: "new" }),
    updateProductEditor: vi.fn().mockResolvedValue(value),
    getMenuStructure: vi.fn().mockImplementation((id: string) => Promise.resolve(structures[id])),
    listSections: vi.fn().mockResolvedValue(sections),
    addSectionProducts: vi.fn().mockResolvedValue({ added: 1 }),
    createUnit: vi.fn().mockResolvedValue({
      id: "u2",
      name: { es: "ración" },
      abbreviation: { es: "ra" },
      precision: 2,
    }),
    createCategory: vi.fn().mockResolvedValue({
      id: "c2",
      name: { es: "Postres" },
      image: null,
      parentId: null,
    }),
    ...overrides,
  } as unknown as DashboardApi;
  Object.defineProperty(api, "background", { get: () => api });
  return api;
}

async function flush(el: CatalogueScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}
const editor = (el: CatalogueScreen): ProductEditor =>
  el.shadowRoot!.querySelector("dashboard-product-editor")!;
const step = (el: CatalogueScreen): AddToMenus =>
  el.shadowRoot!.querySelector("dashboard-add-to-menus")!;
const list = (el: CatalogueScreen): CatalogueBrowser =>
  el.shadowRoot!.querySelector("dashboard-catalogue-browser")!;
function emit(source: Element, type: string, detail: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

afterEach(cleanupWidgets);

describe("catalogue-screen", () => {
  it("loads all product editor libraries and de-duplicates products from every menu", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect(api.listUnits).toHaveBeenCalledOnce();
    expect(api.listCategories).toHaveBeenCalledOnce();
    expect(api.listProducts).toHaveBeenCalledWith("cat-a");
    expect(api.listProducts).toHaveBeenCalledWith("cat-b");
    expect(api.listMadeAt).toHaveBeenCalledOnce();
    expect(api.getFolderRouting).toHaveBeenCalledOnce();
    expect(list(el).routing).toMatchObject({ claims: [], defaultStationId: null });
    expect(list(el).madeAt[products[0]!.id]?.stationName).toBe("Bar");
    expect(list(el).products).toEqual(products);
    expect(el.shadowRoot!.querySelector('select[name="product-catalogue"]')).toBeNull();
  });

  it("keeps products available when the optional folder routing read is refused", async () => {
    const api = stubApi({
      getFolderRouting: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect(list(el).products).toEqual(products);
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
    expect(list(el).routing).toBeNull();
  });

  it("leaves the content languages to their own Settings page while still handing them to the editor", async () => {
    const api = stubApi({
      getContentLanguages: vi
        .fn()
        .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=add-language]")).toBeNull();
    expect(el.shadowRoot!.querySelector("dashboard-add-content-language")).toBeNull();
    expect(editor(el).locales).toEqual(["es", "en"]);
  });

  // Delete makes the product Inactive and leaves its availability as it was.
  it("confirms Delete and makes the product Inactive without deleting its history", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "delete-product", { productId: "p1" });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-dialog]")).not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await flush(el);
    expect(api.getProductEditor).toHaveBeenCalledWith("p1");
    expect(api.updateProductEditor).toHaveBeenCalledWith("p1", {
      ...value,
      active: false,
      available: true,
    });
  });

  it("keeps the Delete confirmation open and reports a refused deactivation inside it", async () => {
    const api = stubApi({
      updateProductEditor: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "delete-product", { productId: "p1" });
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await flush(el);
    const dialog = el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-dialog]")!;
    expect(dialog.getAttribute("open")).not.toBeNull();
    const actions = dialog.querySelector("wt-form-actions")!;
    const message = await formMessageOf(actions);
    expect(message?.textContent).toBe(codeMessage("server.internal"));
    expect(dialog.shadowRoot!.querySelector(".body")!.contains(message)).toBe(true);
    expect(actions.shadowRoot!.querySelector("[data-error]")).toBeNull();
    expect(dialog.textContent).not.toContain(codeMessage("server.internal"));
  });

  it("creates the complete aggregate once, closes, then refreshes the list", async () => {
    let release!: () => void;
    const pending = new Promise<ProductEditorValue>((resolve) => {
      release = () => resolve({ ...value, id: "new" });
    });
    const api = stubApi({ createProductEditor: vi.fn().mockReturnValue(pending) });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-product]")!.click();
    await el.updateComplete;
    emit(editor(el), "wt-submit", { value: value as ProductEditorInput });
    emit(editor(el), "wt-submit", { value: value as ProductEditorInput });
    expect(api.createProductEditor).toHaveBeenCalledOnce();
    release();
    await flush(el);
    expect(editor(el).open).toBe(false);
    expect(api.listProducts).toHaveBeenCalledTimes(4);
  });

  it("loads the aggregate on edit and keeps the editor open after a failed save", async () => {
    const api = stubApi({
      updateProductEditor: vi.fn().mockRejectedValue({ code: "product.invalid" }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    expect(api.getProductEditor).toHaveBeenCalledWith("p1");
    expect(editor(el).value).toEqual(value);
    emit(editor(el), "wt-submit", { value });
    await flush(el);
    expect(editor(el).open).toBe(true);
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBeTruthy();
  });

  it("offers the venue's courses and saves the course inside the product write", async () => {
    const api = stubApi({
      listCourses: vi
        .fn()
        .mockResolvedValue([{ id: "k1", name: "Starters", displayOrder: 0, active: true }]),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    expect(editor(el).courses.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "k1", name: "Starters" },
    ]);
    const routed: ProductEditorInput = { ...value, courseId: "k1" };
    emit(editor(el), "wt-submit", { value: routed });
    await flush(el);
    // The course travels in the same product write.
    expect(api.updateProductEditor).toHaveBeenCalledExactlyOnceWith("p1", routed);
    expect(api.createProductEditor).not.toHaveBeenCalled();
  });

  it("loads both kinds of modifier list and hands them to the product editor", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect(api.listExtraLists).toHaveBeenCalled();
    expect(api.listOptionLists).toHaveBeenCalled();
    expect(editor(el).extraLists).toEqual(extraLists);
    expect(editor(el).optionLists).toEqual(optionLists);
  });

  // The products list names each attached list too, and it is this screen that holds the loaded sets;
  // without them its Modifiers column can only print the missing-choice placeholder.
  it("hands both kinds of modifier list to the products list as well", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect(list(el).extraLists).toEqual(extraLists);
    expect(list(el).optionLists).toEqual(optionLists);
  });

  it("creates an extras list from inside the product editor and attaches it", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "extras" });
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-extra-list-form")!;
    expect(form.open).toBe(true);
    // The extras form offers this screen's products; it neither loads nor filters them itself.
    expect(form.products).toEqual(products);
    emit(form, "wt-submit", { value: extraInput });
    await flush(el);
    expect(api.createExtraList).toHaveBeenCalledWith(extraInput);
    expect(form.open).toBe(false);
    expect(editor(el).currentValue.modifiers).toEqual([
      { kind: "options", id: "opt-list-1" },
      { kind: "extras", id: "ex-new" },
    ]);
    // The list the editor offers has to gain the new one, or it is invisible to the next product.
    expect(api.listExtraLists).toHaveBeenCalledTimes(2);
  });

  it("creates an options list from inside the product editor and attaches it", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "options" });
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-option-list-form")!;
    expect(form.open).toBe(true);
    emit(form, "wt-submit", { value: optionInput });
    await flush(el);
    expect(api.createOptionList).toHaveBeenCalledWith(optionInput);
    expect(form.open).toBe(false);
    expect(editor(el).currentValue.modifiers).toEqual([
      { kind: "options", id: "opt-list-1" },
      { kind: "options", id: "opt-new" },
    ]);
    expect(api.listOptionLists).toHaveBeenCalledTimes(2);
  });

  it("edits an attached list of either kind through its own nested form", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-edit-related", { kind: "options", id: "opt-list-1" });
    await el.updateComplete;
    const options = el.shadowRoot!.querySelector("dashboard-option-list-form")!;
    expect(options.open).toBe(true);
    expect(options.value).toEqual(optionLists[0]);
    emit(options, "wt-submit", { value: optionInput });
    await flush(el);
    expect(api.updateOptionList).toHaveBeenCalledWith("opt-list-1", optionInput);
    expect(api.createOptionList).not.toHaveBeenCalled();
    emit(editor(el), "wt-edit-related", { kind: "extras", id: "ex-1" });
    await el.updateComplete;
    const extras = el.shadowRoot!.querySelector("dashboard-extra-list-form")!;
    expect(extras.open).toBe(true);
    expect(extras.value).toEqual(extraLists[0]);
    emit(extras, "wt-submit", { value: extraInput });
    await flush(el);
    expect(api.updateExtraList).toHaveBeenCalledWith("ex-1", extraInput);
    expect(api.createExtraList).not.toHaveBeenCalled();
    // Editing a list attached to the product changes the list, never what the product carries.
    expect(editor(el).currentValue.modifiers).toEqual([{ kind: "options", id: "opt-list-1" }]);
  });

  // Both nested forms show a refused save themselves, keyed by the field path the server named —
  // the same wiring the Modifiers screen gives them. Without it the form stays open saying nothing.
  it("gives a refused nested list write back to the form that sent it", async () => {
    const refusal = {
      code: "extras.translation_required",
      params: { field: "customerName", language: "es" },
      status: 400,
    };
    const api = stubApi({
      createExtraList: vi.fn().mockRejectedValue(refusal),
      createOptionList: vi.fn().mockRejectedValue({ ...refusal, code: "options.invalid" }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "extras" });
    await el.updateComplete;
    const extras = el.shadowRoot!.querySelector("dashboard-extra-list-form")!;
    emit(extras, "wt-submit", { value: extraInput });
    await flush(el);
    expect(extras.open).toBe(true);
    expect(extras.fieldErrors).toEqual({
      customerName: codeMessage("extras.translation_required"),
    });
    // Nothing was attached and nothing was said behind the modal.
    expect(editor(el).currentValue.modifiers).toEqual([{ kind: "options", id: "opt-list-1" }]);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();

    emit(extras, "wt-cancel", {});
    await flush(el);
    // A refusal belongs to the form that earned it: reopening a form must not inherit the last one.
    expect([extras.open, extras.fieldErrors, editor(el).childOpen]).toEqual([false, {}, false]);
    emit(editor(el), "wt-create-related", { kind: "options" });
    await el.updateComplete;
    const options = el.shadowRoot!.querySelector("dashboard-option-list-form")!;
    expect([options.open, options.fieldErrors, editor(el).childOpen]).toEqual([true, {}, true]);
    emit(options, "wt-submit", { value: optionInput });
    await flush(el);
    expect([options.open, options.fieldErrors]).toEqual([
      true,
      { customerName: codeMessage("options.invalid") },
    ]);
  });

  it("gives a refusal to offer a product with Active variants back to the nested extras form, by item", async () => {
    const api = stubApi({
      createExtraList: vi.fn().mockRejectedValue({
        code: "extras.product_has_variants",
        params: { field: "items.0.productId", productId: "p1" },
        status: 409,
      }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "extras" });
    await el.updateComplete;
    const extras = el.shadowRoot!.querySelector("dashboard-extra-list-form")!;
    emit(extras, "wt-submit", { value: { ...extraInput, items: [{ productId: "p1" }] } });
    await flush(el);
    expect(extras.open).toBe(true);
    expect(extras.fieldErrors).toEqual({
      "items.0.productId": codeMessage("extras.product_has_variants"),
    });
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  });

  it("ignores a closed form's second cancel, which by then belongs to another form", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "extras" });
    await el.updateComplete;
    const extras = el.shadowRoot!.querySelector("dashboard-extra-list-form")!;
    emit(extras, "wt-cancel", {});
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "options" });
    await el.updateComplete;
    const options = el.shadowRoot!.querySelector("dashboard-option-list-form")!;
    expect(options.open).toBe(true);
    emit(extras, "wt-cancel", {});
    await flush(el);
    expect([options.open, extras.open, editor(el).childOpen]).toEqual([true, false, true]);
  });

  async function openNested(api: DashboardApi, kind: ProductChildKind): Promise<CatalogueScreen> {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-create-related", { kind });
    await el.updateComplete;
    return el;
  }
  async function submitNested(
    el: CatalogueScreen,
    form: LitElement,
    value: unknown,
  ): Promise<void> {
    emit(form, "wt-submit", { value });
    await flush(el);
    await form.updateComplete;
  }
  /** A form's one message about a failed submission, or "" when it shows none. */
  async function bottomOf(form: Element): Promise<string> {
    if (form.tagName === "DASHBOARD-CATEGORY-FORM")
      return form.shadowRoot!.querySelector('[role="alert"]')?.textContent?.trim() ?? "";
    const actions = form.shadowRoot!.querySelector("wt-form-actions")!;
    return (await formMessageOf(actions))?.textContent?.trim() ?? "";
  }
  const errorBeside = (form: Element, selector: string): string =>
    form.shadowRoot!.querySelector<HTMLElement & { error: string }>(selector)!.error;

  // The unit and category forms key their errors by their OWN field names, not by the path a refusal
  // carries.
  it("gives a refused nested unit create back to the unit form, beside the field it concerns", async () => {
    const api = stubApi({
      createUnit: vi
        .fn()
        .mockRejectedValueOnce({ code: "unit.precision_invalid", params: {}, status: 400 })
        .mockRejectedValueOnce({
          code: "unit.translation_required",
          params: { field: "abbreviation", language: "es" },
          status: 400,
        }),
    });
    const el = await openNested(api, "unit");
    const form = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    await submitNested(el, form, {
      name: { es: "ración" },
      abbreviation: { es: "ra" },
      precision: 2,
    });
    expect(form.open).toBe(true);
    expect(errorBeside(form, "wt-combobox[name=precision]")).toBe(
      codeMessage("unit.precision_invalid"),
    );
    expect(await bottomOf(form)).toBe(t("form.fix_fields"));
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();

    await submitNested(el, form, { name: { es: "ración" }, abbreviation: {}, precision: 2 });
    expect(errorBeside(form, "[data-test=abbreviation-es]")).toBe(
      codeMessage("unit.translation_required"),
    );
    expect(errorBeside(form, "[data-test=name-es]")).toBe("");
    expect(errorBeside(form, "wt-combobox[name=precision]")).toBe("");
    expect(await bottomOf(form)).toBe(t("form.fix_fields"));
  });

  it("gives a refused nested category create back to the category form, beside the field it concerns", async () => {
    const api = stubApi({
      getContentLanguages: vi
        .fn()
        .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
      createCategory: vi
        .fn()
        .mockRejectedValueOnce({ code: "category.parent_cycle", params: {}, status: 400 })
        .mockRejectedValueOnce({
          code: "category.invalid",
          params: { field: "name" },
          status: 400,
        }),
    });
    const el = await openNested(api, "category");
    const form = el.shadowRoot!.querySelector("dashboard-category-form")!;
    const input = { name: "Postres", parentId: "c1" };
    await submitNested(el, form, input);
    expect(form.open).toBe(true);
    expect(errorBeside(form, "wt-combobox[name=category-parent]")).toBe(
      codeMessage("category.parent_cycle"),
    );
    expect(await bottomOf(form)).toBe(t("form.fix_fields"));
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();

    await submitNested(el, form, input);
    expect(errorBeside(form, "wt-input[name=name]")).toBe(codeMessage("category.invalid"));
    expect(errorBeside(form, "wt-combobox[name=category-parent]")).toBe("");
    expect(await bottomOf(form)).toBe(t("form.fix_fields"));
  });

  it("leaves a nested form's Save working on a refusal beside a field, which stays gone once that field changes", async () => {
    const api = stubApi({
      createUnit: vi
        .fn()
        .mockRejectedValueOnce({ code: "unit.precision_invalid", params: {}, status: 400 }),
    });
    const el = await openNested(api, "unit");
    const form = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    await submitNested(el, form, {
      name: { es: "ración" },
      abbreviation: { es: "ra" },
      precision: 2,
    });
    const save =
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=submit]")!;
    expect(errorBeside(form, "wt-combobox[name=precision]")).not.toBe("");
    expect(save.disabled).toBe(false);

    await chooseOption(form.shadowRoot!.querySelector("wt-combobox[name=precision]")!, "1");
    await form.updateComplete;
    expect(errorBeside(form, "wt-combobox[name=precision]")).toBe("");
    // The screen redrawing for its own reasons does not bring the dismissed refusal back.
    el.requestUpdate();
    await el.updateComplete;
    await form.updateComplete;
    expect(errorBeside(form, "wt-combobox[name=precision]")).toBe("");
  });

  it("puts a nested category create's missing parent beside the parent it chose", async () => {
    const api = stubApi({
      getContentLanguages: vi
        .fn()
        .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
      createCategory: vi.fn().mockRejectedValueOnce({
        code: "category.not_found",
        params: { categoryId: "c1" },
        status: 404,
      }),
    });
    const el = await openNested(api, "category");
    const form = el.shadowRoot!.querySelector("dashboard-category-form")!;
    await submitNested(el, form, {
      name: { es: "Postres", en: "" },
      parentId: "c1",
    });
    expect(errorBeside(form, "wt-combobox[name=category-parent]")).toBe(
      codeMessage("category.not_found"),
    );
    expect(await bottomOf(form)).toBe(t("form.fix_fields"));
  });

  it("still says a nested unit or category refusal that names no field of the form, in its bottom message", async () => {
    const api = stubApi({
      createUnit: vi.fn().mockRejectedValue({ code: "server.internal", status: 500 }),
      createCategory: vi
        .fn()
        .mockRejectedValue({ code: "content.translation_invalid", params: {}, status: 400 }),
    });
    const el = await openNested(api, "unit");
    const unitForm = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    await submitNested(el, unitForm, {
      name: { es: "ración" },
      abbreviation: { es: "ra" },
      precision: 2,
    });
    expect(unitForm.open).toBe(true);
    expect(await bottomOf(unitForm)).toBe(codeMessage("server.internal"));
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();

    emit(unitForm, "wt-cancel", {});
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "category" });
    await el.updateComplete;
    const categoryForm = el.shadowRoot!.querySelector("dashboard-category-form")!;
    await categoryForm.updateComplete;
    // The unit form's refusal is not carried into the next form.
    expect(await bottomOf(categoryForm)).toBe("");
    await submitNested(el, categoryForm, {
      name: { es: "Postres" },
      parentId: null,
      image: null,
      color: null,
    });
    expect(categoryForm.open).toBe(true);
    expect(await bottomOf(categoryForm)).toBe(codeMessage("content.translation_invalid"));
  });

  it("ignores a closed unit form's second cancel once the category form is open", async () => {
    const el = await openNested(stubApi(), "unit");
    const unitForm = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    emit(unitForm, "wt-cancel", {});
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "category" });
    await el.updateComplete;
    const categoryForm = el.shadowRoot!.querySelector("dashboard-category-form")!;
    expect(categoryForm.open).toBe(true);
    emit(unitForm, "wt-cancel", {});
    await flush(el);
    expect([categoryForm.open, unitForm.open, editor(el).childOpen]).toEqual([true, false, true]);
  });

  it("ignores a closed category form's second cancel once the unit form is open", async () => {
    const el = await openNested(stubApi(), "category");
    const categoryForm = el.shadowRoot!.querySelector("dashboard-category-form")!;
    emit(categoryForm, "wt-cancel", {});
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "unit" });
    await el.updateComplete;
    const unitForm = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    expect(unitForm.open).toBe(true);
    emit(categoryForm, "wt-cancel", {});
    await flush(el);
    expect([unitForm.open, categoryForm.open, editor(el).childOpen]).toEqual([true, false, true]);
  });

  // Opened by a real click: opened by a synthetic click with this case run first, one Escape also
  // closed the editor behind it (HeadlessChrome 153; C74).
  it("closes only the unit form when Escape is pressed in it, leaving the product editor open", async () => {
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
      api: stubApi(),
    });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el).shadowRoot!.querySelector("wt-price-input")!, "wt-unit-click", {});
    await editor(el).updateComplete;
    await userEvent.click(
      editor(el).shadowRoot!.querySelector<HTMLElement>("[data-test=add-unit]")!,
    );
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    expect(form.open).toBe(true);
    let cancels = 0;
    form.addEventListener("wt-cancel", () => cancels++);

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(cancels).toBe(1));
    await flush(el);
    await closeReportsDelivered();

    expect(form.open).toBe(false);
    expect(editor(el).open).toBe(true);
    expect(cancels).toBe(1);
  });

  it("reports a refused attachment inside the editor, not behind it", async () => {
    const api = stubApi({
      updateProductEditor: vi.fn().mockRejectedValue({
        code: "product.invalid",
        params: { field: "modifiers.0.id" },
        status: 400,
      }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-submit", { value });
    await flush(el);
    expect(editor(el).open).toBe(true);
    expect(editor(el).fieldErrors).toEqual({ modifier: t("editor.field_rejected") });
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  });

  it("reports a refused save beside the field the server named, and clears it on the next product", async () => {
    const api = stubApi({
      updateProductEditor: vi.fn().mockRejectedValue({
        code: "product.invalid",
        params: { field: "kitchenName" },
        status: 400,
      }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-submit", { value });
    await flush(el);
    expect(editor(el).open).toBe(true);
    expect(editor(el).fieldErrors).toEqual({ "kitchen-name": t("editor.field_rejected") });
    // The refusal is said ONCE, beside the field — the screen's own banner is for a refusal with
    // nothing to point at.
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    await editor(el).updateComplete;
    // …and the section holding that field is no longer folded over it.
    const kitchen = editor(el).shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
      '[data-section="kitchen"]',
    )!;
    expect(kitchen.open).toBe(true);
    emit(editor(el), "wt-cancel", {});
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    expect(editor(el).fieldErrors).toEqual({});
  });

  // Each of these codes names the missing thing by id; the editor holds the one field that chose it.
  it.each([
    ["category.not_found", { categoryId: "c1" }, "primary"],
    ["unit.not_found", { unitId: "u1" }, "unit"],
    ["course.not_found", { courseId: "k1" }, "product-course"],
    ["product.variant_not_found", { variantId: "v2" }, "variant-1-name"],
  ])(
    "puts %s beside the editor field that chose it, leaving Save working",
    async (code, params, field) => {
      const variant = {
        customerName: null,
        kitchenName: null,
        image: null,
        unitPrice: null,
        available: true,
        active: true,
      };
      const sent = {
        ...value,
        courseId: "k1",
        variants: [
          { ...variant, id: "v1", name: "Media" },
          { ...variant, id: "v2", name: "Entera" },
        ],
      };
      const api = stubApi({
        getProductEditor: vi.fn().mockResolvedValue(sent),
        updateProductEditor: vi.fn().mockRejectedValue({ code, params, status: 404 }),
      });
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "edit-product", { productId: "p1" });
      await flush(el);
      emit(editor(el), "wt-submit", { value: sent });
      await flush(el);
      expect(editor(el).fieldErrors).toEqual({ [field]: codeMessage(code) });
      expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
      await editor(el).updateComplete;
      expect(
        editor(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
          "[data-test=save]",
        )!.disabled,
      ).toBe(false);
    },
  );

  it("keeps a missing id the save did not send for the screen's banner", async () => {
    const api = stubApi({
      updateProductEditor: vi
        .fn()
        .mockRejectedValue({ code: "category.not_found", params: { categoryId: "c9" } }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-submit", { value });
    await flush(el);
    expect(editor(el).fieldErrors).toEqual({});
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBeTruthy();
  });

  it("falls back to the screen's banner when a refusal names a field with no error display", async () => {
    const api = stubApi({
      updateProductEditor: vi.fn().mockRejectedValue({
        code: "product.invalid",
        params: { field: "available" },
        status: 400,
      }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-submit", { value });
    await flush(el);
    expect(editor(el).fieldErrors).toEqual({});
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBeTruthy();
  });

  it("reports a refused translation beside the input for the language the server named", async () => {
    // The default content language is English and the product carries only a Spanish customer name,
    // which is what the real save refuses: it names the missing LANGUAGE, never a field.
    const api = stubApi({
      getContentLanguages: vi
        .fn()
        .mockResolvedValue({ defaultLanguage: "en", languages: ["en", "es"] }),
      updateProductEditor: vi.fn().mockRejectedValue({
        code: "content.translation_required",
        params: { language: "en" },
        status: 400,
      }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-submit", { value });
    await flush(el);
    expect(editor(el).open).toBe(true);
    expect(editor(el).fieldErrors).toEqual({
      "customer-name-en": codeMessage("content.translation_required"),
    });
    // Said once, beside the field — the screen's banner renders behind the open editor.
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    await editor(el).updateComplete;
    const descriptors = editor(el).shadowRoot!.querySelector<HTMLElement & { open: boolean }>(
      '[data-section="descriptors"]',
    )!;
    await expect.poll(() => descriptors.open).toBe(true);
    await expect
      .poll(() => editor(el).shadowRoot!.activeElement?.getAttribute("name"))
      .toBe("customer-name-en");
    const input = editor(el).shadowRoot!.querySelector("[name=customer-name-en]") as unknown as {
      error: string;
      invalid: boolean;
    };
    expect(input).toMatchObject({
      error: codeMessage("content.translation_required"),
      invalid: true,
    });
    expect(await bottomOf(editor(el))).toBe(t("form.fix_fields"));
    expect(
      editor(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!
        .disabled,
    ).toBe(false);
  });

  it("marks the variant whose translation the save refused, and reaches its window", async () => {
    const variants = [
      {
        name: "Media",
        customerName: { en: "Half", es: "Media" },
        kitchenName: null,
        image: null,
        unitPrice: "4.50",
        available: true,
        active: true,
      },
      {
        name: "Entera",
        customerName: { es: "Ración entera" },
        kitchenName: null,
        image: null,
        unitPrice: "8.50",
        available: true,
        active: true,
      },
    ];
    // The product's own customer name is complete, so the only value missing English is the second
    // variant's — the editor must not point at a field that is fine.
    const product = { ...value, customerName: { en: "Croquettes", es: "Croquetas" }, variants };
    const api = stubApi({
      getContentLanguages: vi
        .fn()
        .mockResolvedValue({ defaultLanguage: "en", languages: ["en", "es"] }),
      getProductEditor: vi.fn().mockResolvedValue(product),
      updateProductEditor: vi.fn().mockRejectedValue({
        code: "content.translation_required",
        params: { language: "en" },
        status: 400,
      }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-submit", { value: product });
    await flush(el);
    expect(editor(el).fieldErrors).toEqual({
      "variant-1-name": codeMessage("content.translation_required"),
    });
    await editor(el).updateComplete;
    const table = editor(el).shadowRoot!.querySelector("dashboard-variant-table")!;
    await table.updateComplete;
    expect(table.shadowRoot!.querySelector("[data-test=error-1]")?.textContent).toContain(
      codeMessage("content.translation_required"),
    );
    // A variant's names are only editable in its own window, so focus lands on the row's actions —
    // the way into it. Every other control on the row belongs to a different variant or a different
    // value.
    await expect
      .poll(() => table.shadowRoot!.activeElement?.getAttribute("data-test"))
      .toBe("actions-1");
  });

  it("puts a refusal to give an offered product an Active variant beside that variant, naming the lists", async () => {
    const variant = {
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice: null,
      available: true,
    };
    const product = {
      ...value,
      variants: [
        { ...variant, id: "v1", name: "Media", active: false },
        { ...variant, name: "Entera", active: true },
      ],
    };
    const api = stubApi({
      getProductEditor: vi.fn().mockResolvedValue(product),
      updateProductEditor: vi.fn().mockRejectedValue({
        code: "product.offered_as_extra",
        params: {
          field: "variants.1.active",
          extraLists: [
            { id: "ex-1", name: "Salsas" },
            { id: "ex-2", name: "Toppings" },
          ],
        },
        status: 409,
      }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-submit", { value: product });
    await flush(el);
    expect(editor(el).open).toBe(true);
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    await editor(el).updateComplete;
    const table = editor(el).shadowRoot!.querySelector("dashboard-variant-table")!;
    await table.updateComplete;
    const error = table.shadowRoot!.querySelector("[data-test=error-1]")?.textContent ?? "";
    expect(error).toContain(codeMessage("product.offered_as_extra"));
    expect(error).toContain("Salsas");
    expect(error).toContain("Toppings");
    expect(table.shadowRoot!.querySelector("[data-test=error-0]")).toBeNull();
  });

  it("closes after a successful write even when the product refresh fails", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    vi.mocked(api.listProducts).mockRejectedValueOnce({ code: "server.internal" });
    emit(editor(el), "wt-submit", { value });
    await flush(el);
    expect(editor(el).open).toBe(false);
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toBeTruthy();
  });

  it("creates a related unit without replacing the dirty parent draft", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-product]")!.click();
    await el.updateComplete;
    const before = { ...editor(el).currentValue, name: "Borrador" };
    (editor(el) as unknown as { draft: ProductEditorInput }).draft = before;
    emit(editor(el), "wt-create-related", { kind: "unit" });
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-unit-form")!;
    expect(form.open).toBe(true);
    emit(form, "wt-submit", { value: { name: { es: "ración" }, precision: 2 } });
    await flush(el);
    expect(editor(el).currentValue.name).toBe("Borrador");
    expect(editor(el).currentValue.unitId).toBe("u2");
  });

  it("offers the new-category form, with its one name field, before the content languages load", async () => {
    const api = stubApi({
      getContentLanguages: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "category" });
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-category-form")!;
    expect(form.open).toBe(true);
    await form.updateComplete;
    const names = [...form.shadowRoot!.querySelectorAll("wt-input")].map((input) =>
      input.getAttribute("name"),
    );
    expect(names).toEqual(["name"]);
  });

  it("ignores a late product response after the editor is cancelled", async () => {
    let resolve!: (value: ProductEditorValue) => void;
    const api = stubApi({
      getProductEditor: vi.fn().mockReturnValue(new Promise((done) => (resolve = done))),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    emit(editor(el), "wt-cancel", {});
    resolve(value);
    await flush(el);
    expect(editor(el).open).toBe(false);
  });

  it("opens the product named in the address", async () => {
    history.replaceState(null, "", "/manage/catalogue/product/p1");
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect((el as unknown as { editorOpen: boolean }).editorOpen).toBe(true);
  });

  it("ignores an unknown product id", async () => {
    history.replaceState(
      null,
      "",
      "/manage/catalogue/product/00000000-0000-4000-8000-000000000000",
    );
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect((el as unknown as { editorOpen: boolean }).editorOpen).toBe(false);
  });
  describe("a variant's own page", () => {
    // Listed under its parent only: the list read nests variants, and nothing lists one at the top.
    const withVariant: Product[] = [
      {
        ...products[0]!,
        variants: [
          {
            id: "v1",
            name: "Media ración",
            customerName: { es: "Media ración de croquetas" },
            kitchenName: "1/2 CROQ",
            image: null,
            unitPrice: null,
            available: true,
            active: true,
            effective: {
              unitPrice: "8.50",
              vatClass: "reduced",
              primaryCategoryId: "c1",
            },
          },
        ],
      },
    ];
    const variantValue: ProductEditorValue = {
      ...value,
      id: "v1",
      parentId: "p1",
      name: "Media ración",
      customerName: { es: "Media ración de croquetas" },
      kitchenName: "1/2 CROQ",
      description: null,
      unitId: null,
      unitPrice: null,
      vatClass: null,
      primaryCategoryId: null,
      modifiers: [],
      allergens: null,
      dietaryDeclarations: null,
      inherited: {
        description: { es: "Cremosas" },
        image: null,
        unitPrice: "8.50",
        vatClass: "reduced",
        unitId: "u1",
        primaryCategoryId: "c1",
        courseId: null,
        allergens: {},
        dietaryDeclarations: ["vegetarian"],
      },
    };
    const variantApi = () =>
      stubApi({
        listProducts: vi
          .fn()
          .mockImplementation((id: string) => Promise.resolve(id === "cat-a" ? withVariant : [])),
        getProductEditor: vi
          .fn()
          .mockImplementation((id: string) => Promise.resolve(id === "v1" ? variantValue : value)),
      });

    it("opens the variant named in the address", async () => {
      history.replaceState(null, "", "/manage/catalogue/product/v1");
      const api = variantApi();
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      expect(api.getProductEditor).toHaveBeenCalledWith("v1");
      expect(editor(el).open).toBe(true);
      expect(editor(el).value).toEqual(variantValue);
    });

    it("opens a variant's page from its parent's variants section, and saves to the variant", async () => {
      history.replaceState(null, "", "/manage/catalogue");
      const api = variantApi();
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "edit-product", { productId: "p1" });
      await flush(el);
      emit(editor(el), "wt-open-product", { productId: "v1" });
      await flush(el);
      expect(editor(el).value).toEqual(variantValue);
      expect(location.pathname).toBe("/manage/catalogue/product/v1");
      emit(editor(el), "wt-submit", { value: variantValue });
      await flush(el);
      expect(api.updateProductEditor).toHaveBeenCalledWith("v1", variantValue);
    });

    // Opening the variant shuts the parent's window first, and the browser reports that shut a task
    // later. Neither a report that lands while the variant is still loading, nor one that lands
    // after the variant's window is already showing, is the person cancelling.
    it("keeps a variant opened from its parent when its load outlasts the parent's window closing", async () => {
      history.replaceState(null, "", "/manage/catalogue");
      const api = variantApi();
      let release!: () => void;
      const loaded = new Promise<ProductEditorValue>((resolve) => {
        release = () => resolve(variantValue);
      });
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "edit-product", { productId: "p1" });
      await flush(el);
      vi.mocked(api.getProductEditor).mockReturnValue(loaded);
      emit(editor(el), "wt-open-product", { productId: "v1" });
      await flush(el);
      await closeReportsDelivered();
      release();
      await flush(el);
      expect(editor(el).open).toBe(true);
      expect(editor(el).value).toEqual(variantValue);
      expect(location.pathname).toBe("/manage/catalogue/product/v1");
    });

    it("keeps a variant opened from its parent when it loads before the closed window reports", async () => {
      history.replaceState(null, "", "/manage/catalogue");
      const api = variantApi();
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "edit-product", { productId: "p1" });
      await flush(el);
      // Long enough for the parent's window to have shut, short enough to finish inside the task.
      vi.mocked(api.getProductEditor).mockImplementation(async () => {
        for (let turn = 0; turn < 30; turn++) await Promise.resolve();
        return variantValue;
      });
      emit(editor(el), "wt-open-product", { productId: "v1" });
      await flush(el);
      await closeReportsDelivered();
      await el.updateComplete;
      expect(editor(el).open).toBe(true);
      expect(editor(el).value).toEqual(variantValue);
      expect(location.pathname).toBe("/manage/catalogue/product/v1");
    });

    // Removing a variant makes it Inactive, through its own page's write, and leaves its availability
    // and every other stored value as they were.
    it("confirms a variant's Remove and makes the variant Inactive through its own write", async () => {
      history.replaceState(null, "", "/manage/catalogue");
      const api = variantApi();
      // Sold out as well, so a write that resets availability while removing is caught.
      vi.mocked(api.getProductEditor).mockImplementation((id: string) =>
        Promise.resolve(id === "v1" ? { ...variantValue, available: false } : value),
      );
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "delete-product", { productId: "v1" });
      await el.updateComplete;
      const dialog = el.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-dialog]")!;
      expect(dialog.getAttribute("heading")).toBe(
        t("product.remove_variant_named").replace("{name}", "Media ración"),
      );
      expect(dialog.textContent).toContain(t("product.remove_variant_warning"));
      const confirm = el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!;
      expect(confirm.textContent!.trim()).toBe(t("action.remove"));
      confirm.click();
      await flush(el);
      expect(api.getProductEditor).toHaveBeenCalledWith("v1");
      expect(api.updateProductEditor).toHaveBeenCalledOnce();
      expect(api.updateProductEditor).toHaveBeenCalledWith("v1", {
        ...variantValue,
        active: false,
        available: false,
      });
      expect(dialog.getAttribute("open")).toBeNull();
    });

    it("restores a removed variant through its own write, then refreshes the list", async () => {
      history.replaceState(null, "", "/manage/catalogue");
      const api = variantApi();
      vi.mocked(api.getProductEditor).mockImplementation((id: string) =>
        Promise.resolve(id === "v1" ? { ...variantValue, active: false } : value),
      );
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      vi.mocked(api.listProducts).mockClear();
      emit(list(el), "restore-product", { productId: "v1" });
      await flush(el);
      expect(api.updateProductEditor).toHaveBeenCalledOnce();
      expect(api.updateProductEditor).toHaveBeenCalledWith("v1", { ...variantValue, active: true });
      expect(api.listProducts).toHaveBeenCalled();
      expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    });

    // A restore that was written and then could not reload the list is a load failure: the banner
    // says why the list is stale, and the restore is not attempted again.
    it("reports a failed reload after a written restore as a load failure", async () => {
      history.replaceState(null, "", "/manage/catalogue");
      const api = variantApi();
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      vi.mocked(api.listProducts).mockRejectedValue({ code: "catalogue.not_found" });
      emit(list(el), "restore-product", { productId: "v1" });
      await flush(el);
      expect(api.updateProductEditor).toHaveBeenCalledOnce();
      expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toContain(
        codeMessage("catalogue.not_found"),
      );
      expect((el as unknown as { busy: boolean }).busy).toBe(false);
    });

    it("names the extras lists that refuse a variant's restore", async () => {
      history.replaceState(null, "", "/manage/catalogue");
      const api = variantApi();
      vi.mocked(api.updateProductEditor).mockRejectedValue({
        code: "product.offered_as_extra",
        params: { field: "active", extraLists: [{ id: "ex-1", name: "Salsas" }] },
        status: 409,
      });
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "restore-product", { productId: "v1" });
      await flush(el);
      const banner = el.shadowRoot!.querySelector("[role=alert]")?.textContent ?? "";
      expect(banner).toContain(codeMessage("product.offered_as_extra"));
      expect(banner).toContain("Salsas");
    });

    it("names the extras lists that refuse a restore inside the variant's own editor", async () => {
      history.replaceState(null, "", "/manage/catalogue/product/v1");
      const api = variantApi();
      vi.mocked(api.getProductEditor).mockResolvedValue({ ...variantValue, active: false });
      vi.mocked(api.updateProductEditor).mockRejectedValue({
        code: "product.offered_as_extra",
        params: {
          field: "active",
          extraLists: [
            { id: "ex-1", name: "Salsas" },
            { id: "ex-2", name: "Toppings" },
          ],
        },
        status: 409,
      });
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      editor(el).shadowRoot!.querySelector<HTMLElement>("[data-test=restore]")!.click();
      await flush(el);
      expect(api.updateProductEditor).toHaveBeenCalledWith(
        "v1",
        expect.objectContaining({ active: true }),
      );
      expect(editor(el).open).toBe(true);
      await editor(el).updateComplete;
      expect(await bottomOf(editor(el))).toBe(
        `${codeMessage("product.offered_as_extra")} Salsas, Toppings`,
      );
      expect(
        editor(el).shadowRoot!.querySelector("[data-test=restore]")!.hasAttribute("disabled"),
      ).toBe(false);
      expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    });

    it("reports a refused restore on the screen", async () => {
      history.replaceState(null, "", "/manage/catalogue");
      const api = variantApi();
      vi.mocked(api.updateProductEditor).mockRejectedValue({ code: "server.internal" });
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "restore-product", { productId: "v1" });
      await flush(el);
      expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toContain(
        codeMessage("server.internal"),
      );
    });
  });

  describe("the Add to menus step after a create", () => {
    async function create(api: DashboardApi): Promise<CatalogueScreen> {
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-product]")!.click();
      await el.updateComplete;
      emit(editor(el), "wt-submit", { value: value as ProductEditorInput });
      await flush(el);
      await flush(el);
      return el;
    }
    const place = (el: CatalogueScreen, menuId: string, sectionId: string) =>
      step(el).shadowRoot!.querySelector<HTMLInputElement>(
        `fieldset[data-menu="${menuId}"] input[value="${sectionId}"]`,
      )!;
    async function choose(el: CatalogueScreen, ...places: [string, string][]): Promise<void> {
      for (const [menuId, sectionId] of places) {
        place(el, menuId, sectionId).click();
        await step(el).updateComplete;
      }
    }
    const control = (el: CatalogueScreen, test: string) =>
      step(el).shadowRoot!.querySelector<HTMLElement>(`[data-test="${test}"]`)!;

    it("follows a saved create with the step, naming the product and each section by staff and internal names", async () => {
      const api = stubApi();
      const el = await create(api);
      expect(editor(el).open).toBe(false);
      expect(step(el).open).toBe(true);
      expect(api.getMenuStructure).toHaveBeenCalledWith("cat-a");
      expect(api.getMenuStructure).toHaveBeenCalledWith("cat-b");
      const text = step(el).shadowRoot!.textContent!;
      expect(step(el).productName).toBe("Croquetas");
      expect(step(el).shadowRoot!.querySelector("wt-modal")!.getAttribute("heading")).not.toMatch(
        /caseras|CROQUETAS/,
      );
      expect(text).toContain("Comida");
      expect(text).toContain("Bebidas");
      expect(text).toContain("Drinks list");
      expect(text).toContain("Beer list");
      expect(text).not.toContain("Bebidas frías");
      expect(text).not.toContain("Cervezas de barril");
      expect(place(el, "cat-a", "root-a")).not.toBeNull();
    });

    it("adds the product once to each chosen section, only after the product is saved", async () => {
      const calls: string[] = [];
      const api = stubApi({
        createProductEditor: vi.fn().mockImplementation(() => {
          calls.push("create");
          return Promise.resolve({ ...value, id: "new" });
        }),
        addSectionProducts: vi.fn().mockImplementation((id: string) => {
          calls.push(`add:${id}`);
          return Promise.resolve({ added: 1 });
        }),
      });
      const el = await create(api);
      expect(api.addSectionProducts).not.toHaveBeenCalled();
      // Drinks is chosen on BOTH menus: it is one list, so it is asked for once.
      await choose(el, ["cat-b", "s-drinks"], ["cat-b", "root-b"], ["cat-a", "s-beer"]);
      control(el, "add-to-menus").click();
      await flush(el);
      await flush(el);
      expect(calls).toEqual(["create", "add:s-drinks", "add:s-beer", "add:root-b"]);
      expect(api.addSectionProducts).toHaveBeenCalledWith("s-drinks", ["new"]);
      expect(api.addSectionProducts).toHaveBeenCalledWith("s-beer", ["new"]);
      expect(api.addSectionProducts).toHaveBeenCalledWith("root-b", ["new"]);
      expect(step(el).open).toBe(false);
    });

    it("keeps the saved product when one section refuses it, says so apart from a save failure, and still tries the rest", async () => {
      const api = stubApi({
        addSectionProducts: vi
          .fn()
          .mockImplementation((id: string) =>
            id === "s-drinks"
              ? Promise.reject({ code: "server.internal" })
              : Promise.resolve({ added: 1 }),
          ),
      });
      const el = await create(api);
      await choose(el, ["cat-a", "root-a"], ["cat-a", "s-drinks"], ["cat-a", "s-beer"]);
      control(el, "add-to-menus").click();
      await flush(el);
      await flush(el);
      expect(vi.mocked(api.addSectionProducts).mock.calls.map(([id]) => id)).toEqual([
        "root-a",
        "s-drinks",
        "s-beer",
      ]);
      expect(api.createProductEditor).toHaveBeenCalledOnce();
      expect(api.updateProductEditor).not.toHaveBeenCalled();
      expect(step(el).open).toBe(true);
      const alert = control(el, "placement-error");
      expect(alert.textContent).toContain(t("add_to_menus.failed").replace("{name}", "Croquetas"));
      expect(alert.textContent).toContain("Drinks list");
      expect(alert.textContent).not.toContain("Beer list");
      expect(alert.textContent).toContain(codeMessage("server.internal"));
      expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
      expect(editor(el).open).toBe(false);
      expect(editor(el).fieldErrors).toEqual({});
    });

    it("sends every chosen section's addition at once, and lists refusals in the order the places are shown", async () => {
      let refuseFirst!: (error: unknown) => void;
      const api = stubApi({
        addSectionProducts: vi.fn().mockImplementation((id: string) => {
          if (id === "root-a") return new Promise((_, reject) => (refuseFirst = reject));
          if (id === "s-drinks") return Promise.reject({ code: "server.internal" });
          return Promise.resolve({ added: 1 });
        }),
      });
      const el = await create(api);
      await choose(el, ["cat-a", "root-a"], ["cat-a", "s-drinks"], ["cat-a", "s-beer"]);
      control(el, "add-to-menus").click();
      await flush(el);
      expect(vi.mocked(api.addSectionProducts).mock.calls.map(([id]) => id)).toEqual([
        "root-a",
        "s-drinks",
        "s-beer",
      ]);
      expect(step(el).busy).toBe(true);
      refuseFirst({ code: "menu_section.membership_invalid" });
      await flush(el);
      expect(step(el).busy).toBe(false);
      expect(step(el).failures).toEqual([
        { sectionId: "root-a", reason: codeMessage("menu_section.membership_invalid") },
        { sectionId: "s-drinks", reason: codeMessage("server.internal") },
      ]);
    });

    it("asks for every menu's structure at once", async () => {
      const api = stubApi({
        getMenuStructure: vi
          .fn()
          .mockImplementation((id: string) =>
            id === "cat-a" ? new Promise(() => {}) : Promise.resolve(structures[id]),
          ),
      });
      await create(api);
      expect(vi.mocked(api.getMenuStructure).mock.calls.map(([id]) => id)).toEqual([
        "cat-a",
        "cat-b",
      ]);
    });

    it("sends nothing and changes nothing when the step is skipped", async () => {
      const api = stubApi();
      const el = await create(api);
      await choose(el, ["cat-a", "s-drinks"]);
      control(el, "skip").click();
      await flush(el);
      expect(step(el).open).toBe(false);
      expect(api.addSectionProducts).not.toHaveBeenCalled();
      expect(api.createProductEditor).toHaveBeenCalledOnce();
      expect(api.updateProductEditor).not.toHaveBeenCalled();
      expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    });

    it("reports menus that fail to load as a load failure, with the product still saved", async () => {
      const api = stubApi({
        getMenuStructure: vi.fn().mockRejectedValue({ code: "server.internal" }),
      });
      const el = await create(api);
      expect(editor(el).open).toBe(false);
      expect(step(el).open).toBe(true);
      expect(control(el, "load-error").textContent).toContain(codeMessage("server.internal"));
      expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    });

    it("does not follow a save of an existing product with the step", async () => {
      const api = stubApi();
      const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
      await flush(el);
      emit(list(el), "edit-product", { productId: "p1" });
      await flush(el);
      emit(editor(el), "wt-submit", { value });
      await flush(el);
      expect(api.updateProductEditor).toHaveBeenCalledOnce();
      expect(editor(el).open).toBe(false);
      expect(step(el)?.open ?? false).toBe(false);
      expect(api.getMenuStructure).not.toHaveBeenCalled();
    });
  });
});

it("reads and writes folder paths and passes the folder to new products", async () => {
  history.replaceState(null, "", "/manage/catalogue/folder/c1");
  const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
    api: stubApi(),
  });
  await flush(el);
  const browser = el.shadowRoot!.querySelector("dashboard-catalogue-browser")!;
  expect(browser.folderId).toBe("c1");
  emit(browser, "open-folder", { folderId: "b" });
  await el.updateComplete;
  expect(location.pathname).toBe("/manage/catalogue/folder/b");
  emit(browser, "open-folder", { folderId: "c1" });
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-product"]')!.click();
  await el.updateComplete;
  expect(editor(el).newCategoryId).toBe("c1");
  emit(editor(el), "wt-cancel", {});
  await el.updateComplete;
  emit(browser, "view-change", { view: "all" });
  await el.updateComplete;
  expect(location.pathname).toContain("/view/all");
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-product"]')!.click();
  await el.updateComplete;
  expect(editor(el).newCategoryId).toBeNull();
});

it("creates an unfiled product when the addressed folder no longer exists", async () => {
  history.replaceState(null, "", "/manage/catalogue/folder/gone");
  const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", {
    api: stubApi(),
  });
  await flush(el);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-product"]')!.click();
  await el.updateComplete;
  expect(editor(el).newCategoryId).toBeNull();
});
