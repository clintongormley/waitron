import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  combinedFixture,
  cleanupWidgets,
  documentProduct,
  documentSection,
  expectNoA11yViolations,
  menuDocument,
  mountWidget,
} from "../widgets/test-helpers.js";
import { MenusScreen } from "./menus-screen.js";
import type { MenuDocumentTree } from "../widgets/menu-document-tree.js";
import type {
  DashboardApi,
  MenuHome,
  SectionDetails,
  MenuPreview,
  MenuStructureNode,
  Product,
} from "../api/client.js";
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
  color: "#b12525",
  variants: [],
} as unknown as Product;

const sections: SectionDetails[] = [
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
    internalName: "Drinks",
    names: {},
    image: null,
    color: null,
    ownerMenuId: "menu-lunch",
    children: [
      { memberId: "m-lager", ref: { kind: "product", productId: "p-lager" } },
      {
        memberId: "m-beer",
        ref: { kind: "section", sectionId: "s-beer" },
        internalName: "Beer",
        names: {},
        image: null,
        color: null,
        ownerMenuId: "menu-lunch",
        children: [],
      },
    ],
  },
];

/** Wines, another menu, included after Drinks; its staff, own customer and folder names differ. */
const wines: MenuStructureNode = {
  memberId: "included-wine",
  ref: { kind: "section", sectionId: "wine-root" },
  internalName: "Wines",
  names: { es: "Carta de vinos" },
  image: null,
  color: "#112233",
  includedMenuId: "wine",
  ownerMenuId: "wine",
  folder: { showAsFolder: true, overrides: { names: { es: "Nuestros vinos" } } },
  children: [],
};

