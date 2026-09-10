import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import type {
  CatalogueSummary,
  CategorySummary,
  Course,
  DashboardApi,
  OptionGroup,
  OptionGroupItem,
  Product,
  Station,
} from "../api/client.js";
import type { ProductList } from "../widgets/product-list.js";
import type { ProductForm } from "../widgets/product-form.js";
import type { CategoryManager } from "../widgets/category-manager.js";
import type { OptionGroupManager } from "../widgets/option-group-manager.js";
import { CatalogueScreen } from "./catalogue-screen.js";

const catalogues: CatalogueSummary[] = [{ id: "cat-a", name: "Comida", active: true, version: 1 }];

const categories: CategorySummary[] = [{ id: "c1", name: "Entrantes" }];

const stations: Station[] = [
  {
    id: "s1",
    name: "Cocina",
    displayOrder: 0,
    isDefault: true,
    active: true,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  },
];

const courses: Course[] = [{ id: "k1", name: "Entrantes", displayOrder: 0, active: true }];

const optionGroups: OptionGroup[] = [
  {
    id: "og1",
    name: { es: "Tamaño" },
    minSelect: 1,
    maxSelect: 1,
    required: true,
    sort: 0,
    active: true,
  },
];

const optionGroupItems: OptionGroupItem[] = [
  {
    id: "oi1",
    groupId: "og1",
    name: { es: "Pequeño" },
    priceDelta: "0.00",
    vatClass: null,
    sort: 0,
    active: true,
    maxQuantity: 1,
    addAllergens: null,
    removeAllergens: null,
    addOrigins: null,
    removeOrigins: null,
  },
];

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
    dietOverride: null,
    manualAllergens: null,
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
    // The form ALWAYS emits dietOverride (null when the sub-form is all-auto) — the screen threads it
    // straight into the ProductInput, so the base detail carries it too.
    dietOverride: null,
    ...overrides,
  };
}

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listCatalogues: vi.fn().mockResolvedValue(catalogues),
    listCategories: vi.fn().mockResolvedValue(categories),
    listProducts: vi.fn().mockResolvedValue(products),
    listStations: vi.fn().mockResolvedValue(stations),
    listCourses: vi.fn().mockResolvedValue(courses),
    createProduct: vi.fn().mockResolvedValue({ ...products[0], id: "p-new" }),
    updateProduct: vi.fn().mockResolvedValue(undefined),
    createCategory: vi.fn().mockResolvedValue({ id: "c2", name: "Postres" }),
    createCatalogue: vi
      .fn()
      .mockResolvedValue({ id: "cat-new", name: "Nueva", active: true, version: 1 }),
    setCategoryStation: vi.fn().mockResolvedValue(undefined),
    setProductStation: vi.fn().mockResolvedValue(undefined),
    setProductCourse: vi.fn().mockResolvedValue(undefined),
    listOptionGroups: vi.fn().mockResolvedValue(optionGroups),
    createOptionGroup: vi.fn().mockResolvedValue({ ...optionGroups[0], id: "og-new" }),
    updateOptionGroup: vi.fn().mockResolvedValue(undefined),
    listOptionGroupItems: vi.fn().mockResolvedValue(optionGroupItems),
    createOptionGroupItem: vi.fn().mockResolvedValue({ ...optionGroupItems[0], id: "oi-new" }),
    updateOptionGroupItem: vi.fn().mockResolvedValue(undefined),
    listProductOptionGroupIds: vi.fn().mockResolvedValue([]),
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
const categoryManager = (el: CatalogueScreen): CategoryManager =>
  el.shadowRoot!.querySelector("dashboard-category-manager")!;
const optionGroupManager = (el: CatalogueScreen): OptionGroupManager =>
  el.shadowRoot!.querySelector("dashboard-option-group-manager")!;
const errorKey = (el: CatalogueScreen): string | null =>
  (el as unknown as { errorKey: string | null }).errorKey;

