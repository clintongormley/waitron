import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type {
  CatalogueSummary,
  CategorySummary,
  DashboardApi,
  Product,
} from "../api/client.js";
import type { ProductList } from "../widgets/product-list.js";
import type { ProductForm } from "../widgets/product-form.js";
import { CatalogueScreen } from "./catalogue-screen.js";

const catalogues: CatalogueSummary[] = [
  { id: "cat-a", name: "Comida", active: true, version: 1 },
  { id: "cat-b", name: "Bebidas", active: true, version: 1 },
];

const categories: CategorySummary[] = [{ id: "c1", name: "Entrantes" }];

const products: Product[] = [
  {
    id: "p1",
    catalogueId: "cat-a",
    categoryId: "c1",
    descriptions: { es: "Croquetas" },
    pricingUnit: "each",
    unitPrice: "8.50",
    vatClass: "reduced",
    active: true,
    allergens: null,
    image: null,
  },
];

/** A base create-product detail (as `dashboard-product-form` emits it), overridable per test. */
function createDetail(overrides: Record<string, unknown> = {}) {
  return {
    catalogueId: "cat-a",
    categoryId: "c1",
    descriptions: { es: "Café" },
    unitPrice: "2.50",
    vatClass: "reduced" as const,
    pricingUnit: "each" as const,
    active: true,
    ...overrides,
  };
}

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listCatalogues: vi.fn().mockResolvedValue(catalogues),
    listCategories: vi.fn().mockResolvedValue(categories),
    listProducts: vi.fn().mockResolvedValue(products),
    createProduct: vi.fn().mockResolvedValue({ ...products[0], id: "p-new" }),
    updateProduct: vi.fn().mockResolvedValue(undefined),
    createCategory: vi.fn().mockResolvedValue({ id: "c2", name: "Postres" }),
    createCatalogue: vi
      .fn()
      .mockResolvedValue({ id: "cat-new", name: "Nueva", active: true, version: 1 }),
    ...overrides,
  } as unknown as DashboardApi;
}

