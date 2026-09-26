import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { MenusScreen } from "./menus-screen.js";
import type {
  CatalogueSummary,
  CategorySummary,
  DashboardApi,
  LibrarySection,
  MenuPriceRow,
  MenuStructure,
  MenuStructureNode,
  Product,
  SectionMember,
  SectionUsages,
} from "../api/client.js";
import type { MenuPricesTable } from "../widgets/menu-prices-table.js";
import type { MemberListEditor } from "../widgets/member-list-editor.js";
import type { MenuStructureTree } from "../widgets/menu-structure-tree.js";
import type { SectionAddProducts } from "../widgets/section-add-products.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";

afterEach(cleanupWidgets);
beforeEach(() => sessionStorage.clear());
beforeEach(() => history.replaceState(null, "", "/manage/menus"));

const LUNCH_PATH = "/manage/menus/menu/menu-lunch/view/structure";
const PRICES_PATH = "/manage/menus/menu/menu-lunch/view/prices";

/** The three names read differently (docs/developers/products.md), so a surface showing the
 * customer-facing or kitchen name where the staff name belongs fails. */
function product(id: string, name: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    modifiers: [],
    catalogueId: "cat-1",
    categoryId: null,
    labelIds: [],
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
    soldAlone: true,
    allergens: null,
    dietOverride: null,
    manualAllergens: null,
    image: null,
    variants: [],
    ...overrides,
  };
}

const products: Product[] = [
  product("p-lager", "Lager", { categoryId: "c-beer" }),
  product("p-lemonade", "Lemonade", { categoryId: "c-drinks" }),
  product("p-burger", "Burger", { categoryId: "c-mains" }),
  product("p-chips", "Chips", { categoryId: "c-mains" }),
  product("p-soup", "Old soup", { active: false }),
];

const categories: CategorySummary[] = [
  { id: "c-drinks", name: { es: "Bebidas" }, image: null, color: null, parentId: null },
  { id: "c-beer", name: { es: "Cerveza" }, image: null, color: null, parentId: "c-drinks" },
  { id: "c-mains", name: { es: "Principales" }, image: null, color: null, parentId: null },
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

/** Each section's customer names read differently from its internal name. */
function sections(): LibrarySection[] {
  return [
    {
      id: "s-drinks",
      internalName: "Drinks",
      names: { es: "Bebidas frías", en: "Something to drink" },
      image: null,
      color: null,
      members: [
        productMember("m-lager", 0, "p-lager"),
        sectionMember("m-beer", 1, "s-beer"),
        productMember("m-lemonade", 2, "p-lemonade"),
      ],
    },
    {
      id: "s-beer",
      internalName: "Beer",
      names: { es: "Cervezas" },
      image: null,
      color: null,
      members: [productMember("m-lager-2", 0, "p-lager")],
    },
    {
      id: "s-fav",
      internalName: "Favourites",
      names: { es: "Favoritos", en: "Our picks" },
      image: null,
      color: null,
      members: [
        productMember("m-fav-lemonade", 0, "p-lemonade"),
        sectionMember("m-fav-drinks", 1, "s-drinks"),
      ],
    },
    {
      id: "s-desserts",
      internalName: "Desserts",
      names: { es: "Postres" },
      image: null,
      color: null,
      members: [],
    },
  ];
}

const productNode = (memberId: string, productId: string): MenuStructureNode => ({
  memberId,
  ref: { kind: "product", productId },
});

function drinksNode(memberId: string, sectionId = "s-drinks"): MenuStructureNode {
  return {
    memberId,
    ref: { kind: "section", sectionId },
    children: [
      productNode("m-lager", "p-lager"),
      {
        memberId: "m-beer",
        ref: { kind: "section", sectionId: "s-beer" },
        children: [productNode("m-lager-2", "p-lager")],
      },
      productNode("m-lemonade", "p-lemonade"),
    ],
  };
}

/** Lunch: Burger, Drinks (with Beer inside) and Favourites (which holds Drinks again). */
function lunchNodes(): MenuStructureNode[] {
  return [
    productNode("m-burger", "p-burger"),
    drinksNode("m-drinks"),
    {
      memberId: "m-fav",
      ref: { kind: "section", sectionId: "s-fav" },
      children: [productNode("m-fav-lemonade", "p-lemonade"), drinksNode("m-fav-drinks")],
    },
  ];
}

const lunch = { id: "menu-lunch", name: "Lunch Menu" };
const dinner = { id: "menu-dinner", name: "Dinner Menu" };

function usages(): Record<string, SectionUsages> {
  return {
    "s-drinks": { menus: [dinner, lunch], sections: [{ id: "s-fav", internalName: "Favourites" }] },
    "s-beer": { menus: [dinner, lunch], sections: [{ id: "s-drinks", internalName: "Drinks" }] },
    "s-fav": { menus: [lunch], sections: [] },
    "s-desserts": { menus: [], sections: [] },
  };
}

/** Lemonade sits in Favourites and Drinks; Lager only inside Drinks' Beer. */
function lunchPrices(): MenuPriceRow[] {
  return [
    {
      menuItemId: "mi-burger",
      productId: "p-burger",
      name: "Burger",
      categoryId: "c-mains",
      placements: [[]],
      productPrice: "12.00",
      override: null,
      effectivePrice: "12.00",
      active: true,
      variants: [],
    },
    {
      menuItemId: "mi-lemonade",
      productId: "p-lemonade",
      name: "Lemonade",
      categoryId: "c-drinks",
      placements: [["s-fav"], ["s-drinks"]],
      productPrice: "3.00",
      override: "2.50",
      effectivePrice: "2.50",
      active: true,
      variants: [
        { variantId: "v-small", price: null, offered: true },
        { variantId: "v-large", price: "3.75", offered: false },
      ],
    },
    {
      menuItemId: "mi-lager",
      productId: "p-lager",
      name: "Lager",
      categoryId: "c-beer",
      placements: [["s-drinks", "s-beer"]],
      productPrice: "2.00",
      override: null,
      effectivePrice: "2.00",
      active: true,
      variants: [],
    },
  ];
}

/** Lemonade with two variants, each named differently for guests and the kitchen. */
function variantProducts(): Product[] {
  const variant = (id: string, name: string, unitPrice: string | null) => ({
    id,
    name,
    customerName: { es: `${name} para clientes` },
    kitchenName: `${name.toUpperCase()} COCINA`,
    image: null,
    unitPrice,
    available: true,
    active: true,
    effective: {
      unitPrice: unitPrice ?? "3.00",
      vatClass: "general" as const,
      primaryCategoryId: "c-drinks",
      labelIds: [],
    },
  });
  return products.map((each) =>
    each.id === "p-lemonade"
      ? {
          ...each,
          variants: [variant("v-small", "Small", null), variant("v-large", "Large", "3.40")],
        }
      : each,
  );
}

const WRITES = [
  "createCatalogue",
  "renameCatalogue",
  "createSection",
  "updateSection",
  "deleteSection",
  "addSectionMember",
  "addSectionProducts",
  "removeSectionMember",
  "moveSectionMember",
  "duplicateSection",
  "updateMenuItem",
  "setMenuVariants",
] as const;

/** A menu's top level the fake keeps, so a move is visible in what the next read answers. */
function api(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}) {
  let root = lunchNodes();
  const client = {
    listCatalogues: vi.fn().mockResolvedValue(menus),
    listSections: vi.fn().mockResolvedValue(sections()),
    listLibraryProducts: vi.fn().mockResolvedValue(products),
    listCategories: vi.fn().mockResolvedValue(categories),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getMenuStructure: vi.fn(async (id: string): Promise<MenuStructure> =>
      id === "menu-lunch"
        ? { rootSectionId: "root-lunch", nodes: structuredClone(root) }
        : { rootSectionId: "root-dinner", nodes: [] },
    ),
    listSectionUsages: vi.fn(async () => usages()),
    getSectionUsages: vi.fn(async (id: string) => usages()[id] ?? { menus: [], sections: [] }),
    createCatalogue: vi.fn(async (name: string) => ({
      id: "menu-new",
      name,
      active: true,
      version: 1,
    })),
    renameCatalogue: vi.fn().mockResolvedValue(undefined),
    createSection: vi.fn(async (input: { internalName: string }) => ({
      id: "s-new",
      internalName: input.internalName,
      names: {},
      image: null,
      color: null,
      members: [],
    })),
    updateSection: vi.fn(),
    deleteSection: vi.fn(),
    addSectionMember: vi.fn().mockResolvedValue(sectionMember("m-new", 3, "s-new")),
    addSectionProducts: vi.fn().mockResolvedValue({ added: 1 }),
    removeSectionMember: vi.fn().mockResolvedValue(undefined),
    moveSectionMember: vi.fn(async (list: string, memberId: string, to: number) => {
      if (list === "root-lunch") {
        const moved = root.find((node) => node.memberId === memberId)!;
        root = root.filter((node) => node !== moved);
        root.splice(to, 0, moved);
      }
      return root.map((node, position) => ({ id: node.memberId, position, ref: node.ref }));
    }),
    duplicateSection: vi.fn().mockResolvedValue({ ...sections()[0]!, id: "s-drinks-copy" }),
    getMenuPrices: vi.fn(async (id: string) => (id === "menu-lunch" ? lunchPrices() : [])),
    updateMenuItem: vi.fn().mockResolvedValue(undefined),
    setMenuVariants: vi.fn(async (_menu: string, _item: string, variants: unknown) => variants),
    ...overrides,
  };
  return client as unknown as DashboardApi & {
    [K in keyof DashboardApi]: ReturnType<typeof vi.fn>;
  };
}

type Api = ReturnType<typeof api>;

function writeCalls(client: Api): string[] {
  return WRITES.flatMap((name) =>
    (client[name] as ReturnType<typeof vi.fn>).mock.calls.map(() => name),
  );
}

async function mount(client: Api = api(), path = "/manage/menus") {
  history.replaceState(null, "", path);
  const { el } = await mountWidget<MenusScreen>("dashboard-menus-screen", { api: client });
  await vi.waitFor(() => {
    if (el.shadowRoot!.querySelector('[data-test="loading"]')) throw new Error("loading");
  });
  await el.updateComplete;
  return el;
}

/** Opens Lunch from its address and waits for its structure. */
async function mountLunch(client: Api = api()) {
  const el = await mount(client, LUNCH_PATH);
  await vi.waitFor(() => expect(tree(el)).not.toBeNull());
  await tree(el).updateComplete;
  return el;
}

function q<T extends Element = HTMLElement>(el: MenusScreen, selector: string): T | null {
  return el.shadowRoot!.querySelector<T>(selector);
}

type Table = HTMLElement & { updateComplete: Promise<unknown>; shadowRoot: ShadowRoot };

function table(el: MenusScreen): Table {
  return q<Table>(el, '[data-test="menus"]')!;
}

async function inTable(el: MenusScreen, testId: string): Promise<void> {
  await table(el).updateComplete;
  table(el).shadowRoot.querySelector<HTMLElement>(`[data-test="${testId}"]`)!.click();
  await el.updateComplete;
}

function modal(el: MenusScreen, testId: string) {
  return q<HTMLElementTagNameMap["wt-modal"]>(el, `wt-modal[data-test="${testId}"]`)!;
}

function inModal<T extends Element = HTMLElement>(
  el: MenusScreen,
  testId: string,
  selector: string,
): T {
  return modal(el, testId).querySelector<T>(selector)!;
}

async function summary(el: MenusScreen, testId: string): Promise<string[]> {
  const found = inModal<HTMLElementTagNameMap["wt-form-error-summary"]>(
    el,
    testId,
    "wt-form-error-summary",
  );
  await found.updateComplete;
  return [...found.shadowRoot!.querySelectorAll("li")].map((item) => item.textContent!.trim());
}

