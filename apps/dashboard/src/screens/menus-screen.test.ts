import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { MenusScreen } from "./menus-screen.js";
import type {
  CatalogueSummary,
  CategorySummary,
  DashboardApi,
  LibrarySection,
  MenuStructure,
  MenuStructureNode,
  Product,
  SectionMember,
  SectionUsages,
} from "../api/client.js";
import type { MemberListEditor } from "../widgets/member-list-editor.js";
import type { MenuStructureTree } from "../widgets/menu-structure-tree.js";
import type { SectionAddProducts } from "../widgets/section-add-products.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";

afterEach(cleanupWidgets);
beforeEach(() => sessionStorage.clear());
beforeEach(() => history.replaceState(null, "", "/manage/menus"));

const LUNCH_PATH = "/manage/menus/menu/menu-lunch/view/structure";

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
  expect(tabs.items.map((item) => item.key)).toEqual(["structure"]);
  history.back();
  await vi.waitFor(() => expect(location.pathname).toBe("/manage/menus"));
  await vi.waitFor(() => expect(text(q(el, "h1"))).toBe(t("menus.title")));
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
  expect(client.getSectionUsages).toHaveBeenCalledWith("s-drinks");

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
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(2));
  await el.updateComplete;
  await list.updateComplete;
  expect(order()).toEqual(["m-drinks", "m-burger", "m-fav"]);
  expect(list.shadowRoot!.activeElement).toBe(handle());

  handle().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  await vi.waitFor(() =>
    expect(client.moveSectionMember).toHaveBeenLastCalledWith("root-lunch", "m-burger", 0),
  );
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(3));
  await el.updateComplete;
  await list.updateComplete;
  expect(order()).toEqual(["m-burger", "m-drinks", "m-fav"]);
  expect(list.shadowRoot!.activeElement).toBe(handle());
  // The tree follows the saved order.
  await tree(el).updateComplete;
  expect(topLevel(el).map((item) => item.dataset.path)).toEqual(["m-burger", "m-drinks", "m-fav"]);
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