/** Fire a child widget's composed event, exactly as the real widget dispatches it. */
function emit(source: Element, type: string, detail: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

afterEach(cleanupWidgets);

describe("catalogue-screen", () => {
  it("loads reusable products across every menu and removes duplicates", async () => {
    const menus = [...catalogues, { id: "cat-b", name: "Bebidas", active: true, version: 1 }];
    const second = { ...products[0]!, id: "p2", catalogueId: "cat-b" };
    const api = stubApi({
      listCatalogues: vi.fn().mockResolvedValue(menus),
      listProducts: vi
        .fn()
        .mockResolvedValueOnce(products)
        .mockResolvedValueOnce([products[0], second]),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    expect(api.listCatalogues).toHaveBeenCalledTimes(1);
    expect(api.listCategories).toHaveBeenCalledTimes(1);
    expect(api.listProducts).toHaveBeenCalledWith("cat-a");
    expect(api.listProducts).toHaveBeenCalledWith("cat-b");
    expect(list(el).products).toEqual([products[0], second]);
  });

  it("keeps menu selection and menu creation out of the product screen", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    expect(el.shadowRoot!.querySelector("[data-test=catalogue-select]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=new-catalogue-name]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=create-catalogue]")).toBeNull();
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

    // `active` is threaded straight through the create — one request, no follow-up patch.
    expect(api.createProduct).toHaveBeenCalledWith({
      catalogueId: "cat-a",
      categoryId: "c1",
      descriptions: { es: "Café" },
      unitPrice: "2.50",
      vatClass: "reduced",
      pricingUnit: "each",
      active: true,
      dietOverride: null,
    });
    expect(api.updateProduct).not.toHaveBeenCalled();
    expect(api.listProducts).toHaveBeenCalledTimes(2); // reloaded
    expect(form(el).open).toBe(false);
  });

  // The robustness fix (whole-branch review finding): create-INACTIVE is ONE atomic request carrying
  // `active: false`, never a create-then-patch that could leave the product active/sellable if the
  // follow-up failed. Proven by the single createProduct call and NO updateProduct.
  it("creates a product inactive in a single atomic request (no follow-up patch)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-product]")!.click();
    await el.updateComplete;

    emit(form(el), "create-product", createDetail({ active: false }));
    await flush(el);

    expect(api.createProduct).toHaveBeenCalledTimes(1);
    expect(api.createProduct).toHaveBeenCalledWith({
      catalogueId: "cat-a",
      categoryId: "c1",
      descriptions: { es: "Café" },
      unitPrice: "2.50",
      vatClass: "reduced",
      pricingUnit: "each",
      active: false,
      dietOverride: null,
    });
    expect(api.updateProduct).not.toHaveBeenCalled();
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
      active: true,
      dietOverride: null,
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

  it("prompts to create a menu elsewhere and hides add-product when no menu exists", async () => {
    const api = stubApi({ listCatalogues: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    expect(el.shadowRoot!.querySelector("[data-test=no-catalogue]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=add-product]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=catalogue-select]")).toBeNull();
    // Products cannot be listed without a catalogue.
    expect(api.listProducts).not.toHaveBeenCalled();
  });

  // ── Error handling — every async path caught → errorKey banner ─────────────────────────────────

  it("shows an error key when the initial load is rejected (and never rejects)", async () => {
    const api = stubApi({ listCatalogues: vi.fn().mockRejectedValue({ code: "server.internal" }) });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    expect(errorKey(el)).toBe("server.internal");
    // The banner renders LOCALISED copy, never the raw wire code (the state above stays the raw code).
    const banner = el.shadowRoot!.querySelector("[role=alert]")?.textContent;
    expect(banner).toContain(codeMessage("server.internal", "es-ES"));
    expect(banner).not.toContain("server.internal");
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

  it("loads the courses on connect and threads them to the product form (KDS-2)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect(api.listCourses).toHaveBeenCalledTimes(1);
    expect(form(el).courses).toEqual(courses);
  });

  it("sets a product's default course on the form's set-product-course event (KDS-2)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(form(el), "set-product-course", { productId: "p1", courseId: "k1" });
    await flush(el);
    expect(api.setProductCourse).toHaveBeenCalledWith("p1", "k1");
  });

  it("clears a product's default course on a null set-product-course courseId (KDS-2)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(form(el), "set-product-course", { productId: "p1", courseId: null });
    await flush(el);
    expect(api.setProductCourse).toHaveBeenCalledWith("p1", null);
  });

  // ── Option groups (reusable modifiers) + their items (Task 11/12) ──────────────────────────────

  it("loads option groups on connect and threads them to the manager and the product form", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    expect(api.listOptionGroups).toHaveBeenCalledTimes(1);
    expect(optionGroupManager(el).groups).toEqual(optionGroups);
    expect(form(el).optionGroups).toEqual(optionGroups);
  });

  it("creates an option group then reloads the group list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(optionGroupManager(el), "create-option-group", { name: { es: "Extras" } });
    await flush(el);
    expect(api.createOptionGroup).toHaveBeenCalledWith({ name: { es: "Extras" } });
    expect(api.listOptionGroups).toHaveBeenCalledTimes(2); // reloaded
  });

  it("surfaces a rejected create-option-group as the manager's inline groupError, not the page banner", async () => {
    const api = stubApi({
      createOptionGroup: vi.fn().mockRejectedValue({ code: "options.group_invalid" }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(optionGroupManager(el), "create-option-group", { name: { es: "Extras" } });
    await flush(el);
    expect(optionGroupManager(el).groupError).toBe("options.group_invalid");
    expect(errorKey(el)).toBeNull(); // stays out of the page-level banner
    expect(api.listOptionGroups).toHaveBeenCalledTimes(1); // reload not reached
  });

  it("patches an option group then reloads the group list", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(optionGroupManager(el), "update-option-group", { id: "og1", patch: { minSelect: 1 } });
    await flush(el);
    expect(api.updateOptionGroup).toHaveBeenCalledWith("og1", { minSelect: 1 });
    expect(api.listOptionGroups).toHaveBeenCalledTimes(2); // reloaded
  });

  it("surfaces a rejected update-option-group as the manager's inline groupError", async () => {
    const api = stubApi({
      updateOptionGroup: vi.fn().mockRejectedValue({ code: "options.group_invalid" }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(optionGroupManager(el), "update-option-group", { id: "og1", patch: { minSelect: 9 } });
    await flush(el);
    expect(optionGroupManager(el).groupError).toBe("options.group_invalid");
  });

  it("loads a group's items on toggle-option-group-items and threads them to the manager", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(optionGroupManager(el), "toggle-option-group-items", { groupId: "og1" });
    await flush(el);
    expect(api.listOptionGroupItems).toHaveBeenCalledWith("og1");
    expect(optionGroupManager(el).expandedGroupId).toBe("og1");
    expect(optionGroupManager(el).items).toEqual(optionGroupItems);
  });

  it("collapses the items panel on a second toggle of the same group", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(optionGroupManager(el), "toggle-option-group-items", { groupId: "og1" });
    await flush(el);
    emit(optionGroupManager(el), "toggle-option-group-items", { groupId: "og1" });
    await flush(el);
    expect(optionGroupManager(el).expandedGroupId).toBeNull();
    expect(optionGroupManager(el).items).toEqual([]);
  });

  // Regression (fix round 1): a stale itemError must not survive a panel navigation — neither
  // re-opening the SAME group nor switching to a DIFFERENT one (which would show group A's error
  // while the operator is looking at group B's items).
  it("clears a stale itemError when the items panel is closed and reopened for the same group", async () => {
    const api = stubApi({
      createOptionGroupItem: vi.fn().mockRejectedValue({ code: "options.group_invalid" }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(optionGroupManager(el), "toggle-option-group-items", { groupId: "og1" });
    await flush(el);
    emit(optionGroupManager(el), "create-option-group-item", { groupId: "og1", name: { es: "X" } });
    await flush(el);
    expect(optionGroupManager(el).itemError).toBe("options.group_invalid");

    emit(optionGroupManager(el), "toggle-option-group-items", { groupId: "og1" }); // close
    await flush(el);
    expect(optionGroupManager(el).itemError).toBeNull();

    emit(optionGroupManager(el), "toggle-option-group-items", { groupId: "og1" }); // reopen
    await flush(el);
    expect(optionGroupManager(el).itemError).toBeNull();
  });

  it("clears a stale itemError from one group when switching to a different group's items", async () => {
    const api = stubApi({
      createOptionGroupItem: vi.fn().mockRejectedValue({ code: "options.group_invalid" }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(optionGroupManager(el), "toggle-option-group-items", { groupId: "og1" });
    await flush(el);
    emit(optionGroupManager(el), "create-option-group-item", { groupId: "og1", name: { es: "X" } });
    await flush(el);
    expect(optionGroupManager(el).itemError).toBe("options.group_invalid");

    emit(optionGroupManager(el), "toggle-option-group-items", { groupId: "og2" }); // switch group
    await flush(el);
    expect(optionGroupManager(el).itemError).toBeNull(); // og1's error is not og2's to show
  });

  it("creates an option-group item then reloads that group's items", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(optionGroupManager(el), "toggle-option-group-items", { groupId: "og1" });
    await flush(el);
    emit(optionGroupManager(el), "create-option-group-item", {
      groupId: "og1",
      name: { es: "Mediano" },
    });
    await flush(el);
    expect(api.createOptionGroupItem).toHaveBeenCalledWith("og1", { name: { es: "Mediano" } });
    expect(api.listOptionGroupItems).toHaveBeenCalledTimes(2); // reloaded
  });

  it("surfaces a rejected create-option-group-item as the manager's inline itemError", async () => {
    const api = stubApi({
      createOptionGroupItem: vi.fn().mockRejectedValue({ code: "management.request_invalid" }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(optionGroupManager(el), "toggle-option-group-items", { groupId: "og1" });
    await flush(el);
    emit(optionGroupManager(el), "create-option-group-item", {
      groupId: "og1",
      name: { es: "Mediano" },
    });
    await flush(el);
    expect(optionGroupManager(el).itemError).toBe("management.request_invalid");
  });

  it("patches an option-group item then reloads that group's items", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(optionGroupManager(el), "toggle-option-group-items", { groupId: "og1" });
    await flush(el);
    emit(optionGroupManager(el), "update-option-group-item", {
      groupId: "og1",
      itemId: "oi1",
      patch: { priceDelta: "1.00" },
    });
    await flush(el);
    expect(api.updateOptionGroupItem).toHaveBeenCalledWith("og1", "oi1", { priceDelta: "1.00" });
    expect(api.listOptionGroupItems).toHaveBeenCalledTimes(2); // reloaded
  });

  // ── Product ↔ option-group attach read-back (Task 12) ───────────────────────────────────────────

  it("resets attachedGroupIds and loads the read-back on edit-product", async () => {
    const listProductOptionGroupIds = vi.fn().mockResolvedValue(["og1"]);
    const api = stubApi({ listProductOptionGroupIds });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    // Synchronously, before the read-back resolves: reset to [].
    expect(form(el).attachedGroupIds).toEqual([]);
    await flush(el);
    expect(listProductOptionGroupIds).toHaveBeenCalledWith("p1");
    expect(form(el).attachedGroupIds).toEqual(["og1"]);
  });

  it("resets attachedGroupIds to [] when opening the create form", async () => {
    const api = stubApi({ listProductOptionGroupIds: vi.fn().mockResolvedValue(["og1"]) });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    expect(form(el).attachedGroupIds).toEqual(["og1"]);

    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-product]")!.click();
    await el.updateComplete;
    expect(form(el).attachedGroupIds).toEqual([]);
  });

  it("drops a superseded read-back when a second edit-product fires before the first resolves", async () => {
    const twoProducts = [...products, { ...products[0], id: "p2", descriptions: { es: "Tarta" } }];
    let resolveFirst!: (ids: string[]) => void;
    const listProductOptionGroupIds = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string[]>((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(["og1"]);
    const api = stubApi({
      listProductOptionGroupIds,
      listProducts: vi.fn().mockResolvedValue(twoProducts),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    emit(list(el), "edit-product", { productId: "p1" }); // the slow first load
    await el.updateComplete;
    emit(list(el), "edit-product", { productId: "p2" }); // supersedes it
    await flush(el);
    expect(form(el).attachedGroupIds).toEqual(["og1"]); // the second (fast) load's result

    resolveFirst(["stale"]);
    await flush(el);
    expect(form(el).attachedGroupIds).toEqual(["og1"]); // the stale first load never overwrote it
  });

  it("suppresses the error from a superseded read-back (the catch-side of the same race)", async () => {
    // Mirrors recipe-screen.test.ts's "suppresses the error from a superseded product's recipe load":
    // a superseded load that REJECTS must not raise its error over the newer selection.
    const twoProducts = [...products, { ...products[0], id: "p2", descriptions: { es: "Tarta" } }];
    const rejecters: Record<string, (e: unknown) => void> = {};
    const listProductOptionGroupIds = vi.fn().mockImplementation(
      (id: string) =>
        new Promise<string[]>((_resolve, reject) => {
          rejecters[id] = reject;
        }),
    );
    const api = stubApi({
      listProductOptionGroupIds,
      listProducts: vi.fn().mockResolvedValue(twoProducts),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);

    emit(list(el), "edit-product", { productId: "p1" }); // load(p1) pending
    await el.updateComplete;
    emit(list(el), "edit-product", { productId: "p2" }); // switch to p2; load(p2) pending
    await el.updateComplete;

    rejecters["p2"]!({ code: "server.internal" });
    await flush(el);
    rejecters["p1"]!({ code: "shared.invalid_id" }); // p1 fails LAST but is superseded
    await flush(el);

    expect(errorKey(el)).toBe("server.internal"); // p1's error is not ours to show — p2 is current
  });

  it("surfaces a rejected read-back as the error banner", async () => {
    const api = stubApi({
      listProductOptionGroupIds: vi.fn().mockRejectedValue({ code: "shared.invalid_id" }),
    });
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    emit(list(el), "edit-product", { productId: "p1" });
    await flush(el);
    expect(errorKey(el)).toBe("shared.invalid_id");
  });

  it("threads the form's optionGroupIds into createProduct", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-product]")!.click();
    await el.updateComplete;

    emit(form(el), "create-product", createDetail({ optionGroupIds: ["og1"] }));
    await flush(el);

    expect(api.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ optionGroupIds: ["og1"] }),
    );
  });

  it("threads the form's dietOverride into createProduct (Task 8b)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-product]")!.click();
    await el.updateComplete;

    emit(
      form(el),
      "create-product",
      createDetail({ dietOverride: { vegan: "yes", addContains: ["meat"] } }),
    );
    await flush(el);

    expect(api.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ dietOverride: { vegan: "yes", addContains: ["meat"] } }),
    );
  });
});

it("Enter guards pending option-item creation and allows retry after rejection", async () => {
  let reject!: (reason: unknown) => void;
  const pending = new Promise((_, fail) => {
    reject = fail;
  });
  const request = vi.fn().mockReturnValueOnce(pending).mockResolvedValue({ id: "oi9" });
  const api = stubApi({ createOptionGroupItem: request });
  const { el } = await mountWidget<CatalogueScreen>("dashboard-catalogue-screen", { api });
  await flush(el);
  const manager = el.shadowRoot!.querySelector<OptionGroupManager>(
    "dashboard-option-group-manager",
  )!;
  await manager.updateComplete;
  manager.shadowRoot!.querySelector<HTMLElement>("[data-test=toggle-items-og1]")!.click();
  await flush(el);
  await manager.updateComplete;
  const field = manager.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(
    "[data-test=item-name-es]",
  )!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector("input")!;
  input.value = "Large";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await manager.updateComplete;
  input.focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.keyboard("{Enter}");
  manager.dispatchEvent(
    new CustomEvent("create-option-group-item", {
      detail: {
        groupId: "og1",
        name: { es: "Large" },
        priceDelta: "0.00",
        maxQuantity: 1,
        sort: 0,
        active: true,
        vatClass: null,
      },
      bubbles: true,
      composed: true,
    }),
  );
  expect(request).toHaveBeenCalledTimes(1);
  expect(
    (manager.shadowRoot!.querySelector("[data-test=create-item]") as import("@waitron/ui").WtButton)
      .disabled,
  ).toBe(true);
  reject({ code: "options.item_invalid" });
  await flush(el);
  input.focus();
  await userEvent.keyboard("{Enter}");
  await flush(el);
  expect(request).toHaveBeenCalledTimes(2);
  expect(
    (manager.shadowRoot!.querySelector("[data-test=create-item]") as import("@waitron/ui").WtButton)
      .disabled,
  ).toBe(false);
});