function type(target: Element, value: string): void {
  target.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

function emit(target: Element, name: string, detail: unknown): void {
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}

function tree(el: MenusScreen): MenuStructureTree {
  return q<MenuStructureTree>(el, "dashboard-menu-structure-tree")!;
}

function inTree(el: MenusScreen, selector: string): HTMLElement | null {
  return tree(el).shadowRoot!.querySelector<HTMLElement>(selector);
}

async function clickInTree(el: MenusScreen, testId: string): Promise<void> {
  inTree(el, `[data-test="${testId}"]`)!.click();
  await tree(el).updateComplete;
  await el.updateComplete;
}

/** The tree's entries at the menu's own top level, whose paths are one member long. */
function topLevel(el: MenusScreen): HTMLElement[] {
  return [...tree(el).shadowRoot!.querySelectorAll<HTMLElement>("li[data-path]")].filter(
    (item) => !item.dataset.path!.includes("/"),
  );
}

function memberList(el: MenusScreen): MemberListEditor {
  return q<MemberListEditor>(el, "dashboard-member-list-editor")!;
}

function text(node: Element | null): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function breadcrumb(el: MenusScreen): string {
  return text(q(el, '[data-test="breadcrumb"]'));
}

/** Opens a list for editing the way a person does, through the tree. */
async function editDrinks(el: MenusScreen): Promise<void> {
  await clickInTree(el, "edit-m-drinks");
  await vi.waitFor(() => expect(breadcrumb(el)).toBe("Lunch Menu › Drinks"));
}

/** Another change's update, leaving Lunch with Burger alone, so the editor falls back to the top. */
async function takeDrinksOff(el: MenusScreen, client: Api, live: LiveData): Promise<void> {
  client.getMenuStructure.mockResolvedValue({
    rootSectionId: "root-lunch",
    nodes: [productNode("m-burger", "p-burger")],
  });
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() => expect(breadcrumb(el)).toBe("Lunch Menu"));
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

async function click(el: MenusScreen, testId: string): Promise<void> {
  q(el, `[data-test="${testId}"]`)!.click();
  await el.updateComplete;
}

// ---------------------------------------------------------------------------
// The menus list

it("lists the menus and opens one, recording the menu and its tab in the address", async () => {
  const el = await mount();
  expect(text(q(el, "h1"))).toBe(t("menus.title"));
  const rows = text(table(el).shadowRoot.querySelector("tbody"));
  expect(rows).toContain("Lunch Menu");
  expect(rows).toContain("Dinner Menu");
  await inTable(el, "open-menu-lunch");
  expect(location.pathname).toBe(LUNCH_PATH);
  await vi.waitFor(() => expect(text(q(el, "h1"))).toBe("Lunch Menu"));
  const tabs = q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!;
  expect(tabs.value).toBe("structure");
  expect(tabs.items.map((item) => item.key)).toEqual(["structure", "prices"]);
  history.back();
  await vi.waitFor(() => expect(location.pathname).toBe("/manage/menus"));
  await vi.waitFor(() => expect(text(q(el, "h1"))).toBe(t("menus.title")));
});

it("lists the menus by name, and reverses that order when the name heading is pressed", async () => {
  // Listed against name order, with ids that sort WITH that listing, so a list kept in the order
  // it came in, or sorted by id, fails.
  const el = await mount(
    api({
      listCatalogues: vi.fn().mockResolvedValue([
        { id: "menu-a", name: "Terrace Menu", active: true, version: 1 },
        { id: "menu-b", name: "Brunch Menu", active: true, version: 1 },
      ]),
    }),
  );
  const order = () =>
    [...table(el).shadowRoot.querySelectorAll("tbody tr")].map((row) =>
      row.getAttribute("data-row-key"),
    );
  expect(order()).toEqual(["menu-b", "menu-a"]);
  table(el).shadowRoot.querySelector<HTMLElement>('button[data-sort="name"]')!.click();
  await table(el).updateComplete;
  expect(order()).toEqual(["menu-a", "menu-b"]);
});

it("opens the menu and tab the address names, and leaves the list by the Back control", async () => {
  const client = api();
  const el = await mountLunch(client);
  expect(text(q(el, "h1"))).toBe("Lunch Menu");
  expect(client.getMenuStructure).toHaveBeenCalledWith("menu-lunch");
  await click(el, "back");
  expect(location.pathname).toBe("/manage/menus");
  expect(table(el)).not.toBeNull();
});

it("replaces an address naming an unknown menu or tab rather than adding a history entry", async () => {
  const before = history.length;
  const el = await mount(api(), "/manage/menus/menu/menu-gone/view/structure");
  await vi.waitFor(() => expect(location.pathname).toBe("/manage/menus"));
  expect(table(el)).not.toBeNull();
  cleanupWidgets();
  await mount(api(), "/manage/menus/menu/menu-lunch/view/bogus");
  await vi.waitFor(() => expect(location.pathname).toBe(LUNCH_PATH));
  expect(history.length).toBe(before);
});

it("creating a menu needs a name: an empty one is explained beside the field and in the summary", async () => {
  const client = api();
  const el = await mount(client);
  await click(el, "add-menu");
  expect(modal(el, "menu-form").open).toBe(true);
  const name = inModal<HTMLElementTagNameMap["wt-input"]>(el, "menu-form", 'wt-input[name="name"]');
  expect(name.required).toBe(true);
  inModal(el, "menu-form", '[data-test="menu-save"]').click();
  await el.updateComplete;
  expect(name.error).toBe(t("menus.name_required"));
  expect(await summary(el, "menu-form")).toEqual([t("menus.name_required")]);
  expect(client.createCatalogue).not.toHaveBeenCalled();

  type(name, "  Brunch  ");
  await el.updateComplete;
  expect(name.error).toBe("");
  inModal(el, "menu-form", '[data-test="menu-save"]').click();
  await vi.waitFor(() => expect(modal(el, "menu-form").open).toBe(false));
  expect(client.createCatalogue).toHaveBeenCalledExactlyOnceWith("Brunch");
  expect(client.listCatalogues).toHaveBeenCalledTimes(2);
  // Only the menus can have changed.
  for (const read of [
    client.listSections,
    client.listLibraryProducts,
    client.listCategories,
    client.getContentLanguages,
  ])
    expect(read).toHaveBeenCalledOnce();
});

it("saves a name on Enter in its field", async () => {
  const client = api();
  const el = await mount(client);
  await click(el, "add-menu");
  const name = inModal<HTMLElementTagNameMap["wt-input"]>(el, "menu-form", 'wt-input[name="name"]');
  type(name, "Brunch");
  await el.updateComplete;
  await name.updateComplete;
  name
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await vi.waitFor(() => expect(client.createCatalogue).toHaveBeenCalledExactlyOnceWith("Brunch"));
});

it("keeps the form and the name when the server refuses a new menu, and says why", async () => {
  const client = api({
    createCatalogue: vi.fn().mockRejectedValue({ code: "management.request_invalid" }),
  });
  const el = await mount(client);
  await click(el, "add-menu");
  const name = inModal<HTMLElementTagNameMap["wt-input"]>(el, "menu-form", 'wt-input[name="name"]');
  type(name, "Brunch");
  await el.updateComplete;
  inModal(el, "menu-form", '[data-test="menu-save"]').click();
  await vi.waitFor(async () =>
    expect(await summary(el, "menu-form")).toEqual([codeMessage("management.request_invalid")]),
  );
  expect(modal(el, "menu-form").open).toBe(true);
  expect(name.value).toBe("Brunch");
});

it("closes the form once a menu is created, even when the list then fails to reload", async () => {
  const client = api({
    listCatalogues: vi.fn().mockResolvedValueOnce(menus).mockRejectedValue(new Error("down")),
  });
  const el = await mount(client);
  await click(el, "add-menu");
  type(inModal(el, "menu-form", 'wt-input[name="name"]'), "Brunch");
  await el.updateComplete;
  inModal(el, "menu-form", '[data-test="menu-save"]').click();
  await vi.waitFor(() => expect(q(el, '[data-test="load-error"]')).not.toBeNull());
  expect(modal(el, "menu-form").open).toBe(false);
  expect(client.createCatalogue).toHaveBeenCalledOnce();
});

it("renames a menu, refusing an empty name", async () => {
  const client = api();
  const el = await mount(client);
  await inTable(el, "rename-menu-lunch");
  const name = inModal<HTMLElementTagNameMap["wt-input"]>(el, "menu-form", 'wt-input[name="name"]');
  expect(name.value).toBe("Lunch Menu");
  type(name, " ");
  await el.updateComplete;
  inModal(el, "menu-form", '[data-test="menu-save"]').click();
  await el.updateComplete;
  expect(name.error).toBe(t("menus.name_required"));
  expect(client.renameCatalogue).not.toHaveBeenCalled();
  type(name, "Weekday Lunch");
  await el.updateComplete;
  inModal(el, "menu-form", '[data-test="menu-save"]').click();
  await vi.waitFor(() => expect(modal(el, "menu-form").open).toBe(false));
  expect(client.renameCatalogue).toHaveBeenCalledExactlyOnceWith("menu-lunch", "Weekday Lunch");
  expect(client.createCatalogue).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(client.listCatalogues).toHaveBeenCalledTimes(2));
  expect(client.listSections).toHaveBeenCalledOnce();
});

it("says the menus could not be loaded, and tries again", async () => {
  const client = api({
    listCatalogues: vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(menus),
  });
  const el = await mount(client);
  expect(q(el, '[data-test="load-error"]')).not.toBeNull();
  await click(el, "retry");
  await vi.waitFor(() => expect(table(el)).not.toBeNull());
});

// ---------------------------------------------------------------------------
// The Structure tab

it("shows the root's members, and expanding Drinks shows its members inline", async () => {
  const el = await mountLunch();
  const names = () =>
    [...tree(el).shadowRoot!.querySelectorAll('[data-test="name"]')].map((name) => text(name));
  expect(names()).toEqual(["Burger", "Drinks", "Favourites"]);
  await clickInTree(el, "toggle-m-drinks");
  expect(names()).toEqual(["Burger", "Drinks", "Lager", "Beer", "Lemonade", "Favourites"]);
  // Staff names only.
  const shown = text(tree(el).shadowRoot!.querySelector("ul"));
  for (const wrong of ["Bebidas", "Something to drink", "for guests", "COCINA"])
    expect(shown).not.toContain(wrong);
});

it("edits the menu's own top level first, with no sharing to report and nothing to duplicate", async () => {
  const el = await mountLunch();
  expect(breadcrumb(el)).toBe("Lunch Menu");
  expect(memberList(el).members.map((member) => member.id)).toEqual([
    "m-burger",
    "m-drinks",
    "m-fav",
  ]);
  expect(memberList(el).members.map((member) => member.position)).toEqual([0, 1, 2]);
  expect(q(el, '[data-test="shared"]')).toBeNull();
  expect(q(el, '[data-test="duplicate-here"]')).toBeNull();
});

it("edits a section in place, showing the path followed as a text breadcrumb", async () => {
  const el = await mountLunch();
  await editDrinks(el);
  expect(memberList(el).members.map((member) => member.id)).toEqual([
    "m-lager",
    "m-beer",
    "m-lemonade",
  ]);
  emit(memberList(el), "wt-member-open", { sectionId: "s-beer" });
  await el.updateComplete;
  expect(breadcrumb(el)).toBe("Lunch Menu › Drinks › Beer");
  expect(memberList(el).members.map((member) => member.id)).toEqual(["m-lager-2"]);
  const crumbs = q(el, '[data-test="breadcrumb"]')!;
  expect(crumbs.tagName).toBe("NAV");
  expect(crumbs.querySelector('[aria-current="location"]')!.textContent!.trim()).toBe("Beer");
  // The tree marks the same place.
  await tree(el).updateComplete;
  expect(inTree(el, '[data-test="edit-m-drinks/m-beer"]')!.getAttribute("aria-current")).toBe(
    "true",
  );
  await click(el, "crumb-1");
  expect(breadcrumb(el)).toBe("Lunch Menu › Drinks");
  await click(el, "crumb-0");
  expect(breadcrumb(el)).toBe("Lunch Menu");
});

