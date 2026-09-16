import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./catalogue-screen.js";
import type { CatalogueScreen } from "./catalogue-screen.js";
import type {
  CatalogueSummary,
  CategorySummary,
  DashboardApi,
  OptionGroup,
  Product,
  Modifier,
} from "../api/client.js";

/**
 * The catalogue screen scanned by axe in both themes, in its two shapes: with catalogues loaded (the
 * selector, the add-product control, the product list, the category manager, the option-group manager
 * (Task 12) and the new-catalogue field) and with NONE (the create-a-catalogue prompt). Mounted by
 * ASSIGNING the `api` stub as a property — the screen loads on connect, so the stub must resolve EVERY
 * method `#load` calls (`listCourses`/`listOptionGroups` included) or a stray rejection puts the screen
 * into its error-banner state instead of the loaded one this test means to scan (a rejection is itself
 * a finding, but a silently-wrong scanned state is not). The product form is left CLOSED (its default),
 * so its dialog — and the option-group attach section inside it — renders nothing to the a11y tree; the
 * option-group manager's OWN a11y coverage lives in `option-group-manager.a11y.test.ts`.
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
    modifierIds: [],
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
    allergens: null,
    dietOverride: null,
    manualAllergens: null,
    image: null,
    variants: [],
  },
];

const stations = [{ id: "s1", name: "Cocina", displayOrder: 0, isDefault: true, active: true }];

const courses = [{ id: "k1", name: "Entrantes", displayOrder: 0, active: true }];

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

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  const api = {
    listCatalogues: vi.fn().mockResolvedValue(catalogues),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    listCategories: vi.fn().mockResolvedValue(categories),
    listProducts: vi.fn().mockResolvedValue(products),
    listStations: vi.fn().mockResolvedValue(stations),
    listCourses: vi.fn().mockResolvedValue(courses),
    listOptionGroups: vi.fn().mockResolvedValue(optionGroups),
    listUnits: vi
      .fn()
      .mockResolvedValue([
        { id: "u1", name: { es: "unidad" }, abbreviation: { es: "u" }, precision: 0 },
      ]),
    listModifiers: vi
      .fn()
      .mockResolvedValue([
        { id: "m1", type: "text", name: { es: "Nota" }, available: true } as Modifier,
      ]),
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
});
