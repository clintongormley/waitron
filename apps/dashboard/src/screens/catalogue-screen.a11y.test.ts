import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./catalogue-screen.js";
import type { CatalogueScreen } from "./catalogue-screen.js";
import type { CatalogueSummary, CategorySummary, DashboardApi, Product } from "../api/client.js";

/**
 * The catalogue screen scanned by axe in both themes, in its two shapes: with catalogues loaded (the
 * add-product control, the product list and the new-catalogue field) and with NONE (the
 * create-a-catalogue prompt). Mounted by ASSIGNING the `api` stub as a property — the screen loads on
 * connect, so the stub must resolve EVERY method `#load` calls or a stray rejection puts the screen
 * into its error-banner state instead of the loaded one this test means to scan (a rejection is itself
 * a finding, but a silently-wrong scanned state is not). The product form is left CLOSED (its
 * default), so its dialog renders nothing to the a11y tree; the extras and options list forms have
 * their own a11y suites (`extra-list-form.a11y.test.ts`, `option-list-form.a11y.test.ts`).
 */
const catalogues: CatalogueSummary[] = [
  { id: "cat-a", name: "Comida", active: true, version: 1 },
  { id: "cat-b", name: "Bebidas", active: true, version: 1 },
];

const categories: CategorySummary[] = [
  { id: "c1", name: { es: "Entrantes" }, image: null, color: null, parentId: null },
];

const products: Product[] = [
  {
    id: "p1",
    modifiers: [],
    catalogueId: "cat-a",
    categoryId: "c1",
    categoryIds: ["c1"],
    primaryCategoryId: "c1",
    name: "Croquetas de jamón",
    customerName: { es: "Croquetas caseras de jamón ibérico" },
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

const stations = [{ id: "s1", name: "Cocina", displayOrder: 0, isDefault: true, active: true }];

const courses = [{ id: "k1", name: "Entrantes", displayOrder: 0, active: true }];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  const api = {
    listCatalogues: vi.fn().mockResolvedValue(catalogues),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    listCategories: vi.fn().mockResolvedValue(categories),
    listProducts: vi.fn().mockResolvedValue(products),
    listStations: vi.fn().mockResolvedValue(stations),
    listCourses: vi.fn().mockResolvedValue(courses),
    listUnits: vi
      .fn()
      .mockResolvedValue([
        { id: "u1", name: { es: "unidad" }, abbreviation: { es: "u" }, precision: 0 },
      ]),
    listExtraLists: vi.fn().mockResolvedValue([]),
    listOptionLists: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as DashboardApi;
  Object.defineProperty(api, "background", { get: () => api });
  return api;
}

async function flush(el: CatalogueScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("catalogue-screen a11y (%s theme)", (theme) => {
  it("renders accessibly with catalogues loaded", async () => {
    const { el, host } = await mountWidget<CatalogueScreen>(
      "dashboard-catalogue-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly when no catalogue exists yet", async () => {
    const api = stubApi({ listCatalogues: vi.fn().mockResolvedValue([]) });
    const { el, host } = await mountWidget<CatalogueScreen>(
      "dashboard-catalogue-screen",
      { api },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the product delete confirmation accessibly", async () => {
    const { el, host } = await mountWidget<CatalogueScreen>(
      "dashboard-catalogue-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector("dashboard-product-list")!.dispatchEvent(
      new CustomEvent("delete-product", {
        detail: { productId: "p1" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
