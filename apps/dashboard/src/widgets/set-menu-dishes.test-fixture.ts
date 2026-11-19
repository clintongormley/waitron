import { vi, type Mock } from "vitest";
import type { DashboardApi, SetMenuDetails } from "../api/client.js";
import { mountWidget } from "./test-helpers.js";
import "./set-menu-editor.js";

export const starters = { id: "starters", name: "Starters" };
export const sharing = { id: "sharing", name: "Sharing plates" };
export const bravas = {
  menuItemId: "bravas-item",
  productId: "bravas",
  name: "Bravas",
  courseId: sharing.id,
  productCourseId: sharing.id,
  courseOverrideId: null,
  surcharge: null,
  soldByMeasure: false,
  variants: [],
};
export const soup = {
  ...bravas,
  menuItemId: "soup-item",
  productId: "soup",
  name: "Soup",
  courseId: starters.id,
  productCourseId: starters.id,
};
export const hake = {
  ...bravas,
  menuItemId: "hake-item",
  productId: "hake",
  name: "Hake",
  courseId: null,
  productCourseId: null,
};
export const sharingLine = { id: "shared-line", count: 1, courseIds: [sharing.id] };
export const starterLine = { id: "first-line", count: 1, courseIds: [starters.id] };
export const details: SetMenuDetails = {
  id: "daily",
  name: "Daily menu",
  names: {},
  price: "14.00",
  vatClass: "reduced",
  takeawayVatClass: null,
  dishes: [hake, bravas, soup],
  lines: [sharingLine],
  courses: [starters, sharing],
  problems: [],
  heldBy: [],
};

type DishesApi = Record<
  | "readSetMenu"
  | "listMenus"
  | "listCategories"
  | "listLibraryProducts"
  | "addSetMenuDishes"
  | "copySetMenuDishes"
  | "saveSetMenuVariantChoices"
  | "updateMenuItem"
  | "saveSetMenuDishCourse"
  | "getMenuStructure"
  | "removeSectionMember",
  Mock
>;

export async function mountDishes(initial = details, theme?: "light" | "dark") {
  const api: DishesApi = {
    readSetMenu: vi.fn().mockResolvedValue(initial),
    listMenus: vi.fn().mockResolvedValue([
      { id: "lunch", name: "Lunch", kind: "menu", active: true, setPrice: null, setVatClass: null },
      {
        id: "daily",
        name: "Daily menu",
        kind: "set_menu",
        active: true,
        setPrice: "14.00",
        setVatClass: "reduced",
      },
      {
        id: "special",
        name: "Special menu",
        kind: "set_menu",
        active: true,
        setPrice: "20.00",
        setVatClass: "general",
      },
    ]),
    listCategories: vi.fn().mockResolvedValue([]),
    listLibraryProducts: vi.fn().mockResolvedValue([
      {
        id: "wine",
        name: "Wine",
        active: true,
        categoryId: null,
        variants: [
          { id: "glass", name: "Glass", active: true },
          { id: "bottle", name: "Bottle", active: true },
          { id: "magnum", name: "Magnum", active: false },
        ],
      },
      { id: "coffee", name: "Coffee", active: true, categoryId: null, variants: [] },
      { id: "turbot", name: "Turbot", active: true, categoryId: null, variants: [] },
    ]),
    addSetMenuDishes: vi.fn(),
    copySetMenuDishes: vi.fn(),
    saveSetMenuVariantChoices: vi.fn(),
    updateMenuItem: vi.fn().mockResolvedValue(undefined),
    saveSetMenuDishCourse: vi.fn(),
    getMenuStructure: vi.fn().mockResolvedValue({
      rootSectionId: "daily-root",
      root: { members: [{ id: "hake-member", ref: { kind: "product", productId: "hake" } }] },
    }),
    removeSectionMember: vi.fn().mockResolvedValue(undefined),
  };
  const { el, host } = await mountWidget<HTMLElementTagNameMap["dashboard-set-menu-editor"]>(
    "dashboard-set-menu-editor",
    { api: api as unknown as DashboardApi, menuId: "daily" },
    theme,
  );
  return { el, host, api };
}

const coffee = { id: "drinks", name: "Drinks" };
export const drinkLine = { id: "drinks-line", count: 1, courseIds: [coffee.id] };
export const wine = {
  ...bravas,
  menuItemId: "wine-item",
  productId: "wine",
  name: "Wine",
  surcharge: "2.00",
  variants: [
    { id: "glass", name: "Glass", courseId: sharing.id, included: true, surcharge: null },
    { id: "bottle", name: "Bottle", courseId: coffee.id, included: true, surcharge: null },
  ],
};
export const wineDetails: SetMenuDetails = {
  ...details,
  dishes: [wine],
  courses: [...details.courses, coffee],
  problems: [
    {
      kind: "dish_not_included",
      productId: "bottle",
      parentName: "Wine",
      name: "Bottle",
      courseId: coffee.id,
      courseName: coffee.name,
    },
  ],
};
