import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import {
  cleanupWidgets,
  documentProduct,
  documentSection,
  menuDocument,
  mountWidget,
} from "../widgets/test-helpers.js";
import { MenusScreen } from "./menus-screen.js";
import type {
  CatalogueSummary,
  DashboardApi,
  MemberRef,
  MenuHome,
  MenuPreview,
  MenuReadPart,
  MenuStatus,
  MenuStructure,
  MenuStructureNode,
  Product,
  SectionMember,
} from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";

afterEach(cleanupWidgets);
beforeEach(() => sessionStorage.clear());

const HOME_PATH = "/manage/menus/menu/menu-lunch/view/home";

function product(id: string, name: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    modifiers: [],
    catalogueId: "cat-1",
    categoryId: null,
    primaryCategoryId: null,
    name,
    customerName: { es: `${name} para clientes`, en: `${name} for guests` },
    unitId: "unit-each",
    unit: { id: "unit-each", name: { es: "Unidad" }, precision: 0, abbreviation: { es: "ud" } },
    description: null,
    kitchenName: `${name.toUpperCase()} COCINA`,
    dietaryDeclarations: [],
    pricingUnit: "each",
    unitPrice: "2.00",
    vatClass: "general",
    active: true,
    available: true,
    ordering: "public",
    allergens: null,
    dietOverride: null,
    manualAllergens: null,
    image: null,
    color: null,
    variants: [],
    ...overrides,
  };
}

const products: Product[] = [
  product("p-lager", "Lager"),
  product("p-lemonade", "Lemonade"),
  product("p-burger", "Burger"),
  product("p-chips", "Chips"),
];

const menus: CatalogueSummary[] = [
  { id: "menu-lunch", name: "Lunch Menu", active: true, version: 1 },
  { id: "menu-dinner", name: "Dinner Menu", active: true, version: 1 },
];

const productMember = (id: string, position: number, productId: string): SectionMember => ({
  id,
  position,
  ref: { kind: "product", productId },
});
const sectionMember = (id: string, position: number, sectionId: string): SectionMember => ({
  id,
  position,
  ref: { kind: "section", sectionId },
});

const productNode = (memberId: string, productId: string): MenuStructureNode => ({
  memberId,
  ref: { kind: "product", productId },
});

/** Lunch: Burger, and Drinks holding Lager and Lemonade. */
function lunchNodes(): MenuStructureNode[] {
  return [
    productNode("m-burger", "p-burger"),
    {
      memberId: "m-drinks",
      ref: { kind: "section", sectionId: "s-drinks" },
      internalName: "Drinks",
      names: { en: "Something to drink", es: "Bebidas frías" },
      image: null,
      color: null,
      ownerMenuId: "menu-lunch",
      children: [productNode("m-lager", "p-lager"), productNode("m-lemonade", "p-lemonade")],
    },
  ];
}

function structureOf(id: string): MenuStructure {
  const lunch = id === "menu-lunch";
  const rootId = lunch ? "root-lunch" : "root-dinner";
  return {
    rootSectionId: rootId,
    root: {
      id: rootId,
      internalName: lunch ? "Lunch Menu" : "Dinner Menu",
      names: {},
      image: null,
      color: null,
      members: [],
    },
    includable: [],
    includedBy: [],
    nodes: lunch ? lunchNodes() : [],
  };
}

function status(id: string): MenuStatus {
  return id === "menu-lunch"
    ? {
        state: "changed",
        clashes: 0,
        version: 2,
        publishedAt: "2026-09-26T10:15:00.000Z",
        hash: "a".repeat(64),
      }
    : {
        state: "current",
        clashes: 0,
        version: 5,
        publishedAt: "2026-09-26T10:15:00.000Z",
        hash: "d".repeat(64),
      };
}

function previewOf(id: string): MenuPreview {
  const document =
    id === "menu-lunch"
      ? menuDocument(
          [
            documentProduct("mi-burger", "p-burger"),
            documentSection("s-drinks", "Drinks", [
              documentProduct("mi-lemonade", "p-lemonade"),
              documentProduct("mi-chips", "p-chips"),
            ]),
          ],
          { "p-burger": "Burger", "p-lemonade": "Lemonade", "p-chips": "Chips" },
        )
      : menuDocument([], {}, "Dinner Menu");
  return {
    live: null,
    clashes: [],
    hash: "b".repeat(64),
    changes: [],
    warnings: [],
    status: status(id),
    document,
  };
}