it("shows a shared section's wider use, and duplicates it into this place in ONE request", async () => {
  const copyName = t("sections.copy_name").replace("{name}", "Drinks");
  const client = api();
  const el = await mountLunch(client);
  await editDrinks(el);
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="shared"]'))).toBe(
      t("menus.shared").replace("{list}", "Dinner Menu, Favourites"),
    ),
  );
  expect(client.listSectionUsages).toHaveBeenCalledOnce();

  // What the menu reads once the copy has taken Drinks' place.
  const copied = lunchNodes();
  copied[1] = drinksNode("m-drinks", "s-drinks-copy");
  client.getMenuStructure.mockResolvedValue({ rootSectionId: "root-lunch", nodes: copied });
  client.listSections.mockResolvedValue([
    ...sections(),
    { ...sections()[0]!, id: "s-drinks-copy", internalName: copyName },
  ]);

  await click(el, "duplicate-here");
  const name = inModal<HTMLElementTagNameMap["wt-input"]>(
    el,
    "duplicate",
    'wt-input[name="internalName"]',
  );
  expect(name.value).toBe(copyName);
  inModal(el, "duplicate", '[data-test="duplicate-save"]').click();
  await vi.waitFor(() => expect(modal(el, "duplicate").open).toBe(false));

  expect(writeCalls(client)).toEqual(["duplicateSection"]);
  expect(client.duplicateSection).toHaveBeenCalledExactlyOnceWith("s-drinks", {
    internalName: copyName,
    memberIds: ["m-lager", "m-beer", "m-lemonade"],
    replaceIn: { sectionId: "root-lunch", memberId: "m-drinks" },
  });
  await vi.waitFor(() => expect(breadcrumb(el)).toBe(`Lunch Menu › ${copyName}`));
  await tree(el).updateComplete;
  expect(topLevel(el).map((item) => item.dataset.path)).toEqual(["m-burger", "m-drinks", "m-fav"]);
  expect(topLevel(el).map((item) => text(item.querySelector(".row [data-test='name']")))).toEqual([
    "Burger",
    copyName,
    "Favourites",
  ]);
});

it("reads a section's wider use from the live usages, and follows them when they change", async () => {
  const live = new LiveData();
  const client = api({ liveData: live });
  const el = await mountLunch(client);
  await editDrinks(el);
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="shared"]'))).toBe(
      t("menus.shared").replace("{list}", "Dinner Menu, Favourites"),
    ),
  );
  client.listSectionUsages.mockResolvedValue({
    ...usages(),
    "s-drinks": { menus: [lunch], sections: [] },
  });
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() => expect(q(el, '[data-test="not-shared"]')).not.toBeNull());
  expect(q(el, '[data-test="shared"]')).toBeNull();
  expect(client.getSectionUsages).not.toHaveBeenCalled();
});

it("says so while a section's wider use is being read, and when it cannot be, still offering the copy", async () => {
  let fail!: (error: unknown) => void;
  const client = api({
    listSectionUsages: vi.fn(() => new Promise((_, reject) => (fail = reject))),
  });
  const el = await mountLunch(client);
  await editDrinks(el);
  expect(text(q(el, '[role="status"].note'))).toBe(t("sections.usages_loading"));
  fail(new Error("down"));
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="usages-error"]'))).toBe(t("sections.usages_error")),
  );
  expect(q(el, '[data-test="duplicate-here"]')).not.toBeNull();
  expect(q(el, '[data-test="structure-error"]')).toBeNull();
  expect(q(el, '[data-test="load-error"]')).toBeNull();
});

it("puts a refused copy's reason beside the name only when the refusal names that field", async () => {
  const client = api({
    duplicateSection: vi
      .fn()
      .mockRejectedValueOnce({ code: "menu_section.invalid", params: { field: "internalName" } })
      .mockRejectedValueOnce({
        code: "menu_section.translation_required",
        params: { language: "en" },
      }),
  });
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "duplicate-here");
  const name = inModal<HTMLElementTagNameMap["wt-input"]>(
    el,
    "duplicate",
    'wt-input[name="internalName"]',
  );
  inModal(el, "duplicate", '[data-test="duplicate-save"]').click();
  await vi.waitFor(() => expect(name.error).toBe(codeMessage("menu_section.invalid")));
  expect(await summary(el, "duplicate")).toEqual([codeMessage("menu_section.invalid")]);
  // A language's name is not on this form, so its refusal is in the summary alone.
  inModal(el, "duplicate", '[data-test="duplicate-save"]').click();
  await vi.waitFor(async () =>
    expect(await summary(el, "duplicate")).toEqual([
      codeMessage("menu_section.translation_required"),
    ]),
  );
  expect(name.error).toBe("");
  expect(modal(el, "duplicate").open).toBe(true);
});

it("keeps the new-section form open and explains a refused section", async () => {
  const client = api({
    createSection: vi.fn().mockRejectedValue({ code: "management.request_invalid" }),
  });
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "new-section");
  type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Ciders");
  await el.updateComplete;
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(async () =>
    expect(await summary(el, "new-section")).toEqual([codeMessage("management.request_invalid")]),
  );
  expect(modal(el, "new-section").open).toBe(true);
  expect(client.addSectionMember).not.toHaveBeenCalled();
});

it("refuses a copy with no name beside the field, sending nothing", async () => {
  const client = api();
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "duplicate-here");
  const name = inModal<HTMLElementTagNameMap["wt-input"]>(
    el,
    "duplicate",
    'wt-input[name="internalName"]',
  );
  type(name, "");
  await el.updateComplete;
  inModal(el, "duplicate", '[data-test="duplicate-save"]').click();
  await el.updateComplete;
  expect(name.error).toBe(t("sections.internal_name_required"));
  expect(await summary(el, "duplicate")).toEqual([t("sections.internal_name_required")]);
  expect(writeCalls(client)).toEqual([]);
});

it("creates a section without leaving the editor and adds it to the list being edited", async () => {
  const client = api();
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "new-section");
  expect(modal(el, "new-section").open).toBe(true);
  const name = inModal<HTMLElementTagNameMap["wt-input"]>(
    el,
    "new-section",
    'wt-input[name="internalName"]',
  );
  expect(name.required).toBe(true);
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await el.updateComplete;
  expect(name.error).toBe(t("sections.internal_name_required"));
  expect(await summary(el, "new-section")).toEqual([t("sections.internal_name_required")]);
  expect(writeCalls(client)).toEqual([]);

  type(name, "Ciders");
  await el.updateComplete;
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(() => expect(modal(el, "new-section").open).toBe(false));
  expect(client.createSection).toHaveBeenCalledExactlyOnceWith({ internalName: "Ciders" });
  expect(client.addSectionMember).toHaveBeenCalledExactlyOnceWith("s-drinks", {
    kind: "section",
    sectionId: "s-new",
  });
  expect(breadcrumb(el)).toBe("Lunch Menu › Drinks");
});

it("says so when a created section could not then be added", async () => {
  const client = api({
    addSectionMember: vi.fn().mockRejectedValue({ code: "menu_section.member_cycle" }),
  });
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "new-section");
  type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Ciders");
  await el.updateComplete;
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(() => expect(q(el, '[data-test="member-error"]')).not.toBeNull());
  expect(modal(el, "new-section").open).toBe(false);
  expect(text(q(el, '[data-test="member-error"]'))).toBe(
    t("menus.section_not_added").replace("{name}", "Ciders"),
  );
});

it("closes the new-section form, sending nothing, when another change takes its list off the menu before Save", async () => {
  const live = new LiveData();
  const client = api({ liveData: live });
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "new-section");
  type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Ciders");
  await el.updateComplete;
  await takeDrinksOff(el, client, live);
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await new Promise((resolve) => setTimeout(resolve));
  expect(client.addSectionMember.mock.calls).toEqual([]);
  expect(writeCalls(client)).toEqual([]);
  expect(modal(el, "new-section").open).toBe(false);
  expect(text(q(el, '[data-test="member-error"]'))).toBe(
    t("menus.list_gone").replace("{name}", "Drinks"),
  );
});

