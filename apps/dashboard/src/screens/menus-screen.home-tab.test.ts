import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import { chooseOptions, formMessageOf } from "@waitron/ui/src/test-helpers.js";
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
import { currentLocale, setLocale, t } from "../i18n/t.js";

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

type Picker = HTMLElementTagNameMap["dashboard-home-shortcut-picker"];

function addWindow(el: MenusScreen): HTMLElementTagNameMap["wt-modal"] {
  return q<HTMLElementTagNameMap["wt-modal"]>(el, 'wt-modal[data-test="add-shortcut"]')!;
}

function picker(el: MenusScreen): Picker {
  return addWindow(el).querySelector<Picker>("dashboard-home-shortcut-picker")!;
}

function combobox(el: MenusScreen): HTMLElementTagNameMap["wt-combobox"] {
  return picker(el).shadowRoot!.querySelector("wt-combobox")!;
}

/** Opens the add window from the preview's add tile of `kind`. */
async function openAdd(el: MenusScreen, kind: "product" | "section"): Promise<Picker> {
  await preview(el)!.updateComplete;
  inPreview(el, `add-${kind}`)!.click();
  await vi.waitFor(() => expect(addWindow(el).open).toBe(true));
  await vi.waitFor(() => expect(picker(el)).not.toBeNull());
  await picker(el).updateComplete;
  return picker(el);
}

async function choose(el: MenusScreen, ids: string[]): Promise<void> {
  await chooseOptions(combobox(el), ids);
  await picker(el).updateComplete;
}

function pressAdd(el: MenusScreen): void {
  picker(el).shadowRoot!.querySelector<HTMLElement>('[data-test="add"]')!.click();
}

async function bottomMessage(el: MenusScreen): Promise<string> {
  const actions =
    picker(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
      "wt-form-actions",
    )!;
  return text((await formMessageOf(actions)) ?? null);
}

const productRef = (productId: string): MemberRef => ({ kind: "product", productId });

describe("the Structure tab without the home", () => {
  const homeReads = (client: Api) =>
    client.getMenuHome.mock.calls.length +
    (client.getMenuRead as ReturnType<typeof vi.fn>).mock.calls.filter(([, parts]) =>
      (parts as MenuReadPart[]).includes("home"),
    ).length;

  it("makes no home read on the Structure tab, opened from its address or from the Home page tab", async () => {
    const live = new LiveData();
    const client = api({ liveData: live });
    history.replaceState(null, "", "/manage/menus/menu/menu-lunch/view/structure");
    const { el } = await mountWidget<MenusScreen>("dashboard-menus-screen", { api: client });
    await vi.waitFor(() => expect(q(el, "dashboard-menu-structure-table")).not.toBeNull());
    live.invalidate([{ type: "sections" }]);
    await vi.waitFor(() => expect(client.getMenuStructure.mock.calls.length).toBeGreaterThan(1));
    expect(homeReads(client)).toBe(0);

    await chooseTab(el, "home");
    await vi.waitFor(() => expect(preview(el)?.shortcuts).toBeTruthy());
    await chooseTab(el, "structure");
    const reads = homeReads(client);
    const structureReads = client.getMenuStructure.mock.calls.length;
    live.invalidate([{ type: "sections" }]);
    await vi.waitFor(() =>
      expect(client.getMenuStructure.mock.calls.length).toBeGreaterThan(structureReads),
    );
    expect(homeReads(client)).toBe(reads);
  });
});

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
    await openAdd(el, "product");
    await choose(el, ["p-lager"]);
    pressAdd(el);
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
    emit(preview(el)!, "wt-shortcut-add", { kind: "section" });
    await vi.waitFor(() => expect(addWindow(el).open).toBe(true));
    expect(addWindow(el).heading).toBe(t("home.add_sections"));
    expect(picker(el).kind).toBe("section");
    expect(combobox(el).getAttribute("name")).toBe("shortcut-sections");
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

