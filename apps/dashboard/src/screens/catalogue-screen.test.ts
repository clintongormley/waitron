import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CatalogueSummary,
  CategorySummary,
  DashboardApi,
  ExtraList,
  ExtraListInput,
  OptionList,
  OptionListInput,
  Product,
  ProductEditorInput,
  ProductEditorValue,
  Unit,
} from "../api/client.js";
import type { ProductEditor } from "../widgets/product-editor.js";
import type { ProductList } from "../widgets/product-list.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { CatalogueScreen } from "./catalogue-screen.js";

const catalogues: CatalogueSummary[] = [
  { id: "cat-a", name: "Comida", active: true, version: 1 },
  { id: "cat-b", name: "Bebidas", active: true, version: 1 },
];
const categories: CategorySummary[] = [
  { id: "c1", name: { es: "Entrantes" }, image: null, color: null, parentId: null },
];
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
    categoryIds: ["c1"],
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
    soldAlone: true,
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
  soldAlone: true,
  vatClass: "reduced",
  variants: [],
  categoryIds: ["c1"],
  primaryCategoryId: "c1",
  // One attachment the editor's Modifiers section shows, so the tests below can tell an unrelated
  // save carrying it back untouched from one that wipes it.
  modifiers: [{ kind: "options", id: "opt-list-1" }],
  allergens: {},
  dietaryDeclarations: ["vegetarian"],
  stationId: null,
  courseId: null,
};

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
    getProductEditor: vi.fn().mockResolvedValue(value),
    createProductEditor: vi.fn().mockResolvedValue({ ...value, id: "new" }),
    updateProductEditor: vi.fn().mockResolvedValue(value),
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
const list = (el: CatalogueScreen): ProductList =>
  el.shadowRoot!.querySelector("dashboard-product-list")!;
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
    expect(list(el).products).toEqual(products);
    expect(el.shadowRoot!.querySelector("dashboard-category-manager")).toBeNull();
    expect(el.shadowRoot!.querySelector('select[name="product-catalogue"]')).toBeNull();
  });

  // Spec §15.6: Delete makes the product Inactive and leaves its availability as it was.
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
    expect(dialog.querySelector("[role=alert]")?.textContent).toContain(
      codeMessage("server.internal"),
    );
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

  it("offers the venue's stations and courses and saves the routing inside the product write", async () => {
    const api = stubApi({
      listStations: vi.fn().mockResolvedValue([
        {
          id: "s1",
          name: "Bar",
          displayOrder: 0,
          isDefault: true,
          active: true,
          warmAfterMinutes: 5,
          overdueAfterMinutes: 10,
          forgottenAfterMinutes: 20,
        },
      ]),
      listCourses: vi
        .fn()
        .mockResolvedValue([{ id: "k1", name: "Starters", displayOrder: 0, active: true }]),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    expect(editor(el).stations.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "s1", name: "Bar" },
    ]);
    expect(editor(el).courses.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "k1", name: "Starters" },
    ]);
    const routed: ProductEditorInput = { ...value, stationId: "s1", courseId: "k1" };
    emit(editor(el), "wt-submit", { value: routed });
    await flush(el);
    // ONE write carries the product and its routing: a station this venue does not have has to roll
    // the product back rather than leave it saved without its routing.
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
  // the same wiring the Modifiers screen gives them. Without it the form stays open saying nothing,
  // because the modal covers this screen's own banner.
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

  // One dismissal produces TWO `wt-cancel`s: the form's own, then the `<dialog>`'s native `close` a
  // task later. Found by running — the second one arrived while the options form was open and
  // closed it, taking the refusal it was showing with it.
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
    const summary = editor(el).shadowRoot!.querySelector("wt-form-error-summary") as unknown as {
      errors: string[];
    };
    expect(summary.errors).toEqual([codeMessage("content.translation_required")]);
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

  it("waits for the content languages before offering the new-category form", async () => {
    let languagesLoaded!: (value: { defaultLanguage: string; languages: string[] }) => void;
    const api = stubApi({
      getContentLanguages: vi.fn().mockReturnValue(new Promise((done) => (languagesLoaded = done))),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "category" });
    await el.updateComplete;
    // No name field in a guessed language: nothing could be submitted under a language the venue
    // may not use.
    expect(el.shadowRoot!.querySelector("dashboard-category-form")).toBeNull();
    languagesLoaded({ defaultLanguage: "es", languages: ["es"] });
    await flush(el);
    const form = el.shadowRoot!.querySelector("dashboard-category-form")!;
    expect(form.open).toBe(true);
    await form.updateComplete;
    const names = [...form.shadowRoot!.querySelectorAll("wt-input")].map((input) =>
      input.getAttribute("name"),
    );
    expect(names).toEqual(["category-name-es"]);
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
              categoryIds: ["c1"],
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
      categoryIds: [],
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
        categoryIds: ["c1"],
        primaryCategoryId: "c1",
        stationId: null,
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

    // Spec §15.6: removing a variant makes it Inactive, through its own page's write, and leaves
    // its availability and every other stored value as they were.
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
});