/** Lunch's Device Home Page: Burger, the Drinks section and Chips, which Lunch no longer reaches. */
function menuHome(): MenuHome {
  const tile = (memberId: string, position: number, ref: MemberRef, name: string) =>
    ({
      memberId,
      position,
      ref,
      name,
      reachable: memberId !== "t-chips",
      missingName: memberId === "t-chips" ? name : null,
    }) as MenuHome["shortcuts"][number];
  return {
    homeSectionId: "home-lunch",
    shortcuts: [
      tile("t-burger", 0, { kind: "product", productId: "p-burger" }, "Burger"),
      tile("t-drinks", 1, { kind: "section", sectionId: "s-drinks" }, "Drinks"),
      tile("t-chips", 2, { kind: "product", productId: "p-chips" }, "Chips"),
    ],
    handheld: { columns: 3, tiles: "colours", order: "home_first" },
    till: { columns: 6, tiles: "colours", order: "home_first" },
  };
}

function homeWith(...memberIds: string[]): MenuHome {
  const home = menuHome();
  return {
    ...home,
    shortcuts: memberIds.map((id, position) => ({
      ...home.shortcuts.find((tile) => tile.memberId === id)!,
      position,
    })),
  };
}

const WRITES = [
  "addSectionMember",
  "removeSectionMember",
  "moveSectionMember",
  "addHomeShortcut",
  "removeHomeShortcut",
  "moveHomeShortcut",
  "setHomeDisplay",
] as const;