describe("adding shortcuts on the Home page tab", () => {
  /** Lunch's home holding only the Drinks section, so Burger, Lager and Lemonade are all offered. */
  const drinksOnly = () => homeWith("t-drinks");

  it("offers only what the menu reaches and is not already a shortcut", async () => {
    const el = await mountHome();
    // Burger and Drinks are shortcuts; Chips is on no list of Lunch's.
    expect((await openAdd(el, "product")).options.map(({ value }) => value)).toEqual([
      "p-lager",
      "p-lemonade",
    ]);
    expect(addWindow(el).heading).toBe(t("home.add_products"));
    picker(el).querySelector<HTMLElement>('[data-test="add-shortcut-cancel"]')!.click();
    await vi.waitFor(() => expect(addWindow(el).open).toBe(false));
    expect((await openAdd(el, "section")).options).toEqual([]);
  });

  it("adds three products in the order chosen inside one write, closes the window, then reads the home", async () => {
    const first = deferred<SectionMember>();
    const openAtRead: boolean[] = [];
    const client = api({ getMenuHome: vi.fn().mockResolvedValueOnce(drinksOnly()) });
    client.addHomeShortcut.mockImplementationOnce(() => first.promise);
    const el = await mountHome(client);
    client.getMenuHome.mockImplementation(async () => {
      openAtRead.push(addWindow(el).open);
      return homeWith("t-drinks", "t-burger");
    });
    await openAdd(el, "product");
    await choose(el, ["p-lemonade", "p-burger", "p-lager"]);
    pressAdd(el);
    await vi.waitFor(() => expect(client.addHomeShortcut).toHaveBeenCalledTimes(1));
    // A move made while the adds are out waits behind all three and their read.
    emit(preview(el)!, "wt-shortcut-move", { memberId: "t-drinks", to: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(client.addHomeShortcut).toHaveBeenCalledTimes(1);
    expect(client.moveHomeShortcut).not.toHaveBeenCalled();
    first.resolve(productMember("t-lemonade", 1, "p-lemonade"));
    await vi.waitFor(() => expect(client.moveHomeShortcut).toHaveBeenCalled());
    expect(client.addHomeShortcut.mock.calls).toEqual([
      ["menu-lunch", productRef("p-lemonade")],
      ["menu-lunch", productRef("p-burger")],
      ["menu-lunch", productRef("p-lager")],
    ]);
    expect(writeCalls(client)).toEqual([
      "addHomeShortcut",
      "addHomeShortcut",
      "addHomeShortcut",
      "moveHomeShortcut",
    ]);
    const lastAdd = Math.max(...client.addHomeShortcut.mock.invocationCallOrder);
    expect(client.moveHomeShortcut.mock.invocationCallOrder[0]).toBeGreaterThan(lastAdd);
    expect(addWindow(el).open).toBe(false);
    // The home is read only once the window has closed (a second read follows the move).
    expect(openAtRead[0]).toBe(false);
  });

  it("keeps the window open after a refusal of the second, with the second and third still chosen and the refused one named under the field", async () => {
    const client = api({ getMenuHome: vi.fn().mockResolvedValue(drinksOnly()) });
    client.addHomeShortcut
      .mockResolvedValueOnce(productMember("t-lemonade", 1, "p-lemonade"))
      .mockRejectedValueOnce({ code: "menu.shortcut_unreachable" });
    const el = await mountHome(client);
    await openAdd(el, "product");
    await choose(el, ["p-lemonade", "p-burger", "p-lager"]);
    const reads = client.getMenuHome.mock.calls.length;
    pressAdd(el);
    await vi.waitFor(() => expect(preview(el)!.busy).toBe(false));
    await vi.waitFor(() => expect(client.addHomeShortcut).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(client.addHomeShortcut).toHaveBeenCalledTimes(2);
    expect(addWindow(el).open).toBe(true);
    await picker(el).updateComplete;
    await combobox(el).updateComplete;
    expect(combobox(el).values).toEqual(["p-burger", "p-lager"]);
    expect(combobox(el).error).toBe(
      t("home.add_refused")
        .replace("{name}", "Burger")
        .replace("{reason}", codeMessage("menu.shortcut_unreachable")),
    );
    expect(await bottomMessage(el)).toBe(t("form.fix_fields"));
    expect(homeError(el)).toBe("");
    // Lemonade was added, so the home is read again for it.
    expect(client.getMenuHome.mock.calls.length).toBe(reads + 1);
  });

  it("puts a refusal that names no shortcut at the bottom and keeps every choice", async () => {
    const client = api({
      getMenuHome: vi.fn().mockResolvedValue(drinksOnly()),
      addHomeShortcut: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const el = await mountHome(client);
    await openAdd(el, "product");
    await choose(el, ["p-lager", "p-burger"]);
    const reads = client.getMenuHome.mock.calls.length;
    pressAdd(el);
    await vi.waitFor(() => expect(client.addHomeShortcut).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(preview(el)!.busy).toBe(false));
    await picker(el).updateComplete;
    await combobox(el).updateComplete;
    expect(addWindow(el).open).toBe(true);
    expect(combobox(el).values).toEqual(["p-lager", "p-burger"]);
    expect(combobox(el).error).toBe("");
    expect(await bottomMessage(el)).toBe(codeMessage("server.internal"));
    expect(client.getMenuHome.mock.calls.length).toBe(reads);
  });

  it("stops adding once the person has gone to another menu", async () => {
    const first = deferred<SectionMember>();
    const client = api({ getMenuHome: vi.fn().mockResolvedValue(drinksOnly()) });
    client.addHomeShortcut.mockImplementationOnce(() => first.promise);
    const el = await mountHome(client);
    await openAdd(el, "product");
    await choose(el, ["p-lemonade", "p-burger", "p-lager"]);
    pressAdd(el);
    await vi.waitFor(() => expect(client.addHomeShortcut).toHaveBeenCalledTimes(1));
    await toMenu(el, "/manage/menus/menu/menu-dinner/view/home", "Dinner Menu");
    const lunchReads = () =>
      client.getMenuHome.mock.calls.filter(([id]) => id === "menu-lunch").length;
    const before = lunchReads();
    first.resolve(productMember("t-lemonade", 1, "p-lemonade"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.addHomeShortcut).toHaveBeenCalledTimes(1);
    expect(lunchReads()).toBe(before);
    await vi.waitFor(() => expect(preview(el)?.busy).toBe(false));
  });

  describe("focus after an add", () => {
    const focused = (el: MenusScreen) =>
      el.shadowRoot!.activeElement === preview(el)
        ? (preview(el)!.shadowRoot!.activeElement?.getAttribute("data-test") ?? null)
        : null;

    it.each([
      { kind: "product" as const, ids: ["p-lager", "p-lemonade"], tile: "add-product" },
      { kind: "section" as const, ids: ["s-drinks"], tile: "add-section" },
    ])(
      "goes back to the $tile tile once the home has been read again",
      async ({ kind, ids, tile }) => {
        const reread = deferred<MenuHome>();
        const client = api({ getMenuHome: vi.fn().mockResolvedValueOnce(homeWith("t-burger")) });
        const el = await mountHome(client);
        client.getMenuHome.mockImplementationOnce(() => reread.promise);
        await openAdd(el, kind);
        await choose(el, ids);
        pressAdd(el);
        await vi.waitFor(() => expect(addWindow(el).open).toBe(false));
        await vi.waitFor(() => expect(client.addHomeShortcut).toHaveBeenCalledTimes(ids.length));
        expect(client.addHomeShortcut.mock.calls.map(([, ref]) => ref)).toEqual(
          ids.map((id) =>
            kind === "product" ? productRef(id) : { kind: "section", sectionId: id },
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(preview(el)!.busy).toBe(true);
        expect(focused(el)).not.toBe(tile);
        reread.resolve(homeWith("t-burger", "t-drinks"));
        await vi.waitFor(() => expect(focused(el)).toBe(tile));
      },
    );
  });

  it.each(["en", "es-ES"])(
    "offers as product shortcuts only active products the structure reaches, by their path, and as section shortcuts the sections it reaches, included menus' too, leaving out what is already a shortcut (%s)",
    async (locale) => {
      const before = currentLocale();
      setLocale(locale);
      onTestFinished(() => setLocale(before));
      const section = (
        memberId: string,
        sectionId: string,
        internalName: string,
        children: MenuStructureNode[],
        includedMenuId?: string,
      ): MenuStructureNode => ({
        memberId,
        ref: { kind: "section", sectionId },
        internalName,
        children,
        ...(includedMenuId ? { includedMenuId } : {}),
      });
      const lunch = (nodes: MenuStructureNode[]) => ({ ...structureOf("menu-lunch"), nodes });
      // Burger and Drinks are shortcuts, Chips is in no list on Lunch, and Old soup is inactive.
      const el = await mountHome(
        api({
          listLibraryProducts: vi
            .fn()
            .mockResolvedValue([...products, product("p-soup", "Old soup", { active: false })]),
          getMenuHome: vi.fn().mockResolvedValue(homeWith("t-burger", "t-drinks")),
          getMenuStructure: vi
            .fn()
            .mockResolvedValue(
              lunch([
                productNode("m-burger", "p-burger"),
                section("m-drinks", "s-drinks", "Drinks", [
                  productNode("m-lager", "p-lager"),
                  productNode("m-lemonade", "p-lemonade"),
                  section("m-beer", "s-beer", "Beer", [productNode("m-lager-2", "p-lager")]),
                  productNode("m-soup", "p-soup"),
                ]),
                section("m-fav", "s-fav", "Favourites", [
                  productNode("m-fav-lemonade", "p-lemonade"),
                ]),
              ]),
            ),
        }),
      );
      await openAdd(el, "product");
      expect(addWindow(el).heading).toBe(t("home.add_products"));
      expect(combobox(el).required).toBe(true);
      expect(picker(el).options).toEqual([
        { value: "p-lager", label: "Drinks › Lager" },
        { value: "p-lemonade", label: "Drinks › Lemonade" },
      ]);
      picker(el).querySelector<HTMLElement>('[data-test="add-shortcut-cancel"]')!.click();
      await vi.waitFor(() => expect(addWindow(el).open).toBe(false));
      await openAdd(el, "section");
      expect(addWindow(el).heading).toBe(t("home.add_sections"));
      expect(combobox(el).required).toBe(true);
      expect(picker(el).options).toEqual([
        { value: "s-beer", label: "Drinks › Beer" },
        { value: "s-fav", label: "Favourites" },
      ]);

      cleanupWidgets();
      const included = await mountHome(
        api({
          getMenuHome: vi.fn().mockResolvedValue(homeWith()),
          getMenuStructure: vi
            .fn()
            .mockResolvedValue(
              lunch([
                section(
                  "m-drinks",
                  "included-drinks",
                  "Drinks",
                  [section("m-beer", "included-beer", "Beer", [productNode("m-lager", "p-lager")])],
                  "menu-drinks",
                ),
              ]),
            ),
        }),
      );
      expect((await openAdd(included, "section")).options).toEqual([
        { value: "included-drinks", label: locale === "en" ? "Menu: Drinks" : "Carta: Drinks" },
        { value: "included-beer", label: "Drinks › Beer" },
      ]);
      picker(included).querySelector<HTMLElement>('[data-test="add-shortcut-cancel"]')!.click();
      await vi.waitFor(() => expect(addWindow(included).open).toBe(false));
      expect((await openAdd(included, "product")).options).toEqual([
        { value: "p-lager", label: "Drinks › Beer › Lager" },
      ]);
    },
  );

  it.each([
    { code: "menu.shortcut_unreachable", field: true },
    { code: "menu_section.member_duplicate", field: true },
    { code: "server.internal", field: false },
  ])(
    "puts a refused add ($code) under the field naming the item, or at the bottom, and reads the home no more",
    async ({ code, field }) => {
      const client = api({ addHomeShortcut: vi.fn().mockRejectedValue({ code }) });
      const el = await mountHome(client);
      const reads = client.getMenuHome.mock.calls.length;
      await openAdd(el, "product");
      await choose(el, ["p-lager"]);
      pressAdd(el);
      await vi.waitFor(() => expect(client.addHomeShortcut).toHaveBeenCalled());
      await vi.waitFor(() => expect(preview(el)!.busy).toBe(false));
      await picker(el).updateComplete;
      await combobox(el).updateComplete;
      expect(addWindow(el).open).toBe(true);
      expect(combobox(el).values).toEqual(["p-lager"]);
      expect(combobox(el).error).toBe(
        field
          ? t("home.add_refused")
              .replace("{name}", "Drinks › Lager")
              .replace("{reason}", codeMessage(code))
          : "",
      );
      expect(await bottomMessage(el)).toBe(field ? t("form.fix_fields") : codeMessage(code));
      expect(q(el, '[data-test="member-error"]')).toBeNull();
      expect(homeError(el)).toBe("");
      expect(client.getMenuHome.mock.calls.length).toBe(reads);
    },
  );

  it("closes the window on Cancel or Esc and sends nothing", async () => {
    const client = api();
    const el = await mountHome(client);
    await openAdd(el, "product");
    picker(el).querySelector<HTMLElement>('[data-test="add-shortcut-cancel"]')!.click();
    await vi.waitFor(() => expect(addWindow(el).open).toBe(false));
    await openAdd(el, "section");
    combobox(el).focus();
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(addWindow(el).open).toBe(false));
    expect(writeCalls(client)).toEqual([]);
  });

  it("sends one add, and none for an empty choice, when the picker asks for another add while one is out", async () => {
    const added = deferred<SectionMember>();
    const client = api({ addHomeShortcut: vi.fn(() => added.promise) });
    const el = await mountHome(client);
    await openAdd(el, "product");
    pressAdd(el);
    emit(picker(el), "wt-shortcuts-add", { kind: "product", ids: [] });
    await el.updateComplete;
    expect(client.addHomeShortcut).not.toHaveBeenCalled();
    await choose(el, ["p-lager"]);
    pressAdd(el);
    await vi.waitFor(() => expect(client.addHomeShortcut).toHaveBeenCalled());
    emit(picker(el), "wt-shortcuts-add", { kind: "product", ids: ["p-lemonade"] });
    await el.updateComplete;
    added.resolve(productMember("t-new", 3, "p-lager"));
    await vi.waitFor(() => expect(addWindow(el).open).toBe(false));
    await vi.waitFor(() => expect(preview(el)!.busy).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(client.addHomeShortcut).toHaveBeenCalledExactlyOnceWith(
      "menu-lunch",
      productRef("p-lager"),
    );
  });

  it("reads the home no more after a shortcut add once the person has gone to a tab that does not show it", async () => {
    const added = deferred<SectionMember>();
    const client = api({ addHomeShortcut: vi.fn(() => added.promise) });
    const el = await mountHome(client);
    await openAdd(el, "product");
    await choose(el, ["p-lager"]);
    pressAdd(el);
    await vi.waitFor(() => expect(client.addHomeShortcut).toHaveBeenCalled());
    await chooseTab(el, "prices");
    const reads = client.getMenuHome.mock.calls.length;
    added.resolve(productMember("t-new", 3, "p-lager"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.getMenuHome.mock.calls.length).toBe(reads);
  });

  it("reads the home no more than once per add plus once, with the live feed reporting each add", async () => {
    const live = new LiveData();
    const client = api({
      liveData: live,
      getMenuHome: vi.fn().mockResolvedValue(drinksOnly()),
    });
    client.addHomeShortcut.mockImplementation(async (_menu: string, ref: MemberRef) => {
      queueMicrotask(() => live.invalidate([{ type: "section_members" }]));
      return productMember(`t-${(ref as { productId: string }).productId}`, 1, "p-x");
    });
    const el = await mountHome(client);
    const homeReads = client.getMenuHome.mock.calls.length;
    const previewReads = client.getMenuPreview.mock.calls.length;
    await openAdd(el, "product");
    await choose(el, ["p-lemonade", "p-burger", "p-lager"]);
    pressAdd(el);
    await vi.waitFor(() => expect(addWindow(el).open).toBe(false));
    await vi.waitFor(() => expect(preview(el)!.busy).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const counted = {
      home: client.getMenuHome.mock.calls.length - homeReads,
      preview: client.getMenuPreview.mock.calls.length - previewReads,
    };
    expect(counted.home).toBeLessThanOrEqual(4);
    expect(counted.preview).toBeLessThanOrEqual(4);
    expect(counted.home).toBeGreaterThanOrEqual(1);
  });
});