type State =
  | "empty-list"
  | "populated"
  | "empty-menu"
  | "failed"
  | "structure-failed"
  | "loading"
  | "included";

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
            nodes: state === "empty-menu" ? [] : state === "included" ? [...nodes, wines] : nodes,
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
    setIncludeFolder: vi.fn().mockRejectedValue({
      code: "menu_section.translation_required",
      params: { field: "names", language: "es" },
    }),
    getMenuStatuses: vi.fn().mockResolvedValue({
      "menu-lunch": {
        state: "changed",
        clashes: 0,
        version: 2,
        publishedAt: "2026-09-26T10:15:00.000Z",
        hash: "a".repeat(64),
      },
      "menu-dinner": { state: "unpublished", clashes: 0 },
    }),
    getMenuStatus: vi.fn().mockResolvedValue({
      state: "changed",
      clashes: 0,
      version: 2,
      publishedAt: "2026-09-26T10:15:00.000Z",
      hash: "a".repeat(64),
    }),
    getMenuPreview: vi.fn().mockResolvedValue({
      live: null,
      clashes: [],
      hash: "b".repeat(64),
      changes: [
        {
          id: "fixture-src/screens/menus-screen.a11y.test.ts-1",
          targets: { before: [], after: [] },
          kind: "product_changed",
          productId: "p-lager",
          name: "Lager",
          fields: ["allergens"],
          source: "shared_product",
          alsoOn: ["Dinner Menu"],
        },
      ],
      warnings: [{ kind: "shortcut_missing", name: "Lager" }],
      status: {
        state: "changed",
        clashes: 0,
        version: 2,
        publishedAt: "2026-09-26T10:15:00.000Z",
        hash: "a".repeat(64),
      },
      document: menuDocument(
        [documentSection("s-drinks", "Drinks", [documentProduct("mi-lager", "p-lager")])],
        { "p-lager": "Lager" },
      ),
    } satisfies MenuPreview),
    getMenuPublications: vi
      .fn()
      .mockResolvedValue({ timeZone: "Europe/Madrid", live: null, editions: [] }),
    getMenuHome: vi.fn().mockResolvedValue({
      homeSectionId: "home-lunch",
      shortcuts: [
        {
          memberId: "t-lager",
          position: 0,
          ref: { kind: "product", productId: "p-lager" },
          name: "Lager",
          missingName: null,
          reachable: true,
        },
        {
          memberId: "t-drinks",
          position: 1,
          ref: { kind: "section", sectionId: "s-drinks" },
          name: "Drinks",
          missingName: null,
          reachable: true,
        },
        {
          memberId: "t-soup",
          position: 2,
          ref: { kind: "product", productId: "p-soup" },
          name: "Soup",
          missingName: "Soup",
          reachable: false,
        },
      ],
      handheld: { columns: 3, tiles: "colours", order: "home_first" },
      till: { columns: 6, tiles: "colours", order: "home_first" },
    } satisfies MenuHome),
    getMenuPrices: vi.fn().mockResolvedValue([
      {
        menuItemId: "mi-lager",
        combined: combinedFixture("p-lager", "1.80", [], "1.80", "2.00"),
        productId: "p-lager",
        name: "Lager",
        categoryId: null,
        placements: [["s-drinks"]],
        override: "1.80",
        effectivePrice: "1.80",
        active: true,
        available: true,
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

/** The shadow root holding the rows of the menu's tree. */
function treeRows(el: MenusScreen): ShadowRoot {
  return q(el, "dashboard-menu-structure-table").shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!;
}

/** Opens Lunch's Drinks for editing, and waits for its wider use. */
async function editDrinks(el: MenusScreen): Promise<void> {
  await vi.waitFor(() =>
    treeRows(el).querySelector<HTMLElement>('tr[data-row-key="m-drinks"] .row-activate')!.click(),
  );
  await vi.waitFor(() => {
    if (!treeRows(el).querySelector('tr[data-row-key="m-drinks"] [aria-current="true"]'))
      throw new Error("list");
  });
}

/** Opens a row's ⋮ in the tree and chooses `action` in it. */
async function rowAction(el: MenusScreen, key: string, action: string): Promise<void> {
  treeRows(el)
    .querySelector<HTMLElementTagNameMap["wt-row-actions"]>(`[data-test="actions-${key}"]`)!
    .show();
  treeRows(el).querySelector<HTMLElement>(`[data-test="${action}-${key}"]`)!.click();
  await el.updateComplete;
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
    q(el, '[data-test="menu-form"]')
      .shadowRoot!.querySelector('wt-input[name="names-es"]')!
      .dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "Brunch" },
          bubbles: true,
          composed: true,
        }),
      );
    await el.updateComplete;
    q(el, '[data-test="menu-form"]')
      .shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!
      .click();
    await el.updateComplete;
    const name = q(el, '[data-test="menu-form"]').shadowRoot!.querySelector(
      'wt-input[name="internalName"]',
    )!;
    expect((name as HTMLElementTagNameMap["wt-input"]).error).toBe(t("menus.name_required"));
    await expectNoA11yViolations(host);
  });

  it.each(["empty-menu", "populated", "structure-failed"] as const)(
    "accessible Structure tab, %s",
    async (state) => {
      const { host } = await mount(state, theme, LUNCH);
      await expectNoA11yViolations(host);
    },
  );

  it("accessible expanded owned section being edited", async () => {
    const { el, host } = await mount("populated", theme, LUNCH);
    await vi.waitFor(() =>
      treeRows(el).querySelector<HTMLElement>('tr[data-row-key="m-drinks"] .row-activate')!.click(),
    );
    await vi.waitFor(() => {
      if (!treeRows(el).querySelector('tr[data-row-key="m-drinks"] [aria-current="true"]'))
        throw new Error("list");
    });
    await expectNoA11yViolations(host);
  });

  it("accessible include-menu picker", async () => {
    const { el, host } = await mount("populated", theme, LUNCH);
    await editDrinks(el);
    await rowAction(el, "m-drinks", "include-menu");
    await expectNoA11yViolations(host);
  });

  it.each([false, true])("accessible include's Edit dialog, refused: %s", async (refused) => {
    const { el, host } = await mount("included", theme, LUNCH);
    await vi.waitFor(() =>
      expect(treeRows(el).querySelector('[data-test="actions-included-wine"]')).not.toBeNull(),
    );
    await rowAction(el, "included-wine", "edit");
    const form = q(el, '[data-test="include-folder-form"]');
    await vi.waitFor(() => expect(form.shadowRoot!.querySelector("wt-modal")!.open).toBe(true));
    if (refused) {
      form.shadowRoot!.querySelector<HTMLElement>("[data-color='#256bb1']")!.click();
      await (form as HTMLElementTagNameMap["dashboard-include-folder-form"]).updateComplete;
      form.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
      await vi.waitFor(() =>
        expect(
          form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
            'wt-input[name="names-es"]',
          )!.error,
        ).not.toBe(""),
      );
    }
    await expectNoA11yViolations(host);
  });

  it.each([false, true])(
    "accessible new-section form, refusing a blank name: %s",
    async (refused) => {
      const { el, host } = await mount("populated", theme, LUNCH);
      await editDrinks(el);
      await rowAction(el, "m-drinks", "new-section");
      if (refused) {
        q(el, '[data-test="section-form"]')
          .shadowRoot!.querySelector('wt-input[name="names-es"]')!
          .dispatchEvent(
            new CustomEvent("wt-change", {
              detail: { value: "Sidras" },
              bubbles: true,
              composed: true,
            }),
          );
        await el.updateComplete;
        q(el, '[data-test="section-form"]')
          .shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!
          .click();
        await el.updateComplete;
        const name = q(el, '[data-test="section-form"]').shadowRoot!.querySelector(
          'wt-input[name="internalName"]',
        )!;
        expect((name as HTMLElementTagNameMap["wt-input"]).error).toBe(
          t("sections.internal_name_required"),
        );
      }
      await expectNoA11yViolations(host);
    },
  );

  it("accessible Price overrides tab", async () => {
    const { el, host } = await mount(
      "populated",
      theme,
      "/manage/menus/menu/menu-lunch/view/prices",
    );
    const prices = q(el, "dashboard-menu-prices-table") as HTMLElement & { rows: unknown[] };
    await vi.waitFor(() => expect(prices.rows).toHaveLength(1));
    await expectNoA11yViolations(host);
  });

  it("accessible Preview tab", async () => {
    const { el, host } = await mount(
      "populated",
      theme,
      "/manage/menus/menu/menu-lunch/view/preview",
    );
    const panel = q(el, "dashboard-menu-preview");
    await vi.waitFor(() => {
      if (!panel.shadowRoot!.querySelector('[data-test="changes"]')) throw new Error("preview");
    });
    const menu = panel.shadowRoot!.querySelector<MenuDocumentTree>(
      '[data-test="document"] dashboard-menu-document-tree',
    )!;
    await menu.updateComplete;
    const table = menu.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const section = table.shadowRoot!.querySelector<HTMLButtonElement>(
      '.row-activate[aria-expanded="false"]',
    )!;
    section.click();
    await table.updateComplete;
    expect(section.getAttribute("aria-expanded")).toBe("true");
    await expectNoA11yViolations(host);
  });

  it.each([
    ["under each name, on a phone", 390],
    ["in its own column", 1280],
  ])("accessible menus list with each menu's state %s", async (_where, width) => {
    const frame = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 900);
    onTestFinished(() => page.viewport(frame.width, frame.height));
    const { el, host } = await mount("populated", theme, "/manage/menus");
    const table = q(el, '[data-test="menus"]');
    await vi.waitFor(() =>
      expect(
        table.shadowRoot!.querySelector('[data-test="status-menu-dinner"]')?.textContent?.trim(),
      ).toBe(t("menu_status.unpublished")),
    );
    await expectNoA11yViolations(host);
  });

  it("accessible menus list with Lunch's changes link under its state in Status, 700px wide", async () => {
    const frame = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(700, 900);
    onTestFinished(() => page.viewport(frame.width, frame.height));
    const { el, host } = await mount("populated", theme, "/manage/menus");
    const table = q(el, '[data-test="menus"]');
    await vi.waitFor(() => {
      expect(table.shadowRoot!.querySelectorAll("thead th")).toHaveLength(3);
      const link = table.shadowRoot!.querySelector('[data-test="changes-menu-lunch"]');
      expect(link?.closest("td")?.cellIndex).toBe(1);
    });
    await expectNoA11yViolations(host);
  });

  async function mountHome(width: number) {
    const frame = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 900);
    onTestFinished(() => page.viewport(frame.width, frame.height));
    const mounted = await mount("populated", theme, "/manage/menus/menu/menu-lunch/view/home");
    await vi.waitFor(() => {
      const root = mounted.el.shadowRoot!;
      if (!root.querySelector('wt-slider[name="home-columns"]')) throw new Error("home");
      if (!root.querySelector("dashboard-device-home-preview")) throw new Error("preview");
    });
    return mounted;
  }

  it.each([390, 1280])(
    "accessible Home page tab with its controls and preview, %ipx wide",
    async (width) => {
      const { el, host } = await mountHome(width);
      const preview = q(el, "dashboard-device-home-preview") as HTMLElement & {
        updateComplete: Promise<unknown>;
      };
      await preview.updateComplete;
      expect(preview.shadowRoot!.querySelector(".frame")).not.toBeNull();
      expect(q(el, '[data-test="columns-note"]').textContent!.trim()).toBe(
        t("home.columns_note_handheld"),
      );
      await expectNoA11yViolations(host);
    },
  );

  it("accessible Structure tab with the Device Home Page row open and the shortcut picker", async () => {
    const { el, host } = await mount("populated", theme, LUNCH);
    await vi.waitFor(() =>
      treeRows(el).querySelector<HTMLElement>('tr[data-row-key="home"] .row-activate')!.click(),
    );
    await vi.waitFor(() => {
      if (!treeRows(el).querySelector('tr[data-row-key="home/t-soup"]')) throw new Error("open");
    });
    await expectNoA11yViolations(host);
    await rowAction(el, "home", "add-product-shortcut");
    await vi.waitFor(() =>
      expect(
        (q(el, 'wt-modal[data-test="add-shortcut"]') as HTMLElement & { open: boolean }).open,
      ).toBe(true),
    );
    await expectNoA11yViolations(host);
  });

  it("accessible Structure tab in Reorder mode, the toggle pressed and Done shown", async () => {
    const { el, host } = await mount("populated", theme, LUNCH);
    q(el, '[data-test="reorder"]').click();
    await vi.waitFor(() => expect(q(el, '[data-test="reorder-done"]')).not.toBeNull());
    expect(q(el, '[data-test="reorder"]').getAttribute("aria-pressed")).toBe("true");
    await vi.waitFor(() =>
      expect(treeRows(el).querySelector('[part~="drag-grip"]')).not.toBeNull(),
    );
    await expectNoA11yViolations(host);
  });

  it("accessible Reorder tooltip on keyboard focus", async () => {
    const { el, host } = await mount("populated", theme, LUNCH);
    const toggle = q(el, '[data-test="reorder"]');
    (document.activeElement as HTMLElement | null)?.blur();
    for (let i = 0; i < 30 && el.shadowRoot!.activeElement !== toggle; i += 1)
      await userEvent.tab();
    expect(el.shadowRoot!.activeElement).toBe(toggle);
    expect(getComputedStyle(toggle.querySelector(".icon-tooltip")!).display).toBe("block");
    await expectNoA11yViolations(host);
  });

  it("accessible add-products picker", async () => {
    const { el, host } = await mount("populated", theme, LUNCH);
    await editDrinks(el);
    await rowAction(el, "m-drinks", "open-add-products");
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)("menus list highlighted row (%s)", (theme) => {
  async function mountList() {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(1280, 900);
    onTestFinished(() => page.viewport(width, height));
    const { el, host } = await mount("populated", theme, "/manage/menus");
    const table = q(el, 'wt-data-table[data-test="menus"]');
    const row = () => table.shadowRoot!.querySelector('tr[data-row-key="menu-lunch"]')!;
    await vi.waitFor(() =>
      expect(row().querySelector('[data-test="changes-menu-lunch"]')).not.toBeNull(),
    );
    const probe = document.createElement("div");
    probe.style.background = getComputedStyle(host).getPropertyValue("--wt-color-surface-lifted");
    host.append(probe);
    const lifted = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const cell = row().querySelector('[data-test="changes-menu-lunch"]')!.closest("td")!;
    const resting = getComputedStyle(cell).backgroundColor;
    expect(resting).not.toBe(lifted);
    return { host, row, cell, lifted };
  }

  it("accessible Unpublished changes link on a focused, highlighted list row", async () => {
    const { host, row, cell, lifted } = await mountList();
    row().querySelector<HTMLButtonElement>(".row-activate")!.focus();
    expect(getComputedStyle(cell).backgroundColor).toBe(lifted);
    await expectNoA11yViolations(host);
  });

  it("accessible Unpublished changes link on a list row highlighted by the pointer", async () => {
    const { host, row, cell, lifted } = await mountList();
    await userEvent.hover(cell);
    expect(row().matches(":hover")).toBe(true);
    expect(getComputedStyle(cell).backgroundColor).toBe(lifted);
    await expectNoA11yViolations(host);
  });
});
