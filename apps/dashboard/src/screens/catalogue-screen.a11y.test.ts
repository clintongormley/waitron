import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { page } from "vitest/browser";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./catalogue-screen.js";
import type { CatalogueScreen } from "./catalogue-screen.js";
import type {
  CatalogueSummary,
  CategorySummary,
  DashboardApi,
  SectionDetails,
  MenuStructure,
  Product,
  ProductEditorInput,
} from "../api/client.js";

registerIcons(DASHBOARD_ICONS);

const catalogues: CatalogueSummary[] = [
  { id: "cat-a", name: "Comida", active: true, version: 1 },
  { id: "cat-b", name: "Bebidas", active: true, version: 1 },
];

const categories: CategorySummary[] = [
  { id: "c1", name: "Entrantes", parentId: null, color: null },
];

const products: Product[] = [
  {
    id: "p1",
    modifiers: [],
    catalogueId: "cat-a",
    categoryId: "c1",
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
    ordering: "public",
    allergens: null,
    dietOverride: null,
    manualAllergens: null,
    image: null,
    color: null,
    variants: [],
  },
];

const stations = [{ id: "s1", name: "Cocina", displayOrder: 0, isDefault: true, active: true }];

const courses = [{ id: "k1", name: "Entrantes", displayOrder: 0, active: true, inUse: false }];

