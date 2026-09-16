import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CatalogueSummary,
  CategorySummary,
  DashboardApi,
  Modifier,
  Product,
  ProductEditorInput,
  ProductEditorValue,
  Unit,
} from "../api/client.js";
import type { ProductEditor } from "../widgets/product-editor.js";
import type { ProductList } from "../widgets/product-list.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
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
const modifiers: Modifier[] = [{ id: "m1", type: "text", name: { es: "Nota" }, available: true }];
const products: Product[] = [
  {
    id: "p1",
    catalogueId: "cat-a",
    categoryId: "c1",
    categoryIds: ["c1"],
    primaryCategoryId: "c1",
    name: "Croquetas",
    customerName: { es: "Croquetas caseras de jamón" },
    pricingUnit: "each",
    unitPrice: "8.50",
    vatClass: "reduced",
    active: true,
    allergens: null,
    dietOverride: null,
    manualAllergens: null,
    image: null,
  },
];
const value: ProductEditorValue = {
  id: "p1",
  name: "Croquetas",
  customerName: { es: "Croquetas caseras de jamón" },
  description: { es: "Cremosas" },
  kitchenName: "CROQUETAS",
  image: null,
  unitId: "u1",
  unitPrice: "8.50",
  available: true,
  vatClass: "reduced",
  variants: [],
  categoryIds: ["c1"],
  primaryCategoryId: "c1",
  modifierIds: ["m1"],
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
    listModifiers: vi.fn().mockResolvedValue(modifiers),
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
    createModifier: vi.fn().mockResolvedValue({
      id: "m2",
      type: "text",
      name: { es: "Mensaje" },
      available: true,
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
    expect(api.listModifiers).toHaveBeenCalledOnce();
    expect(api.listProducts).toHaveBeenCalledWith("cat-a");
    expect(api.listProducts).toHaveBeenCalledWith("cat-b");
    expect(list(el).products).toEqual(products);
    expect(el.shadowRoot!.querySelector("dashboard-category-manager")).toBeNull();
    expect(el.shadowRoot!.querySelector("dashboard-option-group-manager")).toBeNull();
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

  it("edits an attached modifier through the nested form and writes it back", async () => {
    const api = stubApi({
      updateModifier: vi
        .fn()
        .mockResolvedValue({ id: "m1", type: "text", name: { es: "Nota larga" }, available: true }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-edit-related", { kind: "modifier", id: "m1" });
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-modifier-form")!;
    expect(form.open).toBe(true);
    expect(form.value).toEqual(modifiers[0]);
    emit(form, "wt-submit", {
      value: { type: "text", name: { es: "Nota larga" }, available: true },
    });
    await flush(el);
    expect(api.updateModifier).toHaveBeenCalledWith("m1", {
      type: "text",
      name: { es: "Nota larga" },
      available: true,
    });
    expect(api.createModifier).not.toHaveBeenCalled();
    expect(form.open).toBe(false);
    // The product keeps the modifier it already had; editing one never attaches a second copy.
    expect(editor(el).currentValue.modifierIds).toEqual(["m1"]);
  });

  it("opens the modifier form empty again after an edit was cancelled", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    emit(editor(el), "wt-edit-related", { kind: "modifier", id: "m1" });
    await el.updateComplete;
    const form = el.shadowRoot!.querySelector("dashboard-modifier-form")!;
    expect(form.value).toEqual(modifiers[0]);
    emit(form, "wt-cancel", {});
    await flush(el);
    emit(editor(el), "wt-create-related", { kind: "modifier" });
    await el.updateComplete;
    // A stale edit target would turn the next CREATE into an update of the modifier just cancelled.
    expect(form.value).toBeNull();
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
});
