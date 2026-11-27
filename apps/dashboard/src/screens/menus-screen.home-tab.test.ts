import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import { chooseOptions } from "@waitron/ui/src/test-helpers.js";
import {
  cleanupWidgets,
  documentProduct,
  documentSection,
  menuDocument,
  mountWidget,
} from "../widgets/test-helpers.js";
import { MenusScreen } from "./menus-screen.js";
import type {
  DashboardApi,
  MemberRef,
  MenuHome,
  MenuPreview,
  MenuStatus,
  Product,
} from "../api/client.js";
import type {
  MenuSummary,
  MenuReadPart,
  MenuStructure,
  MenuStructureNode,
} from "../api/menu-api.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";

afterEach(cleanupWidgets);
beforeEach(() => sessionStorage.clear());

const HOME_PATH = "/menus/menu/menu-lunch/view/home";

function product(id: string, name: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    modifiers: [],
    categoryId: null,
    primaryCategoryId: null,
    name,
    customerName: { es: `${name} para clientes`, en: `${name} for guests` },
    unitId: "unit-each",
    unit: {
      staffName: "Staff unit",
      staffAbbreviation: "su",
      id: "unit-each",
      name: { es: "Unidad" },
      precision: 0,
      abbreviation: { es: "ud" },
    },
    description: null,
    kitchenName: `${name.toUpperCase()} KITCHEN`,
    dietaryDeclarations: [],
    pricingUnit: "each",
    unitPrice: "2.00",
    vatClass: "general",
    takeawayVatRate: "21.00",
    active: true,
    available: true,
    ordering: "public",
    allergens: null,
    diet: { vegan: "unknown", vegetarian: "unknown", contains: [] },
    dietOverride: null,
    image: null,
    color: null,
    variants: [],
    courseId: null,
    ...overrides,
  };
}

const products: Product[] = [
  product("p-lager", "Lager"),
  product("p-lemonade", "Lemonade"),
  product("p-burger", "Burger"),
  product("p-chips", "Chips"),
];

const menus: MenuSummary[] = [
  {
    id: "menu-lunch",
    name: "Lunch Menu",
    active: true,
    kind: "menu",
    setPrice: null,
  },
  {
    id: "menu-dinner",
    name: "Dinner Menu",
    active: true,
    kind: "menu",
    setPrice: null,
  },
];

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
    placeableSetMenus: [],
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
    setMenuProblems: [],
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
    order: "home_first",
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
  "saveMenuHome",
] as const;