const drinks = {
  memberId: "m-drinks",
  ref: { kind: "section" as const, sectionId: "s-drinks" },
  internalName: "Drinks",
  names: {},
  image: null,
  color: null,
  ownerMenuId: "menu-lunch",
  children: [],
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
    nodes: [drinks],
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
    nodes: [drinks],
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
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  const api = {
    listCatalogues: vi.fn().mockResolvedValue(catalogues),
    getCatalogueSettings: async () => ({ defaultProductVatClass: "general", defaultColor: null }),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    listCategories: vi.fn().mockResolvedValue(categories),
    listProducts: vi.fn().mockResolvedValue(products),
    listMadeAt: vi.fn().mockResolvedValue({}),
    getFolderRouting: vi.fn().mockResolvedValue({
      stationTimes: [],
      todayEnds: null,
      clockReadable: true,
      zones: [],
      categories: [],
      products: [],
      cells: [],
      defaultStationId: null,
      stations: [],
      canMakeDefault: false,
    }),
    listStations: vi.fn().mockResolvedValue(stations),
    listCourses: vi.fn().mockResolvedValue(courses),
    listCoursesWithDisabled: vi.fn().mockResolvedValue(courses),
    listUnits: vi
      .fn()
      .mockResolvedValue([
        { id: "u1", name: { es: "unidad" }, abbreviation: { es: "u" }, precision: 0 },
      ]),
    listExtraLists: vi.fn().mockResolvedValue([]),
    listOptionLists: vi.fn().mockResolvedValue([]),
    createProductEditor: vi.fn().mockResolvedValue({ id: "new", name: "Croquetas de jamón" }),
    getMenuStructure: vi.fn().mockImplementation((id: string) => Promise.resolve(structures[id])),
    listSections: vi.fn().mockResolvedValue(sections),
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
afterEach(() => localStorage.clear());

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
    el.shadowRoot!.querySelector("dashboard-catalogue-browser")!.dispatchEvent(
      new CustomEvent("delete-product", {
        detail: { productId: "p1" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("renders the courses window over the product editor accessibly", async () => {
    const { el, host } = await mountWidget<CatalogueScreen>(
      "dashboard-catalogue-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector("dashboard-catalogue-browser")!.dispatchEvent(
      new CustomEvent("add-product", {
        detail: { categoryId: null },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    el.shadowRoot!.querySelector("dashboard-product-editor")!.dispatchEvent(
      new CustomEvent("wt-create-related", {
        detail: { kind: "courses" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    await vi.waitFor(() => {
      const list = el.shadowRoot!.querySelector("[data-test=courses-dialog] dashboard-course-list");
      if (!list?.shadowRoot!.querySelector('[data-course="k1"]'))
        throw new Error("the window is not open");
    });
    await expectNoA11yViolations(host);
  });

  it("renders the Add to menus step that follows a create accessibly", async () => {
    const { el, host } = await mountWidget<CatalogueScreen>(
      "dashboard-catalogue-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector("dashboard-catalogue-browser")!.dispatchEvent(
      new CustomEvent("add-product", {
        detail: { categoryId: null },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    el.shadowRoot!.querySelector("dashboard-product-editor")!.dispatchEvent(
      new CustomEvent("wt-submit", {
        detail: { value: { name: "Croquetas de jamón" } as ProductEditorInput },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    await flush(el);
    const stepRoot = el.shadowRoot!.querySelector("dashboard-add-to-menus")!.shadowRoot!;
    if (!stepRoot.querySelector('input[value="s-drinks"]')) throw new Error("the step is not open");
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)("archive confirmation a11y (%s)", (theme) => {
  it.each(["en", "es"])(
    "renders the confirmation and named refusal in %s at desktop and phone width",
    async (locale) => {
      const before = { locale: currentLocale(), width: innerWidth, height: innerHeight };
      setLocale(locale);
      try {
        for (const width of [1280, 390]) {
          await page.viewport(width, 844);
          expect(innerWidth).toBe(width);
          const api = stubApi({
            getProductEditor: vi.fn().mockResolvedValue(products[0]),
            countProductMenus: vi.fn().mockResolvedValue(0),
            updateProductEditor: vi.fn().mockRejectedValue({
              code: "product.on_live_menu",
              params: {
                products: [{ id: "p1", name: "Croquetas de jamón" }],
                menus: [
                  { id: "d", name: "Dinner" },
                  { id: "l", name: "Lunch Menu" },
                ],
              },
            }),
          });
          const { el, host } = await mountWidget<CatalogueScreen>(
            "dashboard-catalogue-screen",
            { api },
            theme,
          );
          await flush(el);
          await vi.waitFor(() =>
            expect(
              (
                el.shadowRoot!.querySelector("dashboard-catalogue-browser") as unknown as {
                  products: Product[];
                }
              ).products.map(({ id }) => id),
            ).toContain("p1"),
          );
          el.shadowRoot!.querySelector("dashboard-catalogue-browser")!.dispatchEvent(
            new CustomEvent("delete-product", {
              detail: { productId: "p1" },
              bubbles: true,
              composed: true,
            }),
          );
          await flush(el);
          const modal = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
            "[data-test=delete-dialog]",
          )!;
          await modal.updateComplete;
          const native = modal.shadowRoot!.querySelector("dialog")!;
          expect(native.open).toBe(true);
          expect(modal.heading).toBe(
            t("product.archive_named").replace("{name}", "Croquetas de jamón"),
          );
          const confirm = modal.querySelector<HTMLElement>("[data-test=confirm-delete]")!;
          expect(confirm.textContent!.trim()).toBe(t("product.archive"));
          for (const state of ["confirm", "refusal"]) {
            if (state === "refusal") {
              confirm.click();
              await flush(el);
              const message = await formMessageOf(modal.querySelector("wt-form-actions")!);
              expect(message?.textContent).toContain(
                locale === "en" ? "Menus: Dinner, Lunch Menu." : "Menús: Dinner, Lunch Menu.",
              );
            }
            expect(native.getBoundingClientRect().right).toBeLessThanOrEqual(width);
            const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
            expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
            await expectNoA11yViolations(host);
            if (import.meta.env.VITE_A435_TASK7_CAPTURE === "1")
              await page.screenshot({
                element: page.getByRole("dialog", { name: modal.heading, exact: true }),
                path: `__screenshots__/a435-task7/dialog-${locale}-${theme}-${width}-${state}.png`,
              });
          }
          cleanupWidgets();
        }
      } finally {
        setLocale(before.locale);
        await page.viewport(before.width, before.height);
      }
    },
  );
});