it("keeps the new-section form open while its section is being created and its list leaves the menu, and shows a refusal there", async () => {
  const live = new LiveData();
  const creating = deferred<LibrarySection>();
  const client = api({ liveData: live, createSection: vi.fn(() => creating.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "new-section");
  type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Ciders");
  await el.updateComplete;
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(() => expect(client.createSection).toHaveBeenCalledOnce());
  await takeDrinksOff(el, client, live);
  expect(modal(el, "new-section").open).toBe(true);
  expect(modal(el, "new-section").heading).toBe(
    t("menus.new_section_heading").replace("{list}", "Drinks"),
  );
  creating.reject({ code: "management.request_invalid" });
  await vi.waitFor(async () =>
    expect(await summary(el, "new-section")).toEqual([codeMessage("management.request_invalid")]),
  );
  expect(modal(el, "new-section").open).toBe(true);
  expect(q(el, '[data-test="member-error"]')).toBeNull();
  expect(client.addSectionMember).not.toHaveBeenCalled();

  // Saved again, with its list gone, it closes and sends nothing.
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await new Promise((resolve) => setTimeout(resolve));
  expect(client.createSection).toHaveBeenCalledOnce();
  expect(modal(el, "new-section").open).toBe(false);
  expect(text(q(el, '[data-test="member-error"]'))).toBe(
    t("menus.list_gone").replace("{name}", "Drinks"),
  );
});

it("names the list a created section could not be added to when that list left the menu meanwhile", async () => {
  const live = new LiveData();
  const creating = deferred<LibrarySection>();
  const client = api({
    liveData: live,
    createSection: vi.fn(() => creating.promise),
    addSectionMember: vi.fn().mockRejectedValue({ code: "menu_section.not_found" }),
  });
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "new-section");
  type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Ciders");
  await el.updateComplete;
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(() => expect(client.createSection).toHaveBeenCalledOnce());
  await takeDrinksOff(el, client, live);
  creating.resolve({ ...sections()[3]!, id: "s-ciders", internalName: "Ciders" });
  await vi.waitFor(() => expect(q(el, '[data-test="member-error"]')).not.toBeNull());
  expect(client.addSectionMember).toHaveBeenCalledExactlyOnceWith("s-drinks", {
    kind: "section",
    sectionId: "s-ciders",
  });
  expect(modal(el, "new-section").open).toBe(false);
  expect(text(q(el, '[data-test="member-error"]'))).toBe(
    t("menus.section_not_added_to").replace("{name}", "Ciders").replace("{list}", "Drinks"),
  );
});

it("says a created section was added to its list when that list left the menu while it was being created", async () => {
  const live = new LiveData();
  const creating = deferred<LibrarySection>();
  const client = api({ liveData: live, createSection: vi.fn(() => creating.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "new-section");
  type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Ciders");
  await el.updateComplete;
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(() => expect(client.createSection).toHaveBeenCalledOnce());
  await takeDrinksOff(el, client, live);
  creating.resolve({ ...sections()[3]!, id: "s-ciders", internalName: "Ciders" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      t("menus.list_gone_saved").replace("{name}", "Drinks"),
    ),
  );
  expect(client.addSectionMember).toHaveBeenCalledExactlyOnceWith("s-drinks", {
    kind: "section",
    sectionId: "s-ciders",
  });
  expect(modal(el, "new-section").open).toBe(false);
});

it("shows no message when the person opens another list while a created section is being added and the add is saved", async () => {
  const adding = deferred<SectionMember>();
  const client = api({ addSectionMember: vi.fn(() => adding.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "new-section");
  type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Ciders");
  await el.updateComplete;
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(() => expect(client.addSectionMember).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(modal(el, "new-section").open).toBe(false));
  await click(el, "crumb-0");
  expect(breadcrumb(el)).toBe("Lunch Menu");
  adding.resolve(sectionMember("m-new", 3, "s-new"));
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  expect(q(el, '[data-test="member-error"]')).toBeNull();
});

it("names the list a removal takes a member out of, and offers no section delete", async () => {
  const client = api();
  const el = await mountLunch(client);
  const list = () => memberList(el);
  expect(list().listName).toBe("Lunch Menu");
  await editDrinks(el);
  expect(list().listName).toBe("Drinks");
  await list().updateComplete;
  const actions = list().shadowRoot!.querySelector('[data-test="actions-m-beer"]')!;
  const labels = [...actions.querySelectorAll("wt-button")].map((button) => text(button));
  expect(labels).toEqual([t("members.open"), t("members.remove_from").replace("{list}", "Drinks")]);
  expect(labels).not.toContain(t("action.delete"));
  list().shadowRoot!.querySelector<HTMLElement>('[data-test="remove-m-lemonade"]')!.click();
  await vi.waitFor(() =>
    expect(client.removeSectionMember).toHaveBeenCalledExactlyOnceWith("s-drinks", "m-lemonade"),
  );
  expect(client.deleteSection).not.toHaveBeenCalled();
});

it("adds a product or section chosen in the list to the list being edited", async () => {
  const client = api();
  const el = await mountLunch(client);
  await editDrinks(el);
  emit(memberList(el), "wt-member-add", { ref: { kind: "product", productId: "p-chips" } });
  await vi.waitFor(() =>
    expect(client.addSectionMember).toHaveBeenCalledExactlyOnceWith("s-drinks", {
      kind: "product",
      productId: "p-chips",
    }),
  );
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(2));
});

it("offers no section that would contain the list being edited", async () => {
  const el = await mountLunch();
  expect(memberList(el).excludeSectionIds).toEqual([]);
  await editDrinks(el);
  // Drinks itself, and Favourites, which holds it.
  expect([...memberList(el).excludeSectionIds].sort()).toEqual(["s-drinks", "s-fav"]);
});

it("ArrowUp and ArrowDown reorder the list being edited, and focus stays on the moved row", async () => {
  const client = api();
  const el = await mountLunch(client);
  const list = memberList(el);
  const handle = () =>
    list.shadowRoot!.querySelector<HTMLButtonElement>('[data-test="drag-m-burger"]')!;
  const order = () =>
    [...list.shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
      row.getAttribute("data-member"),
    );
  handle().focus();
  handle().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await vi.waitFor(() =>
    expect(client.moveSectionMember).toHaveBeenCalledWith("root-lunch", "m-burger", 1),
  );
  await vi.waitFor(() =>
    expect(topLevel(el).map((item) => item.dataset.path)).toEqual([
      "m-drinks",
      "m-burger",
      "m-fav",
    ]),
  );
  await el.updateComplete;
  await list.updateComplete;
  expect(order()).toEqual(["m-drinks", "m-burger", "m-fav"]);
  expect(list.shadowRoot!.activeElement).toBe(handle());

  handle().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  await vi.waitFor(() =>
    expect(client.moveSectionMember).toHaveBeenLastCalledWith("root-lunch", "m-burger", 0),
  );
  // The tree follows the order the server answered.
  await vi.waitFor(() =>
    expect(topLevel(el).map((item) => item.dataset.path)).toEqual([
      "m-burger",
      "m-drinks",
      "m-fav",
    ]),
  );
  await el.updateComplete;
  await list.updateComplete;
  expect(order()).toEqual(["m-burger", "m-drinks", "m-fav"]);
  expect(list.shadowRoot!.activeElement).toBe(handle());
  expect(client.getMenuStructure).toHaveBeenCalledOnce();
});

it("shows the order the last of several queued moves answered", async () => {
  const client = api();
  const el = await mountLunch(client);
  emit(memberList(el), "wt-member-move", { memberId: "m-burger", to: 1 });
  emit(memberList(el), "wt-member-move", { memberId: "m-burger", to: 2 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(topLevel(el).map((item) => item.dataset.path)).toEqual([
      "m-drinks",
      "m-fav",
      "m-burger",
    ]),
  );
  expect(client.getMenuStructure).toHaveBeenCalledOnce();
});

it("shows the order the last of several queued moves of different members answered, without reading the menu again", async () => {
  const client = api();
  const el = await mountLunch(client);
  emit(memberList(el), "wt-member-move", { memberId: "m-burger", to: 1 });
  emit(memberList(el), "wt-member-move", { memberId: "m-fav", to: 0 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(topLevel(el).map((item) => item.dataset.path)).toEqual([
      "m-fav",
      "m-drinks",
      "m-burger",
    ]),
  );
  await new Promise((resolve) => setTimeout(resolve));
  expect(client.getMenuStructure).toHaveBeenCalledOnce();
});

it("keeps another change's order that lands while a move is out, reading the menu again rather than showing the move's answer", async () => {
  const live = new LiveData();
  let answer!: (members: SectionMember[]) => void;
  const client = api({
    liveData: live,
    moveSectionMember: vi.fn(() => new Promise((resolve) => (answer = resolve))),
  });
  const el = await mountLunch(client);
  emit(memberList(el), "wt-member-move", { memberId: "m-burger", to: 1 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  // Another change's order reaches the screen before the move's answer does.
  const newer = lunchNodes().reverse();
  client.getMenuStructure.mockResolvedValue({ rootSectionId: "root-lunch", nodes: newer });
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() =>
    expect(topLevel(el).map((item) => item.dataset.path)).toEqual([
      "m-fav",
      "m-drinks",
      "m-burger",
    ]),
  );
  answer([
    sectionMember("m-drinks", 0, "s-drinks"),
    productMember("m-burger", 1, "p-burger"),
    sectionMember("m-fav", 2, "s-fav"),
  ]);
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  expect(topLevel(el).map((item) => item.dataset.path)).toEqual(["m-fav", "m-drinks", "m-burger"]);
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(3));
  await el.updateComplete;
  expect(memberList(el).members.map((member) => member.id)).toEqual([
    "m-fav",
    "m-drinks",
    "m-burger",
  ]);
});

it("reads the menu again when another change moves a different item past the moved one while the move is out", async () => {
  const live = new LiveData();
  const moving = deferred<SectionMember[]>();
  const client = api({ liveData: live, moveSectionMember: vi.fn(() => moving.promise) });
  const el = await mountLunch(client);
  emit(memberList(el), "wt-member-move", { memberId: "m-burger", to: 1 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  // Someone else's change: Favourites moved up past Burger, after our move reached the server.
  const [burger, drinks, fav] = lunchNodes();
  client.getMenuStructure.mockResolvedValue({
    rootSectionId: "root-lunch",
    nodes: [drinks!, fav!, burger!],
  });
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() =>
    expect(topLevel(el).map((item) => item.dataset.path)).toEqual([
      "m-drinks",
      "m-fav",
      "m-burger",
    ]),
  );
  moving.resolve([
    sectionMember("m-drinks", 0, "s-drinks"),
    productMember("m-burger", 1, "p-burger"),
    sectionMember("m-fav", 2, "s-fav"),
  ]);
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(3));
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  expect(memberList(el).members.map((member) => member.id)).toEqual([
    "m-drinks",
    "m-fav",
    "m-burger",
  ]);
});

it("takes a move's answer without reading the menu again when a read already showing that order lands first", async () => {
  const live = new LiveData();
  const moving = deferred<SectionMember[]>();
  const client = api({ liveData: live, moveSectionMember: vi.fn(() => moving.promise) });
  const el = await mountLunch(client);
  emit(memberList(el), "wt-member-move", { memberId: "m-burger", to: 1 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  const [burger, drinks, fav] = lunchNodes();
  client.getMenuStructure.mockResolvedValue({
    rootSectionId: "root-lunch",
    nodes: [drinks!, burger!, fav!],
  });
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(topLevel(el).map((item) => item.dataset.path)).toEqual([
      "m-drinks",
      "m-burger",
      "m-fav",
    ]),
  );
  moving.resolve([
    sectionMember("m-drinks", 0, "s-drinks"),
    productMember("m-burger", 1, "p-burger"),
    sectionMember("m-fav", 2, "s-fav"),
  ]);
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  expect(client.getMenuStructure).toHaveBeenCalledTimes(2);
  expect(memberList(el).members.map((member) => member.id)).toEqual([
    "m-drinks",
    "m-burger",
    "m-fav",
  ]);
});

it("takes the last queued move's answer when the earlier move's own update lands while it is out", async () => {
  const live = new LiveData();
  const second = deferred<SectionMember[]>();
  const client = api({ liveData: live });
  const move = client.moveSectionMember.getMockImplementation() as (
    list: string,
    memberId: string,
    to: number,
  ) => Promise<SectionMember[]>;
  client.moveSectionMember
    .mockImplementationOnce(move)
    .mockImplementationOnce(async (list: string, memberId: string, to: number) => {
      await move(list, memberId, to);
      return second.promise;
    });
  const el = await mountLunch(client);
  emit(memberList(el), "wt-member-move", { memberId: "m-burger", to: 1 });
  emit(memberList(el), "wt-member-move", { memberId: "m-burger", to: 2 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledTimes(2));
  // The first move's update, read before the second move was made.
  const [burger, drinks, fav] = lunchNodes();
  client.getMenuStructure.mockResolvedValueOnce({
    rootSectionId: "root-lunch",
    nodes: [drinks!, burger!, fav!],
  });
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() =>
    expect(topLevel(el).map((item) => item.dataset.path)).toEqual([
      "m-drinks",
      "m-burger",
      "m-fav",
    ]),
  );
  second.resolve([
    sectionMember("m-drinks", 0, "s-drinks"),
    sectionMember("m-fav", 1, "s-fav"),
    productMember("m-burger", 2, "p-burger"),
  ]);
  await vi.waitFor(() =>
    expect(topLevel(el).map((item) => item.dataset.path)).toEqual([
      "m-drinks",
      "m-fav",
      "m-burger",
    ]),
  );
  await new Promise((resolve) => setTimeout(resolve));
  expect(client.getMenuStructure).toHaveBeenCalledTimes(2);
});

it("reads the menu again when a later move is out and a read lands in the order an earlier, finished batch of moves answered", async () => {
  const live = new LiveData();
  const client = api({ liveData: live });
  const el = await mountLunch(client);
  emit(memberList(el), "wt-member-move", { memberId: "m-burger", to: 1 });
  emit(memberList(el), "wt-member-move", { memberId: "m-burger", to: 2 });
  await vi.waitFor(() =>
    expect(topLevel(el).map((item) => item.dataset.path)).toEqual([
      "m-drinks",
      "m-fav",
      "m-burger",
    ]),
  );
  const third = deferred<SectionMember[]>();
  client.moveSectionMember.mockImplementationOnce(() => third.promise);
  emit(memberList(el), "wt-member-move", { memberId: "m-fav", to: 0 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledTimes(3));
  // Another change's read, in the order the first move answered.
  const [burger, drinks, fav] = lunchNodes();
  client.getMenuStructure.mockResolvedValue({
    rootSectionId: "root-lunch",
    nodes: [drinks!, burger!, fav!],
  });
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() =>
    expect(topLevel(el).map((item) => item.dataset.path)).toEqual([
      "m-drinks",
      "m-burger",
      "m-fav",
    ]),
  );
  third.resolve([
    sectionMember("m-fav", 0, "s-fav"),
    sectionMember("m-drinks", 1, "s-drinks"),
    productMember("m-burger", 2, "p-burger"),
  ]);
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(3));
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  expect(memberList(el).members.map((member) => member.id)).toEqual([
    "m-drinks",
    "m-burger",
    "m-fav",
  ]);
});

it("reads the menu again when a move made after a refusal is out and a read lands in the order a move before the refusal answered", async () => {
  const live = new LiveData();
  const client = api({ liveData: live });
  const move = client.moveSectionMember.getMockImplementation()!;
  const [burger, drinks, fav] = lunchNodes();
  client.moveSectionMember
    .mockImplementationOnce(move)
    .mockImplementationOnce(() => Promise.reject({ code: "menu_section.invalid" }));
  const el = await mountLunch(client);
  // What the menu reads after the refusal: another change's order.
  client.getMenuStructure.mockResolvedValueOnce({
    rootSectionId: "root-lunch",
    nodes: [fav!, drinks!, burger!],
  });
  emit(memberList(el), "wt-member-move", { memberId: "m-burger", to: 1 });
  emit(memberList(el), "wt-member-move", { memberId: "m-burger", to: 2 });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(codeMessage("menu_section.invalid")),
  );
  await vi.waitFor(() =>
    expect(topLevel(el).map((item) => item.dataset.path)).toEqual([
      "m-fav",
      "m-drinks",
      "m-burger",
    ]),
  );
  const third = deferred<SectionMember[]>();
  client.moveSectionMember.mockImplementationOnce(() => third.promise);
  emit(memberList(el), "wt-member-move", { memberId: "m-burger", to: 0 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledTimes(3));
  // Another change's read, in the order the first move answered before the refusal.
  client.getMenuStructure.mockResolvedValue({
    rootSectionId: "root-lunch",
    nodes: [drinks!, burger!, fav!],
  });
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() =>
    expect(topLevel(el).map((item) => item.dataset.path)).toEqual([
      "m-drinks",
      "m-burger",
      "m-fav",
    ]),
  );
  third.resolve([
    productMember("m-burger", 0, "p-burger"),
    sectionMember("m-fav", 1, "s-fav"),
    sectionMember("m-drinks", 2, "s-drinks"),
  ]);
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(4));
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  expect(memberList(el).members.map((member) => member.id)).toEqual([
    "m-drinks",
    "m-burger",
    "m-fav",
  ]);
});

it("drops a move's answer that lands after the person has left the menu", async () => {
  const moving = deferred<SectionMember[]>();
  const client = api({ moveSectionMember: vi.fn(() => moving.promise) });
  const el = await mountLunch(client);
  emit(memberList(el), "wt-member-move", { memberId: "m-burger", to: 1 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  await click(el, "back");
  moving.resolve([
    sectionMember("m-drinks", 0, "s-drinks"),
    productMember("m-burger", 1, "p-burger"),
    sectionMember("m-fav", 2, "s-fav"),
  ]);
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  expect(table(el)).not.toBeNull();
  expect(client.getMenuStructure).toHaveBeenCalledOnce();
});

it("reads the menu again when a move sent while no menu was shown is answered after the menu is opened again", async () => {
  const first = deferred<SectionMember[]>();
  const second = deferred<SectionMember[]>();
  const client = api({
    moveSectionMember: vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise),
  });
  const el = await mountLunch(client);
  emit(memberList(el), "wt-member-move", { memberId: "m-burger", to: 1 });
  emit(memberList(el), "wt-member-move", { memberId: "m-burger", to: 2 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  await click(el, "back");
  first.resolve([
    sectionMember("m-drinks", 0, "s-drinks"),
    productMember("m-burger", 1, "p-burger"),
    sectionMember("m-fav", 2, "s-fav"),
  ]);
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledTimes(2));
  await inTable(el, "open-menu-lunch");
  await vi.waitFor(() => expect(tree(el)).not.toBeNull());
  expect(client.getMenuStructure).toHaveBeenCalledTimes(2);
  second.resolve([
    sectionMember("m-drinks", 0, "s-drinks"),
    sectionMember("m-fav", 1, "s-fav"),
    productMember("m-burger", 2, "p-burger"),
  ]);
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(3));
});

it("a move inside a section reorders every place the section appears, without reading the menu again", async () => {
  const client = api({
    moveSectionMember: vi
      .fn()
      .mockResolvedValue([
        productMember("m-lager", 0, "p-lager"),
        productMember("m-lemonade", 1, "p-lemonade"),
        sectionMember("m-beer", 2, "s-beer"),
      ]),
  });
  const el = await mountLunch(client);
  await editDrinks(el);
  emit(memberList(el), "wt-member-move", { memberId: "m-beer", to: 2 });
  await vi.waitFor(() =>
    expect(memberList(el).members.map((member) => member.id)).toEqual([
      "m-lager",
      "m-lemonade",
      "m-beer",
    ]),
  );
  expect(client.moveSectionMember).toHaveBeenCalledExactlyOnceWith("s-drinks", "m-beer", 2);
  await clickInTree(el, "toggle-m-fav");
  await clickInTree(el, "toggle-m-fav/m-fav-drinks");
  const inside = (path: string) =>
    [...tree(el).shadowRoot!.querySelectorAll<HTMLElement>("li[data-path]")]
      .map((item) => item.dataset.path!)
      .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/"));
  expect(inside("m-drinks")).toEqual([
    "m-drinks/m-lager",
    "m-drinks/m-lemonade",
    "m-drinks/m-beer",
  ]);
  expect(inside("m-fav/m-fav-drinks")).toEqual([
    "m-fav/m-fav-drinks/m-lager",
    "m-fav/m-fav-drinks/m-lemonade",
    "m-fav/m-fav-drinks/m-beer",
  ]);
  expect(client.getMenuStructure).toHaveBeenCalledOnce();
});

it("reads the menu again when a move's answer names members the menu does not show", async () => {
  const client = api({
    moveSectionMember: vi
      .fn()
      .mockResolvedValue([
        productMember("m-lager", 0, "p-lager"),
        sectionMember("m-beer", 1, "s-beer"),
        productMember("m-lemonade", 2, "p-lemonade"),
        productMember("m-added-elsewhere", 3, "p-chips"),
      ]),
  });
  const el = await mountLunch(client);
  await editDrinks(el);
  emit(memberList(el), "wt-member-move", { memberId: "m-lager", to: 0 });
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(2));
});

it("explains a refused move, reads the menu again, and drops the moves queued behind it", async () => {
  let refuse!: (error: unknown) => void;
  const client = api();
  const move = client.moveSectionMember.getMockImplementation()!;
  client.moveSectionMember.mockImplementationOnce(
    () => new Promise((_, reject) => (refuse = reject)),
  );
  const el = await mountLunch(client);
  emit(memberList(el), "wt-member-move", { memberId: "m-burger", to: 1 });
  emit(memberList(el), "wt-member-move", { memberId: "m-burger", to: 2 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  refuse({ code: "menu_section.invalid" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(codeMessage("menu_section.invalid")),
  );
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(2));
  expect(client.moveSectionMember).toHaveBeenCalledOnce();
  // A move made after the refusal is sent.
  client.moveSectionMember.mockImplementation(move);
  emit(memberList(el), "wt-member-move", { memberId: "m-fav", to: 0 });
  await vi.waitFor(() =>
    expect(client.moveSectionMember).toHaveBeenLastCalledWith("root-lunch", "m-fav", 0),
  );
  expect(client.moveSectionMember.mock.calls).toEqual([
    ["root-lunch", "m-burger", 1],
    ["root-lunch", "m-fav", 0],
  ]);
});

it("adds products to a section with this menu's products and the section's own both marked", async () => {
  const client = api();
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "open-add-products");
  expect(modal(el, "add-products").open).toBe(true);
  const picker = inModal<SectionAddProducts>(el, "add-products", "dashboard-section-add-products");
  expect([...picker.onMenu!].sort()).toEqual(["p-burger", "p-lager", "p-lemonade"]);
  expect([...picker.inSection].sort()).toEqual(["p-lager", "p-lemonade"]);
  // Only Active products are offered.
  expect(picker.products.map((offered) => offered.id).sort()).toEqual([
    "p-burger",
    "p-chips",
    "p-lager",
    "p-lemonade",
  ]);
  await picker.updateComplete;
  const marks = (id: string) =>
    [...picker.shadowRoot!.querySelectorAll(`li[data-product="${id}"] .mark`)].map((mark) =>
      text(mark),
    );
  expect(marks("p-lager")).toEqual([t("add_products.in_section"), t("add_products.on_menu")]);
  expect(marks("p-burger")).toEqual([t("add_products.on_menu")]);
  expect(marks("p-chips")).toEqual([]);

  emit(picker, "wt-add-products", { productIds: ["p-chips", "p-burger"] });
  await vi.waitFor(() => expect(modal(el, "add-products").open).toBe(false));
  expect(client.addSectionProducts).toHaveBeenCalledExactlyOnceWith("s-drinks", [
    "p-chips",
    "p-burger",
  ]);
});

it("keeps the picker open and explains a refused product add", async () => {
  const client = api({
    addSectionProducts: vi.fn().mockRejectedValue({ code: "menu_section.membership_invalid" }),
  });
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "open-add-products");
  const picker = inModal<SectionAddProducts>(el, "add-products", "dashboard-section-add-products");
  emit(picker, "wt-add-products", { productIds: ["p-chips"] });
  await vi.waitFor(() =>
    expect(text(inModal(el, "add-products", '[data-test="add-products-error"]'))).toBe(
      codeMessage("menu_section.membership_invalid"),
    ),
  );
  expect(modal(el, "add-products").open).toBe(true);
});

it("closes the product picker, sending nothing, when another change takes its section off the menu before Add products", async () => {
  const live = new LiveData();
  const client = api({ liveData: live });
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "open-add-products");
  const picker = inModal<SectionAddProducts>(el, "add-products", "dashboard-section-add-products");
  // A change that leaves Drinks in place keeps the picker open.
  client.getMenuStructure.mockResolvedValue({
    rootSectionId: "root-lunch",
    nodes: lunchNodes().reverse(),
  });
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() =>
    expect(topLevel(el).map((item) => item.dataset.path)).toEqual([
      "m-fav",
      "m-drinks",
      "m-burger",
    ]),
  );
  expect(modal(el, "add-products").open).toBe(true);

  await takeDrinksOff(el, client, live);
  emit(picker, "wt-add-products", { productIds: ["p-chips"] });
  await new Promise((resolve) => setTimeout(resolve));
  expect(client.addSectionProducts.mock.calls).toEqual([]);
  expect(modal(el, "add-products").open).toBe(false);
  expect(text(q(el, '[data-test="member-error"]'))).toBe(
    t("menus.list_gone").replace("{name}", "Drinks"),
  );
});

it("keeps the product picker open while its add is out and its section leaves the menu, and shows a refusal there", async () => {
  const live = new LiveData();
  const adding = deferred<{ added: number }>();
  const client = api({ liveData: live, addSectionProducts: vi.fn(() => adding.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "open-add-products");
  const picker = inModal<SectionAddProducts>(el, "add-products", "dashboard-section-add-products");
  emit(picker, "wt-add-products", { productIds: ["p-chips"] });
  await vi.waitFor(() => expect(client.addSectionProducts).toHaveBeenCalledOnce());
  await takeDrinksOff(el, client, live);
  expect(modal(el, "add-products").open).toBe(true);
  expect(modal(el, "add-products").heading).toBe(
    t("sections.add_products_heading").replace("{name}", "Drinks"),
  );
  adding.reject({ code: "menu_section.membership_invalid" });
  await vi.waitFor(() =>
    expect(text(inModal(el, "add-products", '[data-test="add-products-error"]'))).toBe(
      codeMessage("menu_section.membership_invalid"),
    ),
  );
  expect(modal(el, "add-products").open).toBe(true);
  expect(q(el, '[data-test="member-error"]')).toBeNull();

  // Tried again, with its section gone, it closes and sends nothing.
  emit(picker, "wt-add-products", { productIds: ["p-chips"] });
  await new Promise((resolve) => setTimeout(resolve));
  expect(client.addSectionProducts).toHaveBeenCalledOnce();
  expect(modal(el, "add-products").open).toBe(false);
  expect(text(q(el, '[data-test="member-error"]'))).toBe(
    t("menus.list_gone").replace("{name}", "Drinks"),
  );
});

it("finishes a product add that was out when its section left the menu, closing the picker and saying the add was saved", async () => {
  const live = new LiveData();
  const adding = deferred<{ added: number }>();
  const client = api({ liveData: live, addSectionProducts: vi.fn(() => adding.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "open-add-products");
  const picker = inModal<SectionAddProducts>(el, "add-products", "dashboard-section-add-products");
  emit(picker, "wt-add-products", { productIds: ["p-chips"] });
  await vi.waitFor(() => expect(client.addSectionProducts).toHaveBeenCalledOnce());
  await takeDrinksOff(el, client, live);
  expect(modal(el, "add-products").open).toBe(true);
  adding.resolve({ added: 1 });
  await vi.waitFor(() => expect(modal(el, "add-products").open).toBe(false));
  expect(client.addSectionProducts).toHaveBeenCalledExactlyOnceWith("s-drinks", ["p-chips"]);
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      t("menus.list_gone_saved").replace("{name}", "Drinks"),
    ),
  );
});

it("shows no In this section marks from another list in a picker whose section left the menu while its add is out", async () => {
  const live = new LiveData();
  const adding = deferred<{ added: number }>();
  const client = api({ liveData: live, addSectionProducts: vi.fn(() => adding.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "open-add-products");
  const picker = inModal<SectionAddProducts>(el, "add-products", "dashboard-section-add-products");
  expect([...picker.inSection].sort()).toEqual(["p-lager", "p-lemonade"]);
  emit(picker, "wt-add-products", { productIds: ["p-chips"] });
  await vi.waitFor(() => expect(client.addSectionProducts).toHaveBeenCalledOnce());
  await takeDrinksOff(el, client, live);
  await picker.updateComplete;
  expect(modal(el, "add-products").open).toBe(true);
  expect(picker.inSection).toEqual([]);
  const marks = [...picker.shadowRoot!.querySelectorAll('li[data-product="p-burger"] .mark')];
  expect(marks.map((mark) => text(mark))).toEqual([t("add_products.on_menu")]);
});

it("sends one product add when a second add-products event arrives while the first is out", async () => {
  const adding = deferred<{ added: number }>();
  const client = api({ addSectionProducts: vi.fn(() => adding.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "open-add-products");
  const picker = inModal<SectionAddProducts>(el, "add-products", "dashboard-section-add-products");
  emit(picker, "wt-add-products", { productIds: ["p-chips"] });
  await vi.waitFor(() => expect(client.addSectionProducts).toHaveBeenCalledOnce());
  emit(picker, "wt-add-products", { productIds: ["p-burger"] });
  adding.resolve({ added: 1 });
  await vi.waitFor(() => expect(modal(el, "add-products").open).toBe(false));
  await new Promise((resolve) => setTimeout(resolve));
  expect(client.addSectionProducts.mock.calls).toEqual([["s-drinks", ["p-chips"]]]);
});

/** Goes to another menu the way the browser's Back and Forward do. */
async function visit(el: MenusScreen, path: string, heading: string): Promise<void> {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  await vi.waitFor(() => expect(text(q(el, "h1"))).toBe(heading));
  await vi.waitFor(() => expect(tree(el)).not.toBeNull());
  await el.updateComplete;
}

const DINNER_PATH = "/manage/menus/menu/menu-dinner/view/structure";

it("closes an open window without a message when the person goes to another menu", async () => {
  const el = await mountLunch();
  await click(el, "new-section");
  expect(modal(el, "new-section").heading).toBe(
    t("menus.new_section_heading").replace("{list}", "Lunch Menu"),
  );
  await visit(el, DINNER_PATH, "Dinner Menu");
  expect(modal(el, "new-section").open).toBe(false);
  expect(q(el, '[data-test="member-error"]')).toBeNull();

  await click(el, "open-add-products");
  await visit(el, LUNCH_PATH, "Lunch Menu");
  await editDrinks(el);
  expect(modal(el, "add-products").open).toBe(false);
  expect(q(el, '[data-test="member-error"]')).toBeNull();
});

it("keeps a picker whose add is out open when the person goes to another menu, marking nothing from that menu, and closes it quietly when the add is saved", async () => {
  const adding = deferred<{ added: number }>();
  const client = api({ addSectionProducts: vi.fn(() => adding.promise) });
  const lunchStructure = client.getMenuStructure.getMockImplementation() as (
    id: string,
  ) => Promise<MenuStructure>;
  client.getMenuStructure.mockImplementation(async (id: string) =>
    id === "menu-dinner"
      ? { rootSectionId: "root-dinner", nodes: [productNode("m-dinner-chips", "p-chips")] }
      : lunchStructure(id),
  );
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "open-add-products");
  const picker = inModal<SectionAddProducts>(el, "add-products", "dashboard-section-add-products");
  emit(picker, "wt-add-products", { productIds: ["p-chips"] });
  await vi.waitFor(() => expect(client.addSectionProducts).toHaveBeenCalledOnce());
  await visit(el, DINNER_PATH, "Dinner Menu");
  await picker.updateComplete;
  expect(modal(el, "add-products").open).toBe(true);
  expect(modal(el, "add-products").heading).toBe(
    t("sections.add_products_heading").replace("{name}", "Drinks"),
  );
  expect(picker.inSection).toEqual([]);
  expect(picker.onMenu).toBeNull();
  adding.resolve({ added: 1 });
  await vi.waitFor(() => expect(modal(el, "add-products").open).toBe(false));
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  expect(q(el, '[data-test="member-error"]')).toBeNull();
});

it("closes a picker whose add is refused while the person is on another menu, naming its section and the refusal beside that menu's list", async () => {
  const adding = deferred<{ added: number }>();
  const client = api({ addSectionProducts: vi.fn(() => adding.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "open-add-products");
  const picker = inModal<SectionAddProducts>(el, "add-products", "dashboard-section-add-products");
  emit(picker, "wt-add-products", { productIds: ["p-chips"] });
  await vi.waitFor(() => expect(client.addSectionProducts).toHaveBeenCalledOnce());
  await visit(el, DINNER_PATH, "Dinner Menu");
  expect(modal(el, "add-products").open).toBe(true);
  adding.reject({ code: "menu_section.membership_invalid" });
  await vi.waitFor(() => expect(modal(el, "add-products").open).toBe(false));
  expect(text(q(el, '[data-test="member-error"]'))).toBe(
    t("menus.change_not_saved")
      .replace("{name}", "Drinks")
      .replace("{reason}", codeMessage("menu_section.membership_invalid")),
  );

  await visit(el, LUNCH_PATH, "Lunch Menu");
  expect(modal(el, "add-products").open).toBe(false);
  expect(q(el, '[data-test="member-error"]')).toBeNull();
});

it("closes a new-section form whose section is refused while the person is on the menus list, naming its list and the refusal there", async () => {
  const creating = deferred<LibrarySection>();
  const client = api({ createSection: vi.fn(() => creating.promise) });
  const el = await mountLunch(client);
  await click(el, "new-section");
  type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Specials");
  await el.updateComplete;
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(() => expect(client.createSection).toHaveBeenCalledOnce());
  await click(el, "back");
  expect(table(el)).not.toBeNull();
  creating.reject({ code: "menu_section.invalid" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      t("menus.change_not_saved")
        .replace("{name}", "Lunch Menu")
        .replace("{reason}", codeMessage("menu_section.invalid")),
    ),
  );
  expect(client.addSectionMember).not.toHaveBeenCalled();

  await inTable(el, "open-menu-lunch");
  await vi.waitFor(() => expect(tree(el)).not.toBeNull());
  await el.updateComplete;
  expect(modal(el, "new-section").open).toBe(false);
  expect(q(el, '[data-test="member-error"]')).toBeNull();
});

it("names the list on the menus list when a change to it is refused after the person pressed Back", async () => {
  const adding = deferred<SectionMember>();
  const client = api({ addSectionMember: vi.fn(() => adding.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  emit(memberList(el), "wt-member-add", { ref: { kind: "section", sectionId: "s-fav" } });
  await vi.waitFor(() => expect(client.addSectionMember).toHaveBeenCalledOnce());
  await click(el, "back");
  expect(table(el)).not.toBeNull();
  adding.reject({ code: "menu_section.member_duplicate" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      t("menus.change_not_saved")
        .replace("{name}", "Drinks")
        .replace("{reason}", codeMessage("menu_section.member_duplicate")),
    ),
  );
});

it("names the list on the menus list when a move in it is refused after the person pressed Back", async () => {
  const moving = deferred<SectionMember[]>();
  const client = api({ moveSectionMember: vi.fn(() => moving.promise) });
  const el = await mountLunch(client);
  emit(memberList(el), "wt-member-move", { memberId: "m-burger", to: 1 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  await click(el, "back");
  expect(table(el)).not.toBeNull();
  moving.reject({ code: "menu_section.invalid" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      t("menus.change_not_saved")
        .replace("{name}", "Lunch Menu")
        .replace("{reason}", codeMessage("menu_section.invalid")),
    ),
  );
});

it("names the list when a change to it is refused after the person went up to the menu's top level", async () => {
  const adding = deferred<SectionMember>();
  const client = api({ addSectionMember: vi.fn(() => adding.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  emit(memberList(el), "wt-member-add", { ref: { kind: "section", sectionId: "s-fav" } });
  await vi.waitFor(() => expect(client.addSectionMember).toHaveBeenCalledOnce());
  await click(el, "crumb-0");
  expect(breadcrumb(el)).toBe("Lunch Menu");
  adding.reject({ code: "menu_section.member_duplicate" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      t("menus.change_not_saved")
        .replace("{name}", "Drinks")
        .replace("{reason}", codeMessage("menu_section.member_duplicate")),
    ),
  );
});

it("names the list when a move in it is refused after the person went up to the menu's top level", async () => {
  const moving = deferred<SectionMember[]>();
  const client = api({ moveSectionMember: vi.fn(() => moving.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  emit(memberList(el), "wt-member-move", { memberId: "m-lager", to: 1 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  await click(el, "crumb-0");
  expect(breadcrumb(el)).toBe("Lunch Menu");
  moving.reject({ code: "menu_section.invalid" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      t("menus.change_not_saved")
        .replace("{name}", "Drinks")
        .replace("{reason}", codeMessage("menu_section.invalid")),
    ),
  );
});

it("shows a refused move without naming the list when the person is still on its menu", async () => {
  const moving = deferred<SectionMember[]>();
  const client = api({ moveSectionMember: vi.fn(() => moving.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  emit(memberList(el), "wt-member-move", { memberId: "m-lager", to: 1 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  moving.reject({ code: "menu_section.invalid" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(codeMessage("menu_section.invalid")),
  );
  expect(tree(el)).not.toBeNull();
});

/** Refuses an add from Lunch's add-products picker once Dinner is open, Dinner's structure being
 * read by `readDinner`. */
async function refuseAddWhileDinnerReads(
  readDinner: () => Promise<MenuStructure>,
): Promise<MenusScreen> {
  const adding = deferred<{ added: number }>();
  const client = api({ addSectionProducts: vi.fn(() => adding.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "open-add-products");
  const picker = inModal<SectionAddProducts>(el, "add-products", "dashboard-section-add-products");
  emit(picker, "wt-add-products", { productIds: ["p-chips"] });
  await vi.waitFor(() => expect(client.addSectionProducts).toHaveBeenCalledOnce());
  client.getMenuStructure.mockImplementationOnce(readDinner);
  history.pushState(null, "", DINNER_PATH);
  window.dispatchEvent(new PopStateEvent("popstate"));
  await vi.waitFor(() => expect(text(q(el, "h1"))).toBe("Dinner Menu"));
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  adding.reject({ code: "menu_section.membership_invalid" });
  await vi.waitFor(() => expect(modal(el, "add-products").open).toBe(false));
  await el.updateComplete;
  return el;
}

const drinksNotSaved = () =>
  t("menus.change_not_saved")
    .replace("{name}", "Drinks")
    .replace("{reason}", codeMessage("menu_section.membership_invalid"));

it("shows why a refused picker closed while the other menu's structure is still being read, and once, when it arrives", async () => {
  const reading = deferred<MenuStructure>();
  const el = await refuseAddWhileDinnerReads(() => reading.promise);
  expect(q(el, '[data-test="structure-loading"]')).not.toBeNull();
  expect(text(q(el, '[data-test="member-error"]'))).toBe(drinksNotSaved());

  reading.resolve({ rootSectionId: "root-dinner", nodes: [] });
  await vi.waitFor(() => expect(tree(el)).not.toBeNull());
  await el.updateComplete;
  const shown = el.shadowRoot!.querySelectorAll('[data-test="member-error"]');
  expect([...shown].map((node) => text(node))).toEqual([drinksNotSaved()]);
});

it("shows why a refused picker closed when the other menu's structure could not be read", async () => {
  const el = await refuseAddWhileDinnerReads(() => Promise.reject(new Error("down")));
  expect(q(el, '[data-test="structure-error"]')).not.toBeNull();
  expect(text(q(el, '[data-test="member-error"]'))).toBe(drinksNotSaved());
});

it("closes a new-section form quietly when its section is created and added while the person is on another menu", async () => {
  const creating = deferred<LibrarySection>();
  const client = api({ createSection: vi.fn(() => creating.promise) });
  const el = await mountLunch(client);
  await click(el, "new-section");
  type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Specials");
  await el.updateComplete;
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(() => expect(client.createSection).toHaveBeenCalledOnce());
  await visit(el, DINNER_PATH, "Dinner Menu");
  creating.resolve({ ...sections()[3]!, id: "s-new", internalName: "Specials" });
  await vi.waitFor(() => expect(modal(el, "new-section").open).toBe(false));
  await vi.waitFor(() => expect(client.addSectionMember).toHaveBeenCalledOnce());
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  expect(client.addSectionMember).toHaveBeenCalledWith("root-lunch", {
    kind: "section",
    sectionId: "s-new",
  });
  expect(q(el, '[data-test="member-error"]')).toBeNull();
});

it("keeps a picker whose add was refused open, and sends a second add, when the person is back on its menu before that menu's structure is read", async () => {
  const adding = deferred<{ added: number }>();
  const client = api({ addSectionProducts: vi.fn(() => adding.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  await click(el, "open-add-products");
  const picker = inModal<SectionAddProducts>(el, "add-products", "dashboard-section-add-products");
  emit(picker, "wt-add-products", { productIds: ["p-chips"] });
  await vi.waitFor(() => expect(client.addSectionProducts).toHaveBeenCalledOnce());
  await visit(el, DINNER_PATH, "Dinner Menu");

  const reading = deferred<MenuStructure>();
  client.getMenuStructure.mockImplementationOnce(() => reading.promise);
  history.pushState(null, "", LUNCH_PATH);
  window.dispatchEvent(new PopStateEvent("popstate"));
  await vi.waitFor(() => expect(q(el, '[data-test="structure-loading"]')).not.toBeNull());
  adding.reject({ code: "menu_section.membership_invalid" });
  await vi.waitFor(() =>
    expect(text(inModal(el, "add-products", '[data-test="add-products-error"]'))).toBe(
      codeMessage("menu_section.membership_invalid"),
    ),
  );

  client.addSectionProducts.mockResolvedValue({ added: 1 });
  emit(picker, "wt-add-products", { productIds: ["p-chips"] });
  reading.resolve({ rootSectionId: "root-lunch", nodes: lunchNodes() });
  await vi.waitFor(() => expect(modal(el, "add-products").open).toBe(false));
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  expect(client.addSectionProducts.mock.calls).toEqual([
    ["s-drinks", ["p-chips"]],
    ["s-drinks", ["p-chips"]],
  ]);
  expect(q(el, '[data-test="member-error"]')).toBeNull();
});

it("reports no lost list when a product add is saved while its menu's structure cannot be read", async () => {
  const adding = deferred<{ added: number }>();
  const client = api({ addSectionProducts: vi.fn(() => adding.promise) });
  const el = await mountLunch(client);
  await click(el, "open-add-products");
  const picker = inModal<SectionAddProducts>(el, "add-products", "dashboard-section-add-products");
  emit(picker, "wt-add-products", { productIds: ["p-chips"] });
  await vi.waitFor(() => expect(client.addSectionProducts).toHaveBeenCalledOnce());
  await visit(el, DINNER_PATH, "Dinner Menu");
  client.getMenuStructure
    .mockRejectedValueOnce(new Error("down"))
    .mockRejectedValueOnce(new Error("down"));
  history.pushState(null, "", LUNCH_PATH);
  window.dispatchEvent(new PopStateEvent("popstate"));
  await vi.waitFor(() => expect(q(el, '[data-test="structure-error"]')).not.toBeNull());
  adding.resolve({ added: 1 });
  await vi.waitFor(() => expect(modal(el, "add-products").open).toBe(false));
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(4));
  await new Promise((resolve) => setTimeout(resolve));

  await click(el, "structure-retry");
  await vi.waitFor(() => expect(tree(el)).not.toBeNull());
  await el.updateComplete;
  expect(q(el, '[data-test="member-error"]')).toBeNull();
});

it("shows a refused change beside the list", async () => {
  const client = api({
    addSectionMember: vi.fn().mockRejectedValue({ code: "menu_section.member_cycle" }),
  });
  const el = await mountLunch(client);
  emit(memberList(el), "wt-member-add", { ref: { kind: "section", sectionId: "s-fav" } });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      codeMessage("menu_section.member_cycle"),
    ),
  );
  expect(q(el, '[data-test="structure-error"]')).toBeNull();
});

it("a change that saved but could not then be reloaded is a load failure, not a failed change", async () => {
  const client = api();
  const el = await mountLunch(client);
  client.getMenuStructure.mockRejectedValue(new Error("down"));
  emit(memberList(el), "wt-member-remove", { memberId: "m-burger" });
  await vi.waitFor(() => expect(q(el, '[data-test="structure-error"]')).not.toBeNull());
  expect(q(el, '[data-test="member-error"]')).toBeNull();
  expect(client.removeSectionMember).toHaveBeenCalledOnce();
});

it("says the menu's structure could not be loaded, and tries again", async () => {
  const client = api();
  client.getMenuStructure.mockRejectedValueOnce(new Error("down"));
  const el = await mount(client, LUNCH_PATH);
  await vi.waitFor(() => expect(q(el, '[data-test="structure-error"]')).not.toBeNull());
  await click(el, "structure-retry");
  await vi.waitFor(() => expect(tree(el)).not.toBeNull());
  expect(q(el, '[data-test="structure-error"]')).toBeNull();
});

// ---------------------------------------------------------------------------
// The Prices tab

function prices(el: MenusScreen): MenuPricesTable {
  return q<MenuPricesTable>(el, "dashboard-menu-prices-table")!;
}

/** Opens Lunch's Prices from its address and waits for its rows. */
async function mountPrices(client: Api = api()) {
  const el = await mount(client, PRICES_PATH);
  await vi.waitFor(() => expect(prices(el)?.rows.length).toBe(3));
  return el;
}

async function chooseTab(el: MenusScreen, key: string): Promise<void> {
  const tabs = q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!;
  tabs.shadowRoot!.querySelector<HTMLElement>(`[role="tab"][data-key="${key}"]`)!.click();
  await el.updateComplete;
}

function pricesModal(el: MenusScreen) {
  return prices(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!;
}

async function openOffer(el: MenusScreen, menuItemId: string): Promise<void> {
  const table = prices(el).shadowRoot!.querySelector<Table>("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot.querySelector<HTMLElement>(`[data-test="edit-${menuItemId}"]`)!.click();
  await vi.waitFor(() => expect(pricesModal(el).open).toBe(true));
}

async function inOffer(el: MenusScreen, testId: string): Promise<void> {
  pricesModal(el).querySelector<HTMLElement>(`[data-test="${testId}"]`)!.click();
  await el.updateComplete;
}

function offerField(el: MenusScreen, name: string) {
  return pricesModal(el).querySelector<HTMLElementTagNameMap["wt-input"]>(`[name="${name}"]`)!;
}

it("keeps the Prices tab in the address, and switching tabs keeps the chosen menu", async () => {
  const client = api();
  const el = await mountLunch(client);
  expect(client.getMenuPrices).not.toHaveBeenCalled();
  await chooseTab(el, "prices");
  expect(location.pathname).toBe(PRICES_PATH);
  await vi.waitFor(() => expect(prices(el)?.rows.length).toBe(3));
  expect(client.getMenuPrices).toHaveBeenCalledWith("menu-lunch");
  expect(text(q(el, "h1"))).toBe("Lunch Menu");
  expect(prices(el).menuName).toBe("Lunch Menu");
  await chooseTab(el, "structure");
  expect(location.pathname).toBe(LUNCH_PATH);
  expect(text(q(el, "h1"))).toBe("Lunch Menu");
  history.back();
  await vi.waitFor(() => expect(location.pathname).toBe(PRICES_PATH));
  await vi.waitFor(() =>
    expect(q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!.value).toBe("prices"),
  );
});

it("opens the Prices tab the address names, with the library's sections, categories and products", async () => {
  const client = api({ listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()) });
  const el = await mountPrices(client);
  expect(q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!.value).toBe("prices");
  const table = prices(el);
  expect(table.sections.map(({ id }) => id)).toEqual(sections().map(({ id }) => id));
  expect(table.categories).toEqual(categories);
  expect(table.products.map(({ id }) => id)).toContain("p-lemonade");
  const cells = text(
    table.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!.querySelector("tbody"),
  );
  expect(cells).toContain("Favourites");
  expect(cells).toContain("Drinks › Beer");
  expect(cells).not.toContain("Our picks");
  expect(cells).not.toContain("Something to drink");
});

it("reads another menu's prices when the person opens it", async () => {
  const client = api();
  const el = await mountPrices(client);
  await click(el, "back");
  await inTable(el, "open-menu-dinner");
  await chooseTab(el, "prices");
  await vi.waitFor(() => expect(client.getMenuPrices).toHaveBeenCalledWith("menu-dinner"));
  await vi.waitFor(() => expect(prices(el).rows).toEqual([]));
});

it("saves a product's settings on the menu with one PATCH and one PUT of its variants, then reads the prices again", async () => {
  const client = api({ listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()) });
  const el = await mountPrices(client);
  await openOffer(el, "mi-lemonade");
  const legends = [...pricesModal(el).querySelectorAll("fieldset legend")].map(text);
  expect(legends).toEqual(["Small", "Large"]);
  type(offerField(el, "grossPrice"), "2.80");
  type(offerField(el, "variants.0.price"), "1.90");
  await el.updateComplete;
  const reads = client.getMenuPrices.mock.calls.length;
  await inOffer(el, "offer-save");
  await vi.waitFor(() => expect(pricesModal(el).open).toBe(false));
  expect(client.updateMenuItem.mock.calls).toEqual([
    ["menu-lunch", "mi-lemonade", { grossPrice: "2.80", active: true }],
  ]);
  expect(client.setMenuVariants.mock.calls).toEqual([
    [
      "menu-lunch",
      "mi-lemonade",
      [
        { variantId: "v-small", price: "1.90", offered: true },
        { variantId: "v-large", price: "3.75", offered: false },
      ],
    ],
  ]);
  expect(writeCalls(client)).toEqual(["updateMenuItem", "setMenuVariants"]);
  await vi.waitFor(() => expect(client.getMenuPrices.mock.calls.length).toBeGreaterThan(reads));
});

it("sends no variants for a product without them", async () => {
  const client = api();
  const el = await mountPrices(client);
  await openOffer(el, "mi-burger");
  await inOffer(el, "offer-save");
  await vi.waitFor(() => expect(pricesModal(el).open).toBe(false));
  expect(client.updateMenuItem.mock.calls).toEqual([
    ["menu-lunch", "mi-burger", { grossPrice: null, active: true }],
  ]);
  expect(client.setMenuVariants).not.toHaveBeenCalled();
});

it("'Use product price' sends grossPrice: null", async () => {
  const client = api({ listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()) });
  const el = await mountPrices(client);
  await openOffer(el, "mi-lemonade");
  expect(offerField(el, "grossPrice").value).toBe("2.50");
  await inOffer(el, "use-product-price");
  await inOffer(el, "offer-save");
  await vi.waitFor(() => expect(client.updateMenuItem).toHaveBeenCalledOnce());
  expect(client.updateMenuItem.mock.calls[0]![2]).toEqual({ grossPrice: null, active: true });
});

it("keeps the settings open and says why when the server refuses the price, sending no variants", async () => {
  const client = api({
    listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()),
    updateMenuItem: vi
      .fn()
      .mockRejectedValue({ code: "management.request_invalid", params: { field: "grossPrice" } }),
  });
  const el = await mountPrices(client);
  await openOffer(el, "mi-lemonade");
  type(offerField(el, "grossPrice"), "2.80");
  await el.updateComplete;
  await inOffer(el, "offer-save");
  await vi.waitFor(() =>
    expect(offerField(el, "grossPrice").error).toBe(codeMessage("management.request_invalid")),
  );
  expect(pricesModal(el).open).toBe(true);
  expect(offerField(el, "grossPrice").value).toBe("2.80");
  expect(client.setMenuVariants).not.toHaveBeenCalled();
  await inOffer(el, "offer-cancel");
  expect(pricesModal(el).open).toBe(false);
});

it("refuses a malformed price in the settings without sending anything", async () => {
  const client = api();
  const el = await mountPrices(client);
  await openOffer(el, "mi-burger");
  type(offerField(el, "grossPrice"), "-2");
  await el.updateComplete;
  await inOffer(el, "offer-save");
  expect(offerField(el, "grossPrice").error).toBe(t("editor.price_invalid"));
  expect(writeCalls(client)).toEqual([]);
});

it("sends one save while one is out, and holds the window open until it is answered", async () => {
  const pending = deferred<void>();
  const client = api({ updateMenuItem: vi.fn(() => pending.promise) });
  const el = await mountPrices(client);
  await openOffer(el, "mi-burger");
  await inOffer(el, "offer-save");
  prices(el).dispatchEvent(
    new CustomEvent("wt-offer-save", {
      detail: {
        menuItemId: "mi-burger",
        name: "Burger",
        grossPrice: null,
        active: true,
        variants: null,
      },
      bubbles: true,
      composed: true,
    }),
  );
  await inOffer(el, "offer-cancel");
  expect(pricesModal(el).open).toBe(true);
  expect(client.updateMenuItem).toHaveBeenCalledOnce();
  pending.resolve();
  await vi.waitFor(() => expect(pricesModal(el).open).toBe(false));
});

it("a save that succeeded but could not then be reloaded is a load failure, not a refused save", async () => {
  const client = api();
  const el = await mountPrices(client);
  await openOffer(el, "mi-burger");
  client.getMenuPrices.mockRejectedValue(new Error("down"));
  await inOffer(el, "offer-save");
  await vi.waitFor(() => expect(prices(el).failed).toBe(true));
  expect(pricesModal(el).open).toBe(false);
  expect(prices(el).refusal).toBeNull();
  expect(q(el, '[data-test="prices-retry"]')).not.toBeNull();
});

it("says the prices could not be loaded, and tries again", async () => {
  const client = api();
  client.getMenuPrices.mockRejectedValueOnce(new Error("down"));
  const el = await mount(client, PRICES_PATH);
  await vi.waitFor(() => expect(prices(el).failed).toBe(true));
  await click(el, "prices-retry");
  await vi.waitFor(() => expect(prices(el).rows.length).toBe(3));
  expect(prices(el).failed).toBe(false);
  expect(q(el, '[data-test="prices-retry"]')).toBeNull();
});

it("names the product when its save is refused after the person has gone to another menu", async () => {
  const pending = deferred<void>();
  const client = api({ updateMenuItem: vi.fn(() => pending.promise) });
  const el = await mountPrices(client);
  await openOffer(el, "mi-burger");
  await inOffer(el, "offer-save");
  history.pushState(null, "", "/manage/menus/menu/menu-dinner/view/prices");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await vi.waitFor(() => expect(text(q(el, "h1"))).toBe("Dinner Menu"));
  expect(pricesModal(el).open).toBe(false);
  pending.reject({ code: "catalogue.not_found" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      t("menus.change_not_saved")
        .replace("{name}", "Burger")
        .replace("{reason}", codeMessage("catalogue.not_found")),
    ),
  );
  expect(pricesModal(el).open).toBe(false);
});

it("keeps the prices within a phone's width, the table scrolling inside it", async () => {
  await page.viewport(390, 844);
  try {
    const el = await mountPrices();
    expect(window.innerWidth).toBe(390);
    expect(prices(el).getBoundingClientRect().width).toBeLessThanOrEqual(390);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  } finally {
    await page.viewport(1280, 900);
  }
});

it("finishes a save quietly when the person has gone to another menu, reading no prices for the old one", async () => {
  const pending = deferred<void>();
  const client = api({ updateMenuItem: vi.fn(() => pending.promise) });
  const el = await mountPrices(client);
  await openOffer(el, "mi-burger");
  await inOffer(el, "offer-save");
  history.pushState(null, "", "/manage/menus/menu/menu-dinner/view/prices");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await vi.waitFor(() => expect(client.getMenuPrices).toHaveBeenCalledWith("menu-dinner"));
  const lunchReads = client.getMenuPrices.mock.calls.filter(([id]) => id === "menu-lunch").length;
  pending.resolve();
  await vi.waitFor(() => expect(prices(el).busy).toBe(false));
  expect(client.getMenuPrices.mock.calls.filter(([id]) => id === "menu-lunch")).toHaveLength(
    lunchReads,
  );
  expect(q(el, '[data-test="member-error"]')).toBeNull();
  expect(prices(el).rows).toEqual([]);
});

it("stops following a menu's prices once another menu is opened, so its changes never show under the new one", async () => {
  const live = new LiveData();
  const client = api({ liveData: live });
  const el = await mountPrices(client);
  const dinner = deferred<MenuPriceRow[]>();
  client.getMenuPrices.mockImplementation((id: string) =>
    id === "menu-dinner" ? dinner.promise : Promise.resolve(lunchPrices()),
  );
  history.pushState(null, "", "/manage/menus/menu/menu-dinner/view/structure");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await vi.waitFor(() => expect(text(q(el, "h1"))).toBe("Dinner Menu"));
  const reads = client.getMenuPrices.mock.calls.length;
  live.invalidate([{ type: "menu_items" }]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(client.getMenuPrices.mock.calls.length).toBe(reads);
  await chooseTab(el, "prices");
  await vi.waitFor(() => expect(client.getMenuPrices).toHaveBeenCalledWith("menu-dinner"));
  expect(prices(el).rows).toEqual([]);
  expect(prices(el).loading).toBe(true);
  dinner.resolve([]);
  await vi.waitFor(() => expect(prices(el).loading).toBe(false));
});

/** The native dialog inside the offer window: while it is open it blocks the rest of the page. */
function offerDialogOpen(el: MenusScreen): boolean {
  return pricesModal(el).shadowRoot!.querySelector("dialog")?.open ?? false;
}

it("closes the offer window when Back leaves the Prices tab, leaving the Structure tab usable", async () => {
  const client = api();
  const el = await mountLunch(client);
  await chooseTab(el, "prices");
  await vi.waitFor(() => expect(prices(el).rows.length).toBe(3));
  await openOffer(el, "mi-burger");
  expect(offerDialogOpen(el)).toBe(true);
  history.back();
  await vi.waitFor(() => expect(location.pathname).toBe(LUNCH_PATH));
  await vi.waitFor(() =>
    expect(q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!.value).toBe("structure"),
  );
  await vi.waitFor(() => expect(offerDialogOpen(el)).toBe(false));
  expect(prices(el).editing).toBeNull();
  await clickInTree(el, "edit-m-drinks");
  await vi.waitFor(() => expect(breadcrumb(el)).toBe("Lunch Menu › Drinks"));
});

it("reports beside the Structure tab a save refused after Back left the Prices tab", async () => {
  const pending = deferred<void>();
  const client = api({ updateMenuItem: vi.fn(() => pending.promise) });
  const el = await mountLunch(client);
  await chooseTab(el, "prices");
  await vi.waitFor(() => expect(prices(el).rows.length).toBe(3));
  await openOffer(el, "mi-burger");
  await inOffer(el, "offer-save");
  history.back();
  await vi.waitFor(() => expect(location.pathname).toBe(LUNCH_PATH));
  await vi.waitFor(() => expect(offerDialogOpen(el)).toBe(false));
  pending.reject({ code: "catalogue.not_found" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      t("menus.change_not_saved")
        .replace("{name}", "Burger")
        .replace("{reason}", codeMessage("catalogue.not_found")),
    ),
  );
  expect(offerDialogOpen(el)).toBe(false);
});

it("says the menu price was saved and the variants were not when only the variants are refused", async () => {
  const client = api({
    listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()),
    setMenuVariants: vi
      .fn()
      .mockRejectedValue({ code: "management.request_invalid", params: { field: "variants.0" } }),
  });
  const el = await mountPrices(client);
  await openOffer(el, "mi-lemonade");
  type(offerField(el, "grossPrice"), "2.80");
  await el.updateComplete;
  const reads = client.getMenuPrices.mock.calls.length;
  await inOffer(el, "offer-save");
  const expected = t("menu_prices.variants_not_saved")
    .replace("{name}", "Lemonade")
    .replace("{reason}", codeMessage("management.request_invalid"));
  await vi.waitFor(() => expect(prices(el).refusal?.message).toBe(expected));
  expect(client.updateMenuItem).toHaveBeenCalledOnce();
  expect(client.setMenuVariants).toHaveBeenCalledOnce();
  expect(pricesModal(el).open).toBe(true);
  expect(offerField(el, "grossPrice").value).toBe("2.80");
  const summary =
    pricesModal(el).querySelector<HTMLElementTagNameMap["wt-form-error-summary"]>(
      "wt-form-error-summary",
    )!;
  await summary.updateComplete;
  expect(text(summary.shadowRoot!.querySelector("li"))).toBe(expected);
  // The menu price was saved, so the list is read again behind the window.
  await vi.waitFor(() => expect(client.getMenuPrices.mock.calls.length).toBeGreaterThan(reads));
});

it("names the product and says its variants were not saved when that refusal lands after the person left its menu", async () => {
  const pending = deferred<MenuVariantAnswer>();
  const client = api({
    listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()),
    setMenuVariants: vi.fn(() => pending.promise),
  });
  const el = await mountPrices(client);
  await openOffer(el, "mi-lemonade");
  await inOffer(el, "offer-save");
  await vi.waitFor(() => expect(client.setMenuVariants).toHaveBeenCalledOnce());
  history.pushState(null, "", "/manage/menus/menu/menu-dinner/view/prices");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await vi.waitFor(() => expect(text(q(el, "h1"))).toBe("Dinner Menu"));
  pending.reject({ code: "management.request_invalid" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      t("menu_prices.variants_not_saved")
        .replace("{name}", "Lemonade")
        .replace("{reason}", codeMessage("management.request_invalid")),
    ),
  );
});

type MenuVariantAnswer = { variantId: string; price: string | null; offered: boolean }[];

it("opens no product's window while a save is out, even after Back and Forward closed the saving one", async () => {
  const pending = deferred<void>();
  const client = api({
    listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()),
    updateMenuItem: vi.fn(() => pending.promise),
  });
  const el = await mountLunch(client);
  await chooseTab(el, "prices");
  await vi.waitFor(() => expect(prices(el).rows.length).toBe(3));
  await openOffer(el, "mi-burger");
  await inOffer(el, "offer-save");
  history.back();
  await vi.waitFor(() => expect(location.pathname).toBe(LUNCH_PATH));
  history.forward();
  await vi.waitFor(() => expect(location.pathname).toBe(PRICES_PATH));
  await vi.waitFor(() =>
    expect(q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!.value).toBe("prices"),
  );
  const table = prices(el).shadowRoot!.querySelector<Table>("wt-data-table")!;
  await table.updateComplete;
  const lemonade = table.shadowRoot.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="edit-mi-lemonade"]',
  )!;
  expect(lemonade.disabled).toBe(true);
  lemonade.click();
  emit(prices(el), "wt-offer-edit", { menuItemId: "mi-lemonade" });
  await el.updateComplete;
  expect(pricesModal(el).open).toBe(false);
  pending.resolve();
  await vi.waitFor(() => expect(prices(el).busy).toBe(false));
  await table.updateComplete;
  expect(lemonade.disabled).toBe(false);
  await openOffer(el, "mi-lemonade");
  expect(offerField(el, "grossPrice").value).toBe("2.50");
});