function api(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}) {
  const client = {
    listMenus: vi.fn().mockResolvedValue(menus),
    listLibraryProducts: vi.fn().mockResolvedValue(products),
    listCategories: vi.fn().mockResolvedValue([]),
    getMenuSettings: vi
      .fn()
      .mockResolvedValue({ defaultProductVatClass: "general", defaultColor: null }),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getMenuStructure: vi.fn(async (id: string) => structureOf(id)),
    addSectionMember: vi.fn(),
    removeSectionMember: vi.fn(),
    moveSectionMember: vi.fn(),
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
    saveMenuHome: vi.fn(),
    ...overrides,
  };
  Object.assign(client, {
    getMenuRead: vi.fn(async (id: string, parts: readonly MenuReadPart[]) => {
      const readClient = client as unknown as DashboardApi;
      const reads = {
        structure: () => readClient.getMenuStructure(id),
        prices: async () => [],
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

async function chooseTab(el: MenusScreen, key: string): Promise<void> {
  const tabs = q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!;
  tabs.shadowRoot!.querySelector<HTMLElement>(`[role="tab"][data-key="${key}"]`)!.click();
  await el.updateComplete;
}

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

async function openAdd(el: MenusScreen): Promise<Picker> {
  await preview(el)!.updateComplete;
  inPreview(el, "add-shortcuts")!.click();
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

describe("the Structure tab without the home", () => {
  const homeReads = (client: Api) =>
    client.getMenuHome.mock.calls.length +
    (client.getMenuRead as ReturnType<typeof vi.fn>).mock.calls.filter(([, parts]) =>
      (parts as MenuReadPart[]).includes("home"),
    ).length;

  it("makes no home read on the Structure tab, opened from its address or from the Home page tab", async () => {
    const live = new LiveData();
    const client = api({ liveData: live });
    history.replaceState(null, "", "/menus/menu/menu-lunch/view/structure");
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

  it("marks a shortcut hidden when the product is no longer on sale", async () => {
    const client = api({
      listLibraryProducts: vi
        .fn()
        .mockResolvedValue(products.map((p) => ({ ...p, active: false }))),
      getMenuPreview: vi
        .fn()
        .mockResolvedValue({ ...previewOf("menu-lunch"), document: menuDocument([], {}) }),
      getMenuHome: vi.fn().mockResolvedValue(homeWith("t-burger")),
    });
    const el = await mountHome(client);
    const hidden = preview(el)!.shadowRoot!.querySelector('.tile[data-state="hidden"]')!;
    expect(text(hidden)).toContain(t("home.not_shown_not_on_sale"));
    expect(client.listMenus).toHaveBeenCalledTimes(1);
  });

  it("keeps an unchanged menu preview from rendering on unrelated screen updates", async () => {
    const el = await mountHome();
    const home = preview(el)!;
    const updates = vi.spyOn(home as unknown as { updated(): void }, "updated");
    onTestFinished(() => updates.mockRestore());
    for (let i = 0; i < 3; i++) {
      el.requestUpdate();
      await el.updateComplete;
      await home.updateComplete;
    }
    expect(updates).not.toHaveBeenCalled();
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
    await chooseTab(el, "structure");
    const reads = client.getMenuHome.mock.calls.length;
    live.invalidate([{ type: "sections" }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.getMenuHome.mock.calls.length).toBe(reads);
  });

  it("stages removes and consecutive moves without writing or rereading the page", async () => {
    const client = api();
    const el = await mountHome(client);
    const reads = client.getMenuHome.mock.calls.length;
    inPreview(el, "remove-t-chips")!.click();
    emit(preview(el)!, "wt-shortcut-move", { memberId: "t-drinks", to: 0 });
    await el.updateComplete;
    expect(shortcutOrder(el)).toEqual(["t-drinks", "t-burger"]);
    emit(preview(el)!, "wt-shortcut-move", { memberId: "t-burger", to: 0 });
    await el.updateComplete;
    expect(shortcutOrder(el)).toEqual(["t-burger", "t-drinks"]);
    expect(writeCalls(client)).toEqual([]);
    expect(client.getMenuHome.mock.calls.length).toBe(reads);
  });

  it("keeps staged order during a live read and shows renamed or missing saved shortcuts", async () => {
    const live = new LiveData();
    const client = api({ liveData: live });
    const el = await mountHome(client);
    emit(preview(el)!, "wt-shortcut-move", { memberId: "t-chips", to: 0 });
    const renamed = homeWith("t-drinks", "t-burger", "t-chips");
    renamed.shortcuts[1]!.name = "New burger";
    renamed.shortcuts[0] = {
      ...renamed.shortcuts[0]!,
      name: "Drinks",
      ref: { kind: "missing", name: "Drinks" },
      missingName: "Drinks",
      reachable: false,
    };
    client.getMenuHome.mockResolvedValue(renamed);
    live.invalidate([{ type: "sections" }]);
    await vi.waitFor(() => expect(preview(el)!.shortcuts![1]!.name).toBe("New burger"));
    expect(shortcutOrder(el)).toEqual(["t-chips", "t-burger", "t-drinks"]);
    expect(preview(el)!.shortcuts![2]!.ref).toEqual({ kind: "missing", name: "Drinks" });
    q(el, '[data-test="home-cancel"]')!.click();
    await vi.waitFor(() => expect(shortcutOrder(el)).toEqual(["t-drinks", "t-burger", "t-chips"]));
  });

  describe("focus after a remove", () => {
    const focused = (el: MenusScreen) =>
      el.shadowRoot!.activeElement === preview(el)
        ? (preview(el)!.shadowRoot!.activeElement?.getAttribute("data-test") ?? null)
        : null;

    it.each([
      { removed: "t-drinks", left: ["t-burger", "t-chips"], to: "remove-t-chips" },
      { removed: "t-chips", left: ["t-burger", "t-drinks"], to: "remove-t-drinks" },
      { removed: "t-burger", left: [], to: "add-shortcuts" },
    ])(
      "goes to the next shortcut's Remove button, else the previous one's, else the Add shortcuts tile (removing $removed)",
      async ({ removed, left, to }) => {
        const start = removed === "t-burger" ? homeWith("t-burger") : menuHome();
        const client = api({ getMenuHome: vi.fn().mockResolvedValue(start) });
        const el = await mountHome(client);
        emit(preview(el)!, "wt-shortcut-remove", { memberId: removed });
        await vi.waitFor(() => expect(focused(el)).toBe(to));
        expect(shortcutOrder(el)).toEqual(left);
        expect(writeCalls(client)).toEqual([]);
      },
    );
  });

  it.each([360, 390, 768, 769, 1280])(
    "places Shown first above the preview at %s px",
    async (width) => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      await page.viewport(width, 900);
      onTestFinished(() => page.viewport(viewport.width, viewport.height));
      const el = await mountHome();
      const control = q<HTMLElementTagNameMap["wt-segmented-control"]>(
        el,
        'wt-segmented-control[name="home-order"]',
      )!;
      const widget = preview(el)!;
      await widget.updateComplete;
      await control.updateComplete;
      expect(control.getBoundingClientRect().bottom).toBeLessThan(
        widget.getBoundingClientRect().top,
      );
      const grid = widget.shadowRoot!.querySelector(".grid")!;
      const tracks = getComputedStyle(grid).gridTemplateColumns.split(" ");
      expect(tracks).toHaveLength(width >= 768 ? 6 : 3);
      const label = control.shadowRoot!.querySelector(".label")!.getBoundingClientRect();
      const row = control.shadowRoot!.querySelector('[role="radiogroup"]')!.getBoundingClientRect();
      if (width > 768) {
        expect(row.width).toBeLessThan(350);
        expect(label.right).toBeLessThan(row.left);
        expect(label.top + label.height / 2).toBeCloseTo(row.top + row.height / 2, 1);
      }
      if (width === 768) expect(row.width).toBeLessThanOrEqual(576);
      if (width <= 390) {
        expect(label.bottom).toBeLessThan(row.top);
        const buttons = [...control.shadowRoot!.querySelectorAll("button")];
        const [first, second] = buttons.map((button) => button.getBoundingClientRect().width);
        expect(first).toBeCloseTo(second!, 1);
        expect(widget.getBoundingClientRect().width).toBeCloseTo(
          control.getBoundingClientRect().width,
        );
      }
    },
  );
});

describe("adding shortcuts on the Home page tab", () => {
  it("holds a staged shortcut while the live structure loses and regains its product", async () => {
    const liveData = new LiveData();
    const client = api({
      liveData,
      getMenuHome: vi.fn().mockResolvedValue(homeWith("t-burger")),
    });
    const el = await mountHome(client);
    await openAdd(el);
    await choose(el, ["product:p-lager"]);
    pressAdd(el);
    const ref = { kind: "product", productId: "p-lager" };
    const tile = () => preview(el)?.shortcuts?.find((shortcut) => shortcut.name === "Lager");
    await vi.waitFor(() => expect(tile()?.reachable).toBe(true));
    const memberId = tile()!.memberId;

    const structure = structureOf("menu-lunch");
    structure.nodes = [productNode("m-burger", "p-burger")];
    client.getMenuStructure.mockResolvedValue(structure);
    liveData.invalidate([{ type: "sections" }]);
    await vi.waitFor(() =>
      expect(tile()).toMatchObject({ memberId, ref, reachable: false, missingName: "Lager" }),
    );

    client.getMenuStructure.mockResolvedValue(structureOf("menu-lunch"));
    liveData.invalidate([{ type: "sections" }]);
    await vi.waitFor(() =>
      expect(tile()).toMatchObject({ memberId, ref, reachable: true, missingName: null }),
    );
    expect(writeCalls(client)).toEqual([]);
  });

  it("returns focus to Add shortcuts after staging products and sections", async () => {
    const client = api({ getMenuHome: vi.fn().mockResolvedValue(homeWith("t-burger")) });
    const el = await mountHome(client);
    await openAdd(el);
    await choose(el, ["section:s-drinks", "product:p-lager"]);
    pressAdd(el);
    await vi.waitFor(() => expect(addWindow(el).open).toBe(false));
    await vi.waitFor(() =>
      expect(preview(el)!.shadowRoot!.activeElement?.getAttribute("data-test")).toBe(
        "add-shortcuts",
      ),
    );
    expect(preview(el)!.shortcuts!.map(({ ref }) => ref)).toEqual([
      { kind: "product", productId: "p-burger" },
      { kind: "section", sectionId: "s-drinks" },
      { kind: "product", productId: "p-lager" },
    ]);
    expect(preview(el)!.shortcuts!.map(({ name }) => name)).toEqual(["Burger", "Drinks", "Lager"]);
    expect(writeCalls(client)).toEqual([]);
  });

  it("offers an included menu holding a replacement pattern by its name as written", async () => {
    const before = currentLocale();
    setLocale("en");
    onTestFinished(() => setLocale(before));
    const el = await mountHome(
      api({
        getMenuHome: vi.fn().mockResolvedValue(homeWith()),
        getMenuStructure: vi.fn().mockResolvedValue({
          ...structureOf("menu-lunch"),
          nodes: [
            {
              memberId: "m-drinks",
              ref: { kind: "section", sectionId: "included-drinks" },
              internalName: "Drinks $&",
              children: [],
              includedMenuId: "menu-drinks",
            },
          ],
        }),
      }),
    );
    expect((await openAdd(el)).options.map(({ value, label }) => ({ value, label }))).toEqual([
      { value: "section:included-drinks", label: "Menu: Drinks $& (section)" },
    ]);
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
      await openAdd(el);
      expect(addWindow(el).heading).toBe(t("home.add_shortcuts"));
      expect(combobox(el).required).toBe(true);
      const sectionLabel = locale === "en" ? "section" : "sección";
      expect(picker(el).options.map(({ value, label }) => ({ value, label }))).toEqual([
        { value: "product:p-lager", label: "Drinks › Lager" },
        { value: "product:p-lemonade", label: "Drinks › Lemonade" },
        { value: "section:s-beer", label: `Drinks › Beer (${sectionLabel})` },
        { value: "section:s-fav", label: `Favourites (${sectionLabel})` },
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
      expect(
        (await openAdd(included)).options.map(({ value, label }) => ({ value, label })),
      ).toEqual([
        { value: "product:p-lager", label: "Drinks › Beer › Lager" },
        {
          value: "section:included-drinks",
          label: `${locale === "en" ? "Menu" : "Carta"}: Drinks (${sectionLabel})`,
        },
        { value: "section:included-beer", label: `Drinks › Beer (${sectionLabel})` },
      ]);
    },
  );

  it("closes the window on Cancel or Esc and sends nothing", async () => {
    const client = api();
    const el = await mountHome(client);
    await openAdd(el);
    const cancelled = new Promise((resolve) =>
      addWindow(el).addEventListener("wt-close", resolve, { once: true }),
    );
    picker(el).querySelector<HTMLElement>('[data-test="add-shortcut-cancel"]')!.click();
    await cancelled;
    expect(addWindow(el).open).toBe(false);
    await openAdd(el);
    combobox(el).focus();
    const closed = new Promise((resolve) =>
      addWindow(el).addEventListener("wt-close", resolve, { once: true }),
    );
    await userEvent.keyboard("{Escape}");
    await closed;
    await vi.waitFor(() => expect(addWindow(el).open).toBe(false));
    expect(writeCalls(client)).toEqual([]);
  });
});

describe("the add-shortcut window on a phone", () => {
  const offered = Array.from({ length: 200 }, (_, index) => {
    const n = String(index).padStart(3, "0");
    return product(`p-${n}`, `Product ${n}`);
  });

  it("keeps Add and Cancel inside the window at 390×700 with 200 products offered and 50 chosen", async () => {
    const before = [window.innerWidth, window.innerHeight] as const;
    await page.viewport(390, 700);
    onTestFinished(() => page.viewport(...before));
    const client = api({
      listLibraryProducts: vi.fn().mockResolvedValue(offered),
      getMenuStructure: vi.fn(async (id: string) => ({
        ...structureOf(id),
        nodes: offered.map(({ id: productId }) => productNode(`m-${productId}`, productId)),
      })),
      getMenuHome: vi.fn(async () => homeWith()),
    });
    const el = await mountHome(client);
    expect((await openAdd(el)).options).toHaveLength(200);
    await choose(
      el,
      offered.slice(0, 50).map(({ id }) => "product:" + id),
    );
    expect(combobox(el).values).toHaveLength(50);
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const body = addWindow(el).shadowRoot!.querySelector<HTMLElement>(".body")!;
    expect(body.scrollTop).toBe(0);
    const visible = body.getBoundingClientRect();
    const buttons = {
      Add: picker(el).shadowRoot!.querySelector<HTMLElement>('[data-test="add"]')!,
      Cancel: picker(el).querySelector<HTMLElement>('[data-test="add-shortcut-cancel"]')!,
    };
    for (const [label, button] of Object.entries(buttons)) {
      const box = button.getBoundingClientRect();
      expect(box.height, `${label} is drawn`).toBeGreaterThan(0);
      expect(box.top, `${label}: top in the window`).toBeGreaterThanOrEqual(0);
      expect(box.bottom, `${label}: bottom in the window`).toBeLessThanOrEqual(700);
      expect(box.left, `${label}: left in the window`).toBeGreaterThanOrEqual(0);
      expect(box.right, `${label}: right in the window`).toBeLessThanOrEqual(390);
      expect(box.bottom, `${label}: bottom in the body`).toBeLessThanOrEqual(visible.bottom);
    }
  });
});
