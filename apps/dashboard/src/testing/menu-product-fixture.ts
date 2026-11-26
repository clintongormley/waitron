import { vi, type Mock } from "vitest";
import type { DashboardApi, Product, ProductEditorValue } from "../api/client.js";

export const menuProductUnit = {
  id: "each",
  staffName: "Each",
  staffAbbreviation: "ea",
  name: { es: "Unidad" },
  abbreviation: { es: "ud" },
  precision: 0,
};

export const menuProduct: Product = {
  id: "p-burger",
  name: "Burger",
  customerName: { en: "House burger" },
  kitchenName: "GRILL BURGER",
  description: null,
  unitId: "each",
  unit: menuProductUnit,
  pricingUnit: "each",
  unitPrice: "8.50",
  active: true,
  available: true,
  ordering: "public",
  vatClass: "general",
  takeawayVatRate: "10.00",
  modifiers: [],
  allergens: null,
  diet: { vegan: "unknown", vegetarian: "unknown", contains: [] },
  dietaryDeclarations: [],
  dietOverride: null,
  categoryId: null,
  primaryCategoryId: null,
  courseId: null,
  image: null,
  color: null,
  variants: [],
};

export const menuProductEditorValue: ProductEditorValue = {
  ...menuProduct,
  parentId: null,
  inherited: null,
  allergens: {},
  variants: [],
};

type MenuProductApi = Partial<DashboardApi> & {
  getProductEditor: Mock<DashboardApi["getProductEditor"]>;
};

export function menuProductApi(product: Product = menuProduct): MenuProductApi {
  const structure: Awaited<ReturnType<DashboardApi["getMenuStructure"]>> = {
    rootSectionId: "root",
    root: { id: "root", internalName: "Lunch", names: {}, image: null, color: null, members: [] },
    nodes: [{ memberId: "m-burger", ref: { kind: "product", productId: product.id } }],
    placeableSetMenus: [],
    includable: [],
    includedBy: [],
  };
  return {
    listMenus: async () => [
      { id: "menu-one", name: "Lunch", active: true, kind: "menu", setPrice: null },
    ],
    listLibraryProducts: async () => [product],
    listCategories: async () => [],
    listUnits: async () => [menuProductUnit],
    listCourses: async () => [],
    listExtraLists: async () => [],
    listOptionLists: async () => [],
    getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en", "es"] }),
    getMenuSettings: async () => ({
      defaultProductVatClass: "general",
      defaultColor: null,
      defaultTakeawayVatRate: "10.00",
      dineInVatRate: "10.00",
      takeawayVat: true,
      vatRates: ["10.00", "21.00"],
    }),
    getMenuStatus: async () => ({ state: "unpublished", clashes: 0 }),
    getMenuStatuses: async () => ({}),
    getMenuStructure: async () => structure,
    getMenuRead: async () => ({
      structure: { status: 200, body: structure },
      prices: { status: 200, body: [] },
      status: { status: 200, body: { state: "unpublished", clashes: 0 } },
    }),
    getProductEditor: vi
      .fn<DashboardApi["getProductEditor"]>()
      .mockResolvedValue({ ...menuProductEditorValue, image: product.image }),
  } satisfies Partial<DashboardApi>;
}
