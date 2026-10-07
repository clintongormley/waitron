import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { MenusScreen } from "./menus-screen.js";
import type { DashboardApi, MenuStatus, MenuStructureNode, Product } from "../api/client.js";

afterEach(cleanupWidgets);
beforeEach(() => sessionStorage.clear());

const lager = {
  id: "p-lager",
  name: "Lager",
  customerName: { es: "Cerveza rubia" },
  kitchenName: "LAG",
  categoryId: null,
  active: true,
  variants: [],
} as unknown as Product;

const nodes: MenuStructureNode[] = [
  { memberId: "m-lager", ref: { kind: "product", productId: "p-lager" } },
  {
    memberId: "m-drinks",
    ref: { kind: "section", sectionId: "s-drinks" },
    internalName: "Drinks",
    names: {},
    image: null,
    color: null,
    ownerMenuId: "menu-lunch",
    children: [],
  },
];

const changed: MenuStatus = {
  state: "changed",
  clashes: 0,
  version: 2,
  publishedAt: "2026-09-26T10:15:00.000Z",
  hash: "a".repeat(64),
};

function api(status: MenuStatus = changed): DashboardApi {
  return {
    listCatalogues: vi
      .fn()
      .mockResolvedValue([{ id: "menu-lunch", name: "Lunch Menu", active: true, version: 1 }]),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    listLibraryProducts: vi.fn().mockResolvedValue([lager]),
    listCategories: vi.fn().mockResolvedValue([]),
    getMenuStructure: vi.fn().mockResolvedValue({
      rootSectionId: "root-lunch",
      root: {
        id: "root-lunch",
        internalName: "Lunch Menu",
        names: {},
        image: null,
        color: null,
        members: [],
      },
      includable: [],
      includedBy: [],
      nodes,
    }),
    getMenuStatuses: vi.fn().mockResolvedValue({ "menu-lunch": status }),
    getMenuStatus: vi.fn().mockResolvedValue(status),
  } as unknown as DashboardApi;
}

describe.each(["light", "dark"] as const)("menu editor heading (%s)", (theme) => {
  it("accessible path, name and Unpublished changes link above the Structure tree", async () => {
    history.replaceState(null, "", "/manage/menus/menu/menu-lunch/view/structure");
    const { el, host } = await mountWidget<MenusScreen>(
      "dashboard-menus-screen",
      { api: api() },
      theme,
    );
    const root = el.shadowRoot!;
    await vi.waitFor(() => {
      expect(root.querySelector('[data-test="status-changes"]')).not.toBeNull();
      expect(root.querySelector("dashboard-menu-structure-table")).not.toBeNull();
    });
    expect(root.querySelector('[data-test="menu-breadcrumb"] a')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("accessible state line saying publishing waits on clashes, as a link to the Prices tab", async () => {
    history.replaceState(null, "", "/manage/menus/menu/menu-lunch/view/structure");
    const { el, host } = await mountWidget<MenusScreen>(
      "dashboard-menus-screen",
      { api: api({ ...changed, clashes: 3 }) },
      theme,
    );
    const root = el.shadowRoot!;
    await vi.waitFor(() => {
      expect(root.querySelector('[data-test="status-clashes"]')).not.toBeNull();
      expect(root.querySelector("dashboard-menu-structure-table")).not.toBeNull();
    });
    expect(root.querySelector('[data-test="status-clashes"]')!.tagName).toBe("A");
    await expectNoA11yViolations(host);
  });
});
