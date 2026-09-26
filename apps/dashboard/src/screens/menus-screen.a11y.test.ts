import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { MenusScreen } from "./menus-screen.js";
import type { DashboardApi, LibrarySection, MenuStructureNode, Product } from "../api/client.js";
import { t } from "../i18n/t.js";

afterEach(cleanupWidgets);
beforeEach(() => sessionStorage.clear());

/** The three names read differently, so a surface showing the wrong one is visible. */
const lager = {
  id: "p-lager",
  name: "Lager",
  customerName: { es: "Cerveza rubia" },
  kitchenName: "LAG",
  categoryId: null,
  active: true,
  variants: [],
} as unknown as Product;

const sections: LibrarySection[] = [
  {
    id: "s-drinks",
    internalName: "Drinks",
    names: { es: "Bebidas" },
    image: null,
    color: null,
    members: [
      { id: "m-lager", position: 0, ref: { kind: "product", productId: "p-lager" } },
      { id: "m-beer", position: 1, ref: { kind: "section", sectionId: "s-beer" } },
    ],
  },
  { id: "s-beer", internalName: "Beer", names: {}, image: null, color: null, members: [] },
];

const nodes: MenuStructureNode[] = [
  {
    memberId: "m-drinks",
    ref: { kind: "section", sectionId: "s-drinks" },
    children: [
      { memberId: "m-lager", ref: { kind: "product", productId: "p-lager" } },
      { memberId: "m-beer", ref: { kind: "section", sectionId: "s-beer" }, children: [] },
    ],
  },
];

type State = "empty-list" | "populated" | "empty-menu" | "failed" | "structure-failed" | "loading";

function api(state: State): DashboardApi {
  const never = () => new Promise(() => undefined);
  return {
    listCatalogues:
      state === "failed"
        ? vi.fn().mockRejectedValue(new Error("offline"))
        : state === "loading"
          ? vi.fn(never)
          : vi.fn().mockResolvedValue(
              state === "empty-list"
                ? []
                : [
                    { id: "menu-lunch", name: "Lunch Menu", active: true, version: 1 },
                    { id: "menu-dinner", name: "Dinner Menu", active: true, version: 1 },
                  ],
            ),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    listSections: vi.fn().mockResolvedValue(sections),
    listLibraryProducts: vi.fn().mockResolvedValue([lager]),
    listCategories: vi.fn().mockResolvedValue([]),
    getMenuStructure:
      state === "structure-failed"
        ? vi.fn().mockRejectedValue(new Error("offline"))
        : vi.fn().mockResolvedValue({
            rootSectionId: "root-lunch",
            nodes: state === "empty-menu" ? [] : nodes,
          }),
    listSectionUsages: vi.fn().mockResolvedValue({
      "s-drinks": {
        menus: [
          { id: "menu-dinner", name: "Dinner Menu" },
          { id: "menu-lunch", name: "Lunch Menu" },
        ],
        sections: [],
      },
    }),
    createSection: vi.fn(),
    duplicateSection: vi.fn(),
    getMenuPrices: vi.fn().mockResolvedValue([
      {
        menuItemId: "mi-lager",
        productId: "p-lager",
        name: "Lager",
        categoryId: null,
        placements: [["s-drinks"]],
        productPrice: "2.00",
        override: "1.80",
        effectivePrice: "1.80",
        active: true,
        variants: [],
      },
    ]),
  } as unknown as DashboardApi;
}

async function mount(state: State, theme: "light" | "dark", path: string) {
  history.replaceState(null, "", path);
  const mounted = await mountWidget<MenusScreen>(
    "dashboard-menus-screen",
    { api: api(state) },
    theme,
  );
  if (state !== "loading")
    await vi.waitFor(() => {
      const root = mounted.el.shadowRoot!;
      if (root.querySelector('[data-test="loading"], [data-test="structure-loading"]'))
        throw new Error("loading");
    });
  return mounted;
}

const LUNCH = "/manage/menus/menu/menu-lunch/view/structure";

function q(el: MenusScreen, selector: string): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>(selector)!;
}

/** Opens Lunch's Drinks for editing, and waits for its wider use. */
async function editDrinks(el: MenusScreen): Promise<void> {
  const tree = q(el, "dashboard-menu-structure-tree");
  tree.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-m-drinks"]')!.click();
  await vi.waitFor(() => {
    if (!el.shadowRoot!.querySelector('[data-test="shared"]')) throw new Error("usages");
  });
}

describe.each(["light", "dark"] as const)("menus screen (%s)", (theme) => {
  it.each(["empty-list", "populated", "failed", "loading"] as const)(
    "accessible menus list, %s",
    async (state) => {
      const { host } = await mount(state, theme, "/manage/menus");
      await expectNoA11yViolations(host);
    },
  );

  it("accessible create form refusing a blank name", async () => {
    const { el, host } = await mount("populated", theme, "/manage/menus");
    q(el, '[data-test="add-menu"]').click();
    await el.updateComplete;
    q(el, 'wt-modal[data-test="menu-form"] [data-test="menu-save"]').click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it.each(["empty-menu", "populated", "structure-failed"] as const)(
    "accessible Structure tab, %s",
    async (state) => {
      const { host } = await mount(state, theme, LUNCH);
      await expectNoA11yViolations(host);
    },
  );

  it("accessible expanded shared section being edited", async () => {
    const { el, host } = await mount("populated", theme, LUNCH);
    const tree = q(el, "dashboard-menu-structure-tree");
    tree.shadowRoot!.querySelector<HTMLElement>('[data-test="toggle-m-drinks"]')!.click();
    tree.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-m-drinks"]')!.click();
    await vi.waitFor(() => {
      if (!el.shadowRoot!.querySelector('[data-test="shared"]')) throw new Error("usages");
    });
    await expectNoA11yViolations(host);
  });

  it("accessible duplicate-and-use-here form", async () => {
    const { el, host } = await mount("populated", theme, LUNCH);
    await editDrinks(el);
    q(el, '[data-test="duplicate-here"]').click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it.each([false, true])(
    "accessible new-section form, refusing a blank name: %s",
    async (refused) => {
      const { el, host } = await mount("populated", theme, LUNCH);
      await editDrinks(el);
      q(el, '[data-test="new-section"]').click();
      await el.updateComplete;
      if (refused) {
        q(el, 'wt-modal[data-test="new-section"] [data-test="new-section-save"]').click();
        await el.updateComplete;
        const name = q(el, 'wt-modal[data-test="new-section"] wt-input[name="internalName"]');
        expect((name as HTMLElementTagNameMap["wt-input"]).error).toBe(
          t("sections.internal_name_required"),
        );
      }
      await expectNoA11yViolations(host);
    },
  );

  it("accessible Prices tab", async () => {
    const { el, host } = await mount(
      "populated",
      theme,
      "/manage/menus/menu/menu-lunch/view/prices",
    );
    const prices = q(el, "dashboard-menu-prices-table") as HTMLElement & { rows: unknown[] };
    await vi.waitFor(() => expect(prices.rows).toHaveLength(1));
    await expectNoA11yViolations(host);
  });

  it("accessible add-products picker", async () => {
    const { el, host } = await mount("populated", theme, LUNCH);
    const tree = q(el, "dashboard-menu-structure-tree");
    tree.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-m-drinks"]')!.click();
    await el.updateComplete;
    q(el, '[data-test="open-add-products"]').click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