function api(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}) {
  const client = {
    listCatalogues: vi.fn().mockResolvedValue(menus),
    listLibraryProducts: vi.fn().mockResolvedValue(products),
    listCategories: vi.fn().mockResolvedValue([]),
    getCatalogueSettings: vi
      .fn()
      .mockResolvedValue({ defaultProductVatClass: "general", defaultColor: null }),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getMenuStructure: vi.fn(async (id: string) => structureOf(id)),
    addSectionMember: vi.fn(),
    removeSectionMember: vi.fn(),
    moveSectionMember: vi.fn(),
    getMenuPrices: vi.fn().mockResolvedValue([]),
    getMenuStatuses: vi.fn(async () => ({
      "menu-lunch": status("menu-lunch"),
      "menu-dinner": status("menu-dinner"),
    })),
    getMenuStatus: vi.fn(async (id: string) => status(id)),
    getMenuPreview: vi.fn(async (id: string) => previewOf(id)),
    getMenuPublications: vi.fn(async () => ({
      timeZone: "Europe/Madrid",
      live: null,
      editions: [],
    })),
    getMenuHome: vi.fn(async (id: string) =>
      id === "menu-lunch" ? menuHome() : { ...menuHome(), homeSectionId: "h-d", shortcuts: [] },
    ),
    addHomeShortcut: vi.fn().mockResolvedValue(productMember("t-new", 3, "p-lager")),
    removeHomeShortcut: vi.fn().mockResolvedValue(undefined),
    moveHomeShortcut: vi.fn(async (_menu: string, memberId: string, to: number) => {
      const ids = menuHome().shortcuts.map((tile) => tile.memberId);
      ids.splice(ids.indexOf(memberId), 1);
      ids.splice(to, 0, memberId);
      return ids.map((id, position) => ({
        id,
        position,
        ref: menuHome().shortcuts.find((tile) => tile.memberId === id)!.ref,
      }));
    }),
    setHomeDisplay: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  Object.assign(client, {
    getMenuRead: vi.fn(async (id: string, parts: readonly MenuReadPart[]) => {
      const readClient = client as unknown as DashboardApi;
      const reads = {
        structure: () => readClient.getMenuStructure(id),
        home: () => readClient.getMenuHome(id),
        status: () => readClient.getMenuStatus(id),
        preview: () => readClient.getMenuPreview(id),
      };
      const entries = await Promise.all(
        parts.map(async (part) => {
          try {
            return [part, { status: 200, body: await reads[part]() }];
          } catch (error) {
            return [part, { status: 409, body: { error } }];
          }
        }),
      );
      return Object.fromEntries(entries);
    }),
  });
  return client as unknown as DashboardApi & {
    [K in keyof DashboardApi]: ReturnType<typeof vi.fn>;
  };
}

type Api = ReturnType<typeof api>;
type Preview = HTMLElementTagNameMap["dashboard-device-home-preview"];

function writeCalls(client: Api): string[] {
  return WRITES.flatMap((name) =>
    (client[name] as ReturnType<typeof vi.fn>).mock.calls.map(() => name),
  );
}

function q<T extends Element = HTMLElement>(el: MenusScreen, selector: string): T | null {
  return el.shadowRoot!.querySelector<T>(selector);
}

function preview(el: MenusScreen): Preview | null {
  return q<Preview>(el, "dashboard-device-home-preview");
}

function inPreview<T extends Element = HTMLElement>(el: MenusScreen, testId: string): T | null {
  return preview(el)?.shadowRoot?.querySelector<T>(`[data-test="${testId}"]`) ?? null;
}

const shortcutOrder = (el: MenusScreen) =>
  (preview(el)!.shortcuts ?? []).map(({ memberId }) => memberId);

/** Opens Lunch's Home page tab from its address and waits for its editable preview. */
async function mountHome(client: Api = api(), path = HOME_PATH) {
  history.replaceState(null, "", path);
  const { el } = await mountWidget<MenusScreen>("dashboard-menus-screen", { api: client });
  await vi.waitFor(() => expect(preview(el)?.shortcuts).toBeTruthy());
  await preview(el)!.updateComplete;
  return el;
}

function emit(target: Element, name: string, detail: unknown): void {
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}

function text(node: Element | null): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function chooseTab(el: MenusScreen, key: string): Promise<void> {
  const tabs = q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!;
  tabs.shadowRoot!.querySelector<HTMLElement>(`[role="tab"][data-key="${key}"]`)!.click();
  await el.updateComplete;
}

async function toMenu(el: MenusScreen, path: string, name: string): Promise<void> {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  await vi.waitFor(() => expect(text(q(el, "h1"))).toBe(name));
}

const homeError = (el: MenusScreen) => text(q(el, '[data-test="home-error"]'));

describe("the Home page tab's shortcuts", () => {
  it("hands the preview the home's shortcuts to edit", async () => {
    const el = await mountHome();
    expect(preview(el)!.shortcuts).toEqual(menuHome().shortcuts);
    expect(preview(el)!.busy).toBe(false);
    expect(inPreview(el, "grip-t-burger")).not.toBeNull();
  });

  it("follows the menu's home while the Home page tab shows, and stops on another tab", async () => {
    const live = new LiveData();
    const client = api({ liveData: live });
    const el = await mountHome(client);
    expect(client.getMenuHome).toHaveBeenCalledWith("menu-lunch");
    const renamed = menuHome();
    renamed.shortcuts[0]!.name = "Big burger";
    client.getMenuHome.mockResolvedValue(renamed);
    live.invalidate([{ type: "sections" }]);
    await vi.waitFor(() => expect(preview(el)!.shortcuts![0]!.name).toBe("Big burger"));
    await chooseTab(el, "prices");
    const reads = client.getMenuHome.mock.calls.length;
    live.invalidate([{ type: "sections" }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.getMenuHome.mock.calls.length).toBe(reads);
  });

  it("removes and moves shortcuts through the menu's home routes, never the section member routes", async () => {
    const client = api();
    const el = await mountHome(client);
    client.getMenuHome.mockResolvedValue(homeWith("t-burger", "t-drinks"));
    inPreview(el, "remove-t-chips")!.click();
    await vi.waitFor(() =>
      expect(client.removeHomeShortcut).toHaveBeenCalledWith("menu-lunch", "t-chips"),
    );
    await vi.waitFor(() => expect(shortcutOrder(el)).toEqual(["t-burger", "t-drinks"]));
    const reads = client.getMenuHome.mock.calls.length;
    client.moveHomeShortcut.mockResolvedValueOnce([
      sectionMember("t-drinks", 0, "s-drinks"),
      productMember("t-burger", 1, "p-burger"),
    ]);
    emit(preview(el)!, "wt-shortcut-move", { memberId: "t-drinks", to: 0 });
    await vi.waitFor(() => expect(shortcutOrder(el)).toEqual(["t-drinks", "t-burger"]));
    expect(client.moveHomeShortcut).toHaveBeenCalledWith("menu-lunch", "t-drinks", 0);
    // The move's answer is shown without reading the home again.
    expect(client.getMenuHome.mock.calls.length).toBe(reads);
    expect(writeCalls(client)).toEqual(["removeHomeShortcut", "moveHomeShortcut"]);
  });

  it("keeps the preview usable during a move, and disables it during a remove until the home is read again", async () => {
    const reread = deferred<MenuHome>();
    const client = api();
    const el = await mountHome(client);
    emit(preview(el)!, "wt-shortcut-move", { memberId: "t-chips", to: 0 });
    await el.updateComplete;
    expect(preview(el)!.busy).toBe(false);
    await vi.waitFor(() => expect(client.moveHomeShortcut).toHaveBeenCalled());
    client.getMenuHome.mockImplementationOnce(() => reread.promise);
    emit(preview(el)!, "wt-shortcut-remove", { memberId: "t-burger" });
    await el.updateComplete;
    expect(preview(el)!.busy).toBe(true);
    await preview(el)!.updateComplete;
    expect(inPreview<HTMLElement & { disabled: boolean }>(el, "add-product")!.disabled).toBe(true);
    await vi.waitFor(() => expect(client.removeHomeShortcut).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(preview(el)!.busy).toBe(true);
    reread.resolve(homeWith("t-drinks", "t-chips"));
    await vi.waitFor(() => expect(preview(el)!.busy).toBe(false));
  });

  it("explains a refused shortcut on the Home page tab, and reads the home again after a refused move", async () => {
    const client = api({
      removeHomeShortcut: vi.fn().mockRejectedValue({ code: "menu_section.not_found" }),
      moveHomeShortcut: vi.fn().mockRejectedValue({ code: "menu.shortcut_unreachable" }),
    });
    const el = await mountHome(client);
    emit(preview(el)!, "wt-shortcut-remove", { memberId: "t-chips" });
    await vi.waitFor(() => expect(homeError(el)).toBe(codeMessage("menu_section.not_found")));
    expect(q(el, '[data-test="member-error"]')).toBeNull();
    expect(preview(el)!.busy).toBe(false);
    const reads = client.getMenuHome.mock.calls.length;
    emit(preview(el)!, "wt-shortcut-move", { memberId: "t-chips", to: 0 });
    await vi.waitFor(() => expect(homeError(el)).toBe(codeMessage("menu.shortcut_unreachable")));
    expect(q(el, '[data-test="member-error"]')).toBeNull();
    await vi.waitFor(() => expect(client.getMenuHome.mock.calls.length).toBe(reads + 1));
  });

  it("reads the home again when a move's answer names shortcuts the list does not show", async () => {
    const client = api({
      moveHomeShortcut: vi
        .fn()
        .mockResolvedValue([
          productMember("t-other", 0, "p-lager"),
          productMember("t-burger", 1, "p-burger"),
        ]),
    });
    const el = await mountHome(client);
    const reads = client.getMenuHome.mock.calls.length;
    emit(preview(el)!, "wt-shortcut-move", { memberId: "t-burger", to: 1 });
    await vi.waitFor(() => expect(client.getMenuHome.mock.calls.length).toBe(reads + 1));
    expect(shortcutOrder(el)).toEqual(["t-burger", "t-drinks", "t-chips"]);
  });

  it("shows only the last of several queued moves' answers", async () => {
    const first = deferred<SectionMember[]>();
    const client = api();
    const answer = client.moveHomeShortcut.getMockImplementation() as (
      menuId: string,
      memberId: string,
      to: number,
    ) => Promise<SectionMember[]>;
    client.moveHomeShortcut.mockImplementationOnce(() => first.promise);
    const el = await mountHome(client);
    emit(preview(el)!, "wt-shortcut-move", { memberId: "t-chips", to: 0 });
    emit(preview(el)!, "wt-shortcut-move", { memberId: "t-drinks", to: 0 });
    first.resolve(await answer("menu-lunch", "t-chips", 0));
    await vi.waitFor(() => expect(client.moveHomeShortcut).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(shortcutOrder(el)).toEqual(["t-drinks", "t-burger", "t-chips"]));
  });

  it("reads the home again, rather than showing a move's answer, when a newer read changed the order while it was out", async () => {
    const live = new LiveData();
    const moved = deferred<SectionMember[]>();
    const client = api({ liveData: live, moveHomeShortcut: vi.fn(() => moved.promise) });
    const el = await mountHome(client);
    emit(preview(el)!, "wt-shortcut-move", { memberId: "t-chips", to: 0 });
    await vi.waitFor(() => expect(client.moveHomeShortcut).toHaveBeenCalled());
    client.getMenuHome.mockResolvedValue(homeWith("t-drinks", "t-chips", "t-burger"));
    live.invalidate([{ type: "section_members" }]);
    await vi.waitFor(() => expect(shortcutOrder(el)).toEqual(["t-drinks", "t-chips", "t-burger"]));
    const reads = client.getMenuHome.mock.calls.length;
    moved.resolve([
      productMember("t-chips", 0, "p-chips"),
      productMember("t-burger", 1, "p-burger"),
      sectionMember("t-drinks", 2, "s-drinks"),
    ]);
    await vi.waitFor(() => expect(client.getMenuHome.mock.calls.length).toBe(reads + 1));
    expect(shortcutOrder(el)).toEqual(["t-drinks", "t-chips", "t-burger"]);
  });

  it("counts a shortcut add as a write to the same home as a move, so the move's answer waits for the add's read", async () => {
    const moved = deferred<SectionMember[]>();
    const added = deferred<SectionMember>();
    const client = api({
      moveHomeShortcut: vi.fn(() => moved.promise),
      addHomeShortcut: vi.fn(() => added.promise),
    });
    const el = await mountHome(client);
    const reads = client.getMenuHome.mock.calls.length;
    emit(preview(el)!, "wt-shortcut-move", { memberId: "t-chips", to: 0 });
    inPreview(el, "add-product")!.click();
    const modal = () =>
      q<HTMLElementTagNameMap["wt-modal"]>(el, 'wt-modal[data-test="add-shortcut"]')!;
    await vi.waitFor(() => expect(modal().open).toBe(true));
    await chooseOption(
      modal().querySelector<HTMLElementTagNameMap["wt-combobox"]>(
        'wt-combobox[name="shortcut-product"]',
      )!,
      "p-lager",
    );
    moved.resolve([
      productMember("t-chips", 0, "p-chips"),
      productMember("t-burger", 1, "p-burger"),
      sectionMember("t-drinks", 2, "s-drinks"),
    ]);
    await vi.waitFor(() => expect(client.addHomeShortcut).toHaveBeenCalled());
    // The move was not the home's last write, so its answer is not shown over the add.
    expect(shortcutOrder(el)).toEqual(["t-burger", "t-drinks", "t-chips"]);
    added.resolve(productMember("t-new", 3, "p-lager"));
    await vi.waitFor(() => expect(client.getMenuHome.mock.calls.length).toBe(reads + 1));
  });

  it("opens the add window of the kind the preview's add tile names", async () => {
    const el = await mountHome();
    const modal = () =>
      q<HTMLElementTagNameMap["wt-modal"]>(el, 'wt-modal[data-test="add-shortcut"]')!;
    emit(preview(el)!, "wt-shortcut-add", { kind: "section" });
    await vi.waitFor(() => expect(modal().open).toBe(true));
    expect(modal().querySelector('wt-combobox[name="shortcut-section"]')).not.toBeNull();
  });

  it("drops a refused move quietly once the person has gone to another menu", async () => {
    const refusal = deferred<SectionMember[]>();
    const client = api({ moveHomeShortcut: vi.fn(() => refusal.promise) });
    const el = await mountHome(client);
    emit(preview(el)!, "wt-shortcut-move", { memberId: "t-chips", to: 0 });
    await toMenu(el, "/manage/menus/menu/menu-dinner/view/home", "Dinner Menu");
    const lunchReads = () =>
      client.getMenuHome.mock.calls.filter(([id]) => id === "menu-lunch").length;
    const before = lunchReads();
    refusal.reject({ code: "menu_section.not_found" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await el.updateComplete;
    expect(q(el, '[data-test="home-error"]')).toBeNull();
    expect(lunchReads()).toBe(before);
  });

  it("drops a refused remove quietly once the person has gone to another menu", async () => {
    const refusal = deferred<void>();
    const client = api({ removeHomeShortcut: vi.fn(() => refusal.promise) });
    const el = await mountHome(client);
    emit(preview(el)!, "wt-shortcut-remove", { memberId: "t-chips" });
    await vi.waitFor(() => expect(client.removeHomeShortcut).toHaveBeenCalled());
    await toMenu(el, "/manage/menus/menu/menu-dinner/view/home", "Dinner Menu");
    refusal.reject({ code: "menu_section.not_found" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await el.updateComplete;
    expect(q(el, '[data-test="home-error"]')).toBeNull();
  });

  describe("focus after a remove", () => {
    const focused = (el: MenusScreen) =>
      el.shadowRoot!.activeElement === preview(el)
        ? (preview(el)!.shadowRoot!.activeElement?.getAttribute("data-test") ?? null)
        : null;

    it.each([
      { removed: "t-drinks", left: ["t-burger", "t-chips"], to: "actions-t-chips" },
      { removed: "t-chips", left: ["t-burger", "t-drinks"], to: "actions-t-drinks" },
      { removed: "t-burger", left: [], to: "add-product" },
    ])(
      "goes to the next shortcut's ⋮, else the previous one's, else the add products tile (removing $removed)",
      async ({ removed, left, to }) => {
        const reread = deferred<MenuHome>();
        const start = removed === "t-burger" ? homeWith("t-burger") : menuHome();
        const client = api({ getMenuHome: vi.fn().mockResolvedValueOnce(start) });
        const el = await mountHome(client);
        client.getMenuHome.mockImplementationOnce(() => reread.promise);
        emit(preview(el)!, "wt-shortcut-remove", { memberId: removed });
        await vi.waitFor(() => expect(client.removeHomeShortcut).toHaveBeenCalled());
        await vi.waitFor(() => expect(client.getMenuHome).toHaveBeenCalledTimes(2));
        reread.resolve(homeWith(...left));
        await vi.waitFor(() => expect(focused(el)).toBe(to));
      },
    );

    it("stays on the shortcut's own ⋮ when its remove is refused", async () => {
      const client = api({
        removeHomeShortcut: vi.fn().mockRejectedValue({ code: "menu_section.not_found" }),
      });
      const el = await mountHome(client);
      emit(preview(el)!, "wt-shortcut-remove", { memberId: "t-drinks" });
      await vi.waitFor(() => expect(focused(el)).toBe("actions-t-drinks"));
    });
  });

  describe("layout", () => {
    async function atWidth(width: number) {
      const frame = { width: window.innerWidth, height: window.innerHeight };
      await page.viewport(width, 900);
      onTestFinished(() => page.viewport(frame.width, frame.height));
      const el = await mountHome();
      const previewBox = q(el, '[data-test="home-preview-pane"]')!.getBoundingClientRect();
      const settingsBox = q(el, '[data-test="home-settings"]')!.getBoundingClientRect();
      return { previewBox, settingsBox };
    }

    it("puts the preview on the left and the settings on the right on a wide screen", async () => {
      const { previewBox, settingsBox } = await atWidth(1280);
      expect(previewBox.right).toBeLessThanOrEqual(settingsBox.left);
      expect(previewBox.width).toBeGreaterThan(settingsBox.width);
      expect(Math.abs(previewBox.top - settingsBox.top)).toBeLessThan(1);
    });

    it("stacks the preview above the settings on a phone", async () => {
      const { previewBox, settingsBox } = await atWidth(390);
      expect(previewBox.bottom).toBeLessThanOrEqual(settingsBox.top);
      expect(Math.abs(previewBox.left - settingsBox.left)).toBeLessThan(1);
    });
  });
});