/** Settles the in-flight fetches and the follow-up render. */
async function flush(el: CatalogueScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

const list = (el: CatalogueScreen): ProductList =>
  el.shadowRoot!.querySelector("dashboard-product-list")!;
const form = (el: CatalogueScreen): ProductForm =>
  el.shadowRoot!.querySelector("dashboard-product-form")!;
const categoryManager = (el: CatalogueScreen) =>
  el.shadowRoot!.querySelector("dashboard-category-manager")!;
const errorKey = (el: CatalogueScreen): string | null =>
  (el as unknown as { errorKey: string | null }).errorKey;

/** Fire a child widget's composed event, exactly as the real widget dispatches it. */
function emit(source: Element, type: string, detail: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

afterEach(cleanupWidgets);

describe("catalogue-screen", () => {
  it("loads catalogues, categories and the first catalogue's products on connect", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    expect(api.listCatalogues).toHaveBeenCalledTimes(1);
    expect(api.listCategories).toHaveBeenCalledTimes(1);
    expect(api.listProducts).toHaveBeenCalledWith("cat-a");
    expect(list(el).products).toEqual(products);
  });

  it("switches the product list when a different catalogue is selected", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=catalogue-select]")!;
    select.value = "cat-b";
    select.dispatchEvent(new Event("change"));
    await flush(el);

    expect(api.listProducts).toHaveBeenLastCalledWith("cat-b");
  });

  it("opens the product form for the selected catalogue on Añadir producto", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    expect(form(el).open).toBe(false);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-product]")!.click();
    await el.updateComplete;

    expect(form(el).open).toBe(true);
    expect(form(el).catalogueId).toBe("cat-a");
    expect(form(el).product).toBeNull();
    expect(form(el).api).toBe(api);
  });

  it("creates a product (active) then reloads the list, without a follow-up patch", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-product]")!.click();
    await el.updateComplete;

    emit(form(el), "create-product", createDetail({ active: true }));
    await flush(el);

    // The active field is STRIPPED from the ProductInput — createProduct has no `active`.
    expect(api.createProduct).toHaveBeenCalledWith({
      catalogueId: "cat-a",
      categoryId: "c1",
      descriptions: { es: "Café" },
      unitPrice: "2.50",
      vatClass: "reduced",
      pricingUnit: "each",
    });
    // active:true means the new DB product is already active — no reconciling patch.
    expect(api.updateProduct).not.toHaveBeenCalled();
    expect(api.listProducts).toHaveBeenCalledTimes(2); // reloaded
    expect(form(el).open).toBe(false);
  });

  // The load-bearing cross-task contract: createProduct has no `active`, so a create-with-inactive
  // is reconciled by a follow-up updateProduct(created.id, { active: false }).
  it("reconciles a create-with-inactive as a follow-up updateProduct patch", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-product]")!.click();
    await el.updateComplete;

    emit(form(el), "create-product", createDetail({ active: false }));
    await flush(el);

    expect(api.createProduct).toHaveBeenCalledTimes(1);
    expect(api.updateProduct).toHaveBeenCalledWith("p-new", { active: false });
    expect(api.listProducts).toHaveBeenCalledTimes(2);
  });

  it("carries allergens and image into the ProductInput only when present in the detail", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-product]")!.click();
    await el.updateComplete;

    emit(
      form(el),
      "create-product",
      createDetail({
        allergens: { gluten: { presence: "contains", source: "trigo" } },
        image: "sha.png",
      }),
    );
    await flush(el);

    expect(api.createProduct).toHaveBeenCalledWith({
      catalogueId: "cat-a",
      categoryId: "c1",
      descriptions: { es: "Café" },
      unitPrice: "2.50",
      vatClass: "reduced",
      pricingUnit: "each",
      allergens: { gluten: { presence: "contains", source: "trigo" } },
      image: "sha.png",
    });
  });

  it("opens the form pre-filled on edit-product and patches then reloads on update-product", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    emit(list(el), "edit-product", { productId: "p1" });
    await el.updateComplete;
    expect(form(el).open).toBe(true);
    expect(form(el).product).toEqual(products[0]);

    emit(form(el), "update-product", { id: "p1", patch: { unitPrice: "9.00" } });
    await flush(el);

    expect(api.updateProduct).toHaveBeenCalledWith("p1", { unitPrice: "9.00" });
    expect(api.listProducts).toHaveBeenCalledTimes(2);
    expect(form(el).open).toBe(false);
  });

  it("ignores an edit-product for an unknown id (no form opens)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    emit(list(el), "edit-product", { productId: "nope" });
    await el.updateComplete;
    expect(form(el).open).toBe(false);
  });

  it("creates a category then reloads the category list on create-category", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    emit(categoryManager(el), "create-category", { name: "Postres" });
    await flush(el);

    expect(api.createCategory).toHaveBeenCalledWith("Postres");
    expect(api.listCategories).toHaveBeenCalledTimes(2); // reloaded
  });

  // ── No catalogue yet ──────────────────────────────────────────────────────────────────────────

  it("prompts to create a catalogue and hides the add-product affordance when none exist", async () => {
    const api = stubApi({ listCatalogues: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    expect(el.shadowRoot!.querySelector("[data-test=no-catalogue]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=add-product]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=catalogue-select]")).toBeNull();
    // Products cannot be listed without a catalogue.
    expect(api.listProducts).not.toHaveBeenCalled();
  });

  it("creates a catalogue then reloads on the create-catalogue affordance", async () => {
    const api = stubApi({ listCatalogues: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    const input = el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-catalogue-name]")!;
    input.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Comida" } }));
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create-catalogue]")!.click();
    await flush(el);

    expect(api.createCatalogue).toHaveBeenCalledWith("Comida");
    expect(api.listCatalogues).toHaveBeenCalledTimes(2); // reloaded after the create
  });

  it("does not create a catalogue for an empty/whitespace name", async () => {
    const api = stubApi({ listCatalogues: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    const input = el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-catalogue-name]")!;
    input.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "   " } }));
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create-catalogue]")!.click();
    await flush(el);

    expect(api.createCatalogue).not.toHaveBeenCalled();
  });

  // ── Error handling — every async path caught → errorKey banner ─────────────────────────────────

  it("shows an error key when the initial load is rejected (and never rejects)", async () => {
    const api = stubApi({ listCatalogues: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    expect(errorKey(el)).toBe("server.internal");
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toContain("server.internal");
  });

  it("falls back to server.internal when a rejected load carries no code", async () => {
    const api = stubApi({ listCategories: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    expect(errorKey(el)).toBe("server.internal");
  });

  it("shows the thrown code and keeps the form open when createProduct is rejected", async () => {
    const api = stubApi({
      createProduct: vi.fn().mockRejectedValue({ code: "allergen.invalid_code" }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-product]")!.click();
    await el.updateComplete;

    emit(form(el), "create-product", createDetail());
    await flush(el);

    expect(errorKey(el)).toBe("allergen.invalid_code");
    expect(form(el).open).toBe(true); // left open for a retry
    expect(api.listProducts).toHaveBeenCalledTimes(1); // NOT reloaded
  });

  it("shows the fallback error and keeps the form open when updateProduct is rejected", async () => {
    const api = stubApi({ updateProduct: vi.fn().mockRejectedValue({}) });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await el.updateComplete;

    emit(form(el), "update-product", { id: "p1", patch: { unitPrice: "9.00" } });
    await flush(el);

    expect(errorKey(el)).toBe("server.internal"); // no code → fallback
    expect(form(el).open).toBe(true); // left open for a retry
    expect(api.listProducts).toHaveBeenCalledTimes(1); // NOT reloaded
  });

  it("surfaces a rejected createCategory as the error banner", async () => {
    const api = stubApi({ createCategory: vi.fn().mockRejectedValue({ code: "category.exists" }) });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    emit(categoryManager(el), "create-category", { name: "Postres" });
    await flush(el);

    expect(errorKey(el)).toBe("category.exists");
    expect(api.listCategories).toHaveBeenCalledTimes(1); // reload not reached
  });

  it("surfaces a rejected createCatalogue as the error banner", async () => {
    const api = stubApi({
      listCatalogues: vi.fn().mockResolvedValue([]),
      createCatalogue: vi.fn().mockRejectedValue({ code: "catalogue.exists" }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    const input = el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-catalogue-name]")!;
    input.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Comida" } }));
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=create-catalogue]")!.click();
    await flush(el);

    expect(errorKey(el)).toBe("catalogue.exists");
  });

  it("surfaces a rejected switch-catalogue as the error banner", async () => {
    const listProducts = vi
      .fn()
      .mockResolvedValueOnce(products)
      .mockRejectedValue({ code: "shared.invalid_id" });
    const api = stubApi({ listProducts });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=catalogue-select]")!;
    select.value = "cat-b";
    select.dispatchEvent(new Event("change"));
    await flush(el);

    expect(errorKey(el)).toBe("shared.invalid_id");
  });

  // Single-flight: a double-fired create-product files at most one product (createProduct is not
  // server-idempotent). Proven by deletion: drop the busy guard and createProduct is called twice.
  it("files at most one product when create-product fires twice", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-product]")!.click();
    await el.updateComplete;

    emit(form(el), "create-product", createDetail());
    emit(form(el), "create-product", createDetail());
    await flush(el);

    expect(api.createProduct).toHaveBeenCalledTimes(1);
  });

  // House pattern: the screen is the final consumer of the children's composed events, so it stops
  // them at its shadow boundary rather than letting them leak to the app shell above.
  it("contains create-product so it does not leak past the screen (stopPropagation)", async () => {
    const api = stubApi();
    const { el, host } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-product]")!.click();
    await el.updateComplete;

    const escaped = vi.fn();
    host.addEventListener("create-product", escaped);
    emit(form(el), "create-product", createDetail());
    await flush(el);

    expect(escaped).not.toHaveBeenCalled();
  });
});
