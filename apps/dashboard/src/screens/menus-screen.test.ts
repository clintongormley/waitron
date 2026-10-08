import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { combinedFixture } from "../widgets/test-helpers.js";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import {
  cleanupWidgets,
  documentProduct,
  documentSection,
  expectNoA11yViolations,
  menuDocument,
  mountWidget,
} from "../widgets/test-helpers.js";
import {
  chooseOption,
  expectRowMenusOnScreen,
  formMessageOf,
} from "@waitron/ui/src/test-helpers.js";
import { MenusScreen } from "./menus-screen.js";
import { DashboardApi } from "../api/client.js";
import type {
  CatalogueSummary,
  CategorySummary,
  IncludeFolder,
  IncludeFolderInput,
  MenuHome,
  MenuReadPart,
  SectionDetails,
  MemberRef,
  MenuPreview,
  MenuPriceRow,
  MenuStatus,
  MenuStructure,
  MenuStructureNode,
  Product,
  SectionMember,
} from "../api/client.js";
import type { MenuPricesTable } from "../widgets/menu-prices-table.js";
import type { DashboardApp } from "../dashboard-app.js";
import type { CustomerMenu } from "../widgets/customer-menu.js";
import type { SectionAddProducts } from "../widgets/section-add-products.js";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { codeMessage } from "../i18n/codes.js";
import { formatIsoMinute } from "../date-utils.js";

class MenuProductsLeaveHost extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("menu-products-leave-test-host", MenuProductsLeaveHost);
async function placementLeaveHost() {
  const { el: host } = await mountWidget<MenuProductsLeaveHost>(
    "menu-products-leave-test-host",
    {},
  );
  const register = (event: Event) =>
    (
      event as CustomEvent<{ accept: (leave: typeof host.leave.coordinator) => void }>
    ).detail.accept(host.leave.coordinator);
  document.addEventListener("wt-leave-coordinator", register);
  onTestFinished(() => document.removeEventListener("wt-leave-coordinator", register));
  return host;
}

afterEach(cleanupWidgets);
beforeEach(() => sessionStorage.clear());
// These clear a column choice saved under the list's previous key, which a test below sets and
// localStorage keeps between tests.
beforeEach(() => localStorage.removeItem("waitron.menus.table:columns"));
afterEach(() => localStorage.removeItem("waitron.menus.table:columns"));
/** The key the list keeps its column choices under. */
const LIST_KEY = "waitron.menus.list.table";
const forgetListColumns = () => {
  localStorage.removeItem(`${LIST_KEY}:columns`);
  localStorage.removeItem(`${LIST_KEY}:column-order`);
};
beforeEach(forgetListColumns);
afterEach(forgetListColumns);
beforeEach(() => history.replaceState(null, "", "/manage/menus"));

const LUNCH_PATH = "/manage/menus/menu/menu-lunch/view/structure";
const PRICES_PATH = "/manage/menus/menu/menu-lunch/view/prices";
const PREVIEW_PATH = "/manage/menus/menu/menu-lunch/view/preview";
const HOME_PATH = "/manage/menus/menu/menu-lunch/view/home";

/** The three names read differently (docs/developers/products.md), so a surface showing the
 * customer-facing or kitchen name where the staff name belongs fails. */
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
  product("p-lager", "Lager", { categoryId: "c-beer" }),
  product("p-lemonade", "Lemonade", { categoryId: "c-drinks" }),
  product("p-burger", "Burger", { categoryId: "c-mains" }),
  product("p-chips", "Chips", { categoryId: "c-mains" }),
  product("p-soup", "Old soup", { active: false }),
];

const categories: CategorySummary[] = [
  { id: "c-drinks", name: "Bebidas", parentId: null, color: null },
  { id: "c-beer", name: "Cerveza", parentId: "c-drinks", color: null },
  { id: "c-mains", name: "Principales", parentId: null, color: null },
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
function sections(): SectionDetails[] {
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
    internalName: "Drinks",
    names: { en: "Something to drink", es: "Bebidas frías" },
    image: null,
    color: null,
    ownerMenuId: "menu-lunch",
    children: [
      productNode("m-lager", "p-lager"),
      {
        memberId: "m-beer",
        ref: { kind: "section", sectionId: "s-beer" },
        internalName: "Beer",
        names: {},
        image: null,
        color: null,
        ownerMenuId: "menu-lunch",
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
      internalName: "Favourites",
      names: {},
      image: null,
      color: null,
      ownerMenuId: "menu-lunch",
      children: [productNode("m-fav-lemonade", "p-lemonade"), drinksNode("m-fav-drinks")],
    },
  ];
}

/** Lemonade sits in Favourites and Drinks; Lager only inside Drinks' Beer. */
function lunchPrices(): MenuPriceRow[] {
  return [
    {
      menuItemId: "mi-burger",
      combined: combinedFixture("p-burger", "12.00", [], null, "12.00", {}),
      productId: "p-burger",
      name: "Burger",
      categoryId: "c-mains",
      placements: [[]],
      override: null,
      effectivePrice: "12.00",
      active: true,
      available: true,
      variants: [],
    },
    {
      menuItemId: "mi-lemonade",
      combined: combinedFixture(
        "p-lemonade",
        "2.50",
        [
          { variantId: "v-small", price: null },
          { variantId: "v-large", price: "3.75" },
        ],
        "2.50",
        "3.00",
        { "v-large": "3.40" },
      ),
      productId: "p-lemonade",
      name: "Lemonade",
      categoryId: "c-drinks",
      placements: [["s-fav"], ["s-drinks"]],
      override: "2.50",
      effectivePrice: "2.50",
      active: true,
      available: true,
      variants: [
        { variantId: "v-small", price: null, active: true, available: true },
        { variantId: "v-large", price: "3.75", active: true, available: true },
      ],
    },
    {
      menuItemId: "mi-lager",
      combined: combinedFixture("p-lager", "2.00", [], null, "2.00", {}),
      productId: "p-lager",
      name: "Lager",
      categoryId: "c-beer",
      placements: [["s-drinks", "s-beer"]],
      override: null,
      effectivePrice: "2.00",
      active: true,
      available: true,
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
  "updateMenuDetails",
  "createSectionIn",
  "updateSection",
  "deleteSection",
  "addSectionMember",
  "addSectionProducts",
  "removeSectionMember",
  "moveSectionMember",
  "updateMenuItem",
  "setMenuVariantPrice",
  "publishMenu",
  "addHomeShortcut",
  "removeHomeShortcut",
  "moveHomeShortcut",
  "setHomeDisplay",
  "scheduleMenuPublication",
  "rescheduleMenuPublication",
  "cancelMenuPublication",
] as const;

const PUBLISHED_AT = "2026-09-26T10:15:00.000Z";
const LUNCH_LIVE_HASH = "a".repeat(64);
const LUNCH_HASH = "b".repeat(64);

/** Lunch has changes waiting on version 2; Dinner is published and current. */
function statuses(): Record<string, MenuStatus> {
  return {
    "menu-lunch": {
      state: "changed",
      clashes: 0,
      version: 2,
      publishedAt: PUBLISHED_AT,
      hash: LUNCH_LIVE_HASH,
    },
    "menu-dinner": {
      state: "current",
      clashes: 0,
      version: 5,
      publishedAt: "2026-09-20T18:00:00.000Z",
      hash: "d".repeat(64),
    },
  };
}

/** Lunch's pending changes: one of its own and one a shared product brings. */
function lunchPreview(): MenuPreview {
  return {
    live: null,
    clashes: [],
    hash: LUNCH_HASH,
    changes: [
      {
        id: "fixture-src/screens/menus-screen.test.ts-2",
        targets: { before: [], after: [] },
        kind: "product_added",
        productId: "p-chips",
        name: "Chips",
        under: ["Drinks"],
        source: "this_menu",
      },
      {
        id: "fixture-src/screens/menus-screen.test.ts-1",
        targets: { before: [], after: [] },
        kind: "product_changed",
        productId: "p-lemonade",
        name: "Lemonade",
        fields: ["allergens"],
        source: "shared_product",
        alsoOn: ["Dinner Menu"],
      },
    ],
    warnings: [{ kind: "shortcut_missing", name: "Lager" }],
    status: statuses()["menu-lunch"]!,
    document: lunchDocument(),
  };
}

/**
 * What publishing Lunch would make live: Burger, and Drinks holding Lemonade and Chips. It differs
 * from Lunch's working structure, which also holds Lager and Favourites, so a view reading that
 * structure shows names this one does not.
 */
function lunchDocument() {
  return menuDocument(
    [
      documentProduct("mi-burger", "p-burger"),
      documentSection("s-drinks", "Drinks", [
        documentProduct("mi-lemonade", "p-lemonade"),
        documentProduct("mi-chips", "p-chips"),
      ]),
    ],
    { "p-burger": "Burger", "p-lemonade": "Lemonade", "p-chips": "Chips" },
  );
}

/** Dinner's working state differs from its live version 5 by nothing a change can list. */
function dinnerPreview(): MenuPreview {
  return {
    live: null,
    clashes: [],
    hash: "c".repeat(64),
    changes: [],
    warnings: [],
    status: {
      state: "changed",
      clashes: 0,
      version: 5,
      publishedAt: "2026-09-20T18:00:00.000Z",
      hash: "d".repeat(64),
    },
    document: menuDocument([], {}, "Dinner Menu"),
  };
}

/** Lunch's Device Home Page: Burger, the Drinks section and Chips, which Lunch no longer reaches;
 * both devices' displays at their defaults. */
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

/** A menu whose Device Home Page holds no shortcuts. */
function emptyHome(homeSectionId = "home-dinner"): MenuHome {
  return { ...menuHome(), homeSectionId, shortcuts: [] };
}

/** A menu's top level the fake keeps, so a move is visible in what the next read answers. */
function api(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}) {
  let root = lunchNodes();
  const client = {
    listCatalogues: vi.fn().mockResolvedValue(menus),
    listLibraryProducts: vi.fn().mockResolvedValue(products),
    listCategories: vi.fn().mockResolvedValue(categories),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getMenuStructure: vi.fn(async (id: string): Promise<MenuStructure> =>
      id === "menu-lunch"
        ? {
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
            nodes: structuredClone(root),
          }
        : {
            rootSectionId: "root-dinner",
            root: {
              id: "root-dinner",
              internalName: "Dinner Menu",
              names: {},
              image: null,
              color: null,
              members: [],
            },
            includable: [],
            includedBy: [],
            nodes: [],
          },
    ),
    createCatalogue: vi.fn(async (name: string) => ({
      id: "menu-new",
      name,
      active: true,
      version: 1,
    })),
    updateMenuDetails: vi.fn().mockResolvedValue(undefined),
    createSectionIn: vi.fn(async (_id: string, input: { internalName: string }) => ({
      id: "s-new",
      internalName: input.internalName,
      names: {},
      image: null,
      color: null,
      members: [],
    })),
    updateSection: vi.fn(),
    setIncludeFolder: vi.fn(),
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
    getMenuPrices: vi.fn(async (id: string) => (id === "menu-lunch" ? lunchPrices() : [])),
    updateMenuItem: vi.fn().mockResolvedValue(undefined),
    setMenuVariantPrice: vi.fn().mockResolvedValue(undefined),
    getMenuStatuses: vi.fn(async () => statuses()),
    getMenuStatus: vi.fn(
      async (id: string) => statuses()[id] ?? { state: "unpublished", clashes: 0 },
    ),
    getMenuPreview: vi.fn(async (id: string) =>
      id === "menu-lunch" ? lunchPreview() : dinnerPreview(),
    ),
    publishMenu: vi.fn().mockResolvedValue({ versionId: "v-lunch-3", number: 3 }),
    getMenuPublications: vi.fn(async () => ({
      timeZone: "Europe/Madrid",
      live: null,
      editions: [],
    })),
    scheduleMenuPublication: vi.fn(),
    rescheduleMenuPublication: vi.fn(),
    cancelMenuPublication: vi.fn(),
    getMenuHome: vi.fn(async (id: string) => (id === "menu-lunch" ? menuHome() : emptyHome())),
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

function writeCalls(client: Api): string[] {
  return WRITES.flatMap((name) =>
    (client[name] as ReturnType<typeof vi.fn>).mock.calls.map(() => name),
  );
}

async function mount(client: Api = api(), path = "/manage/menus", theme?: "light" | "dark") {
  history.replaceState(null, "", path);
  const { el } = await mountWidget<MenusScreen>("dashboard-menus-screen", { api: client }, theme);
  await vi.waitFor(() => {
    if (el.shadowRoot!.querySelector('[data-test="loading"]')) throw new Error("loading");
  });
  await el.updateComplete;
  return el;
}

/** Opens Lunch from its address and waits for its structure. */
async function mountLunch(client: Api = api()) {
  const el = await mount(client, LUNCH_PATH);
  await vi.waitFor(() => expect(structure(el)).not.toBeNull());
  await structure(el).updateComplete;
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
  if (testId.startsWith("rename-"))
    await vi.waitFor(() => expect(modal(el, "menu-form").open).toBe(true));
}

function modal(el: MenusScreen, testId: string) {
  if (testId === "menu-form" || testId === "new-section")
    return q<HTMLElementTagNameMap["dashboard-section-details-form"]>(
      el,
      `[data-test="${testId === "menu-form" ? "menu-form" : "section-form"}"]`,
    )!.shadowRoot!.querySelector("wt-modal")!;
  return q<HTMLElementTagNameMap["wt-modal"]>(el, `wt-modal[data-test="${testId}"]`)!;
}

function inModal<T extends Element = HTMLElement>(
  el: MenusScreen,
  testId: string,
  selector: string,
): T {
  return modal(el, testId).querySelector<T>(
    ["menu-form", "new-section"].includes(testId)
      ? selector
          .replace("new-section-save", "save")
          .replace("menu-save", "save")
          .replace("menu-form-cancel", "cancel")
          .replace("new-section-cancel", "cancel")
          .replace('name="name"', 'name="internalName"')
      : selector,
  )!;
}

/** The one message about a failed submission of `root`'s form. */
async function bottomIn(root: Element): Promise<string> {
  const direct = root.querySelector('[data-test="form-error"]');
  if (direct) return direct.textContent?.trim() ?? "";
  const actions = root.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!;
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
}

function bottom(el: MenusScreen, testId: string): Promise<string> {
  return bottomIn(modal(el, testId));
}

function type(target: Element, value: string): void {
  target.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}

function emit(target: Element, name: string, detail: unknown): void {
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}

function text(node: Element | null): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Opens a list for editing the way a person does, through the tree. */
async function editDrinks(el: MenusScreen): Promise<void> {
  await toggleRow(el, "m-drinks");
  await vi.waitFor(() => expect(currentPlace(el)).toBe("Lunch Menu › Drinks"));
}

/** Another change's update, leaving Lunch with Burger alone, so the editor falls back to the top. */
async function takeDrinksOff(el: MenusScreen, client: Api, live: LiveData): Promise<void> {
  client.getMenuStructure.mockResolvedValue({
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
    nodes: [productNode("m-burger", "p-burger")],
  });
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() => expect(currentPlace(el)).toBe("Lunch Menu"));
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

type StructureTable = HTMLElementTagNameMap["dashboard-menu-structure-table"];

function structure(el: MenusScreen): StructureTable {
  return q<StructureTable>(el, "dashboard-menu-structure-table")!;
}

/** The tree's own table, whose shadow root holds the rows. */
function structureRows(el: MenusScreen): Table {
  return structure(el).shadowRoot!.querySelector<Table>("wt-data-table")!;
}

function inStructure<T extends Element = HTMLElement>(el: MenusScreen, selector: string): T | null {
  return structureRows(el).shadowRoot.querySelector<T>(selector);
}

function allInStructure<T extends Element = HTMLElement>(el: MenusScreen, selector: string): T[] {
  return [...structureRows(el).shadowRoot.querySelectorAll<T>(selector)];
}

/** Waits for the screen, the tree and the tree's table to draw what the screen holds. */
async function settleStructure(el: MenusScreen): Promise<void> {
  for (let round = 0; round < 3; round++) {
    await el.updateComplete;
    const tree = q<StructureTable>(el, "dashboard-menu-structure-table");
    await tree?.updateComplete;
    await tree?.shadowRoot!.querySelector<Table>("wt-data-table")?.updateComplete;
  }
}

function rowOf(el: MenusScreen, key: string): HTMLElement | null {
  return inStructure(el, `tr[data-row-key="${CSS.escape(key)}"]`);
}

function reorderToggle(el: MenusScreen): HTMLButtonElement {
  return q<HTMLButtonElement>(el, '[data-test="reorder"]')!;
}

/** Turns the Structure tree's Reorder mode on or off, as a click on its toggle does. */
async function pressReorder(el: MenusScreen): Promise<void> {
  reorderToggle(el).click();
  await settleStructure(el);
}

/** Opens or closes a section by its row, as a click on it does. */
async function toggleRow(el: MenusScreen, key: string): Promise<void> {
  rowOf(el, key)!.querySelector<HTMLElement>(".row-activate")!.click();
  await settleStructure(el);
}

/** Opens a row's ⋮ and chooses `action` in it, focusing the item first as a person's click
 * leaves it. */
async function rowAction(el: MenusScreen, key: string, action: string): Promise<void> {
  await settleStructure(el);
  inStructure<HTMLElementTagNameMap["wt-row-actions"]>(
    el,
    `[data-test="${CSS.escape(`actions-${key}`)}"]`,
  )!.show();
  const item = inStructure(el, `[data-test="${CSS.escape(`${action}-${key}`)}"]`)!;
  item.focus();
  item.click();
  await settleStructure(el);
}

/** The keys of the rows drawn at the menu's own top level, in order. */
function topLevelKeys(el: MenusScreen): string[] {
  return allInStructure(el, 'tbody tr[aria-level="2"]')
    .map((row) => row.dataset.rowKey!)
    .filter((key) => !key.startsWith("home/"));
}

/** The keys of the rows drawn directly under `key`'s row, in order. */
function childKeys(el: MenusScreen, key: string): string[] {
  const depth = key === "root" ? 0 : key.split("/").length;
  return allInStructure(el, "tbody tr[data-row-key]")
    .map((row) => row.dataset.rowKey!)
    .filter(
      (shown) =>
        shown !== "root" &&
        shown !== "home" &&
        !shown.startsWith("home/") &&
        shown.split("/").length === depth + 1 &&
        (depth === 0 || shown.startsWith(`${key}/`)),
    );
}

/** The menu's name, then the names down to the row marked current, or "" when no row is. */
function currentPlace(el: MenusScreen): string {
  const key = inStructure(el, '[aria-current="true"]')?.closest("tr")?.dataset.rowKey;
  if (key === undefined) return "";
  const segments = key === "root" ? [] : key.split("/");
  return [
    structure(el).menuName,
    ...segments.map((_, index) =>
      text(rowOf(el, segments.slice(0, index + 1).join("/"))!.querySelector('[data-test="name"]')),
    ),
  ].join(" › ");
}

/** The key of the row marked current. */
function currentKey(el: MenusScreen): string {
  return inStructure(el, '[aria-current="true"]')!.closest("tr")!.dataset.rowKey!;
}

/** Lunch's structure holding `nodes` at its top level. */
function lunchWith(nodes: MenuStructureNode[], extra: Partial<MenuStructure> = {}): MenuStructure {
  return {
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
    ...extra,
  };
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
  expect(tabs.items.map((item) => item.key)).toEqual(["structure", "prices", "home", "preview"]);
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

it("puts Add menu under the empty menu table's sentence, opening the same form", async () => {
  const el = await mount(api({ listCatalogues: vi.fn().mockResolvedValue([]) }));
  const button = table(el).querySelector<HTMLElement>(":scope > [slot=empty-action]")!;
  expect(button.assignedSlot).not.toBeNull();
  expect(button.textContent!.trim()).toBe(t("menus.add"));
  button.click();
  await el.updateComplete;
  expect(modal(el, "menu-form").open).toBe(true);
});

/** Opens the menu form from the empty table's Add menu, focused as a person's click leaves it. */
async function openFromEmptyTable(el: MenusScreen): Promise<HTMLElement> {
  const button = table(el).querySelector<HTMLElement>(":scope > [slot=empty-action]")!;
  button.focus();
  button.click();
  await el.updateComplete;
  expect(modal(el, "menu-form").open).toBe(true);
  return button;
}

/** Lets a closing native dialog hand focus back, which it does a task after it closes. */
async function afterDialogCloses(el: MenusScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await el.updateComplete;
}

it("returns focus to the top Add menu after the first menu is made from the empty table", async () => {
  const el = await mount(
    api({ listCatalogues: vi.fn().mockResolvedValueOnce([]).mockResolvedValue(menus) }),
  );
  const button = await openFromEmptyTable(el);
  type(inModal(el, "menu-form", 'wt-input[name="name"]'), "Brunch");
  await el.updateComplete;
  inModal(el, "menu-form", '[data-test="menu-save"]').click();
  await vi.waitFor(() => expect(modal(el, "menu-form").open).toBe(false));
  await vi.waitFor(() => expect(button.isConnected).toBe(false));
  await afterDialogCloses(el);
  expect(el.shadowRoot!.activeElement).toBe(q(el, '.header [data-test="add-menu"]'));
});

it("returns focus to the empty table's Add menu after Cancel", async () => {
  const el = await mount(api({ listCatalogues: vi.fn().mockResolvedValue([]) }));
  const button = await openFromEmptyTable(el);
  inModal(el, "menu-form", '[data-test="cancel"]').click();
  await vi.waitFor(() => expect(modal(el, "menu-form").open).toBe(false));
  await afterDialogCloses(el);
  expect(el.shadowRoot!.activeElement).toBe(button);
});

it("draws no Add menu button in the menu table once menus exist", async () => {
  const el = await mount();
  expect(table(el).querySelector(":scope > [slot=empty-action]")).toBeNull();
});

/** The Add menu beside the page heading, as opposed to the one the empty table holds. */
function headerAdd(el: MenusScreen): HTMLElement {
  return q(el, '.header [data-test="add-menu"]')!;
}

/** Runs `body` at a viewport size and locale, putting both back afterwards. */
async function at(
  size: [number, number],
  locale: string,
  body: () => Promise<void>,
): Promise<void> {
  const width = window.innerWidth,
    height = window.innerHeight;
  const before = currentLocale();
  try {
    setLocale(locale);
    await page.viewport(...size);
    await body();
  } finally {
    setLocale(before);
    await page.viewport(width, height);
  }
}

describe("the menus list's heading row", () => {
  it.each([
    [[1280, 900], "en-GB"],
    [[375, 812], "es-ES"],
  ] as const)(
    "puts Add menu in the heading's row at its trailing edge, above the table (%j, %s)",
    async (size, locale) => {
      await at([...size], locale, async () => {
        const el = await mount();
        await vi.waitFor(() => expect(headerAdd(el)).not.toBeNull());
        const heading = q(el, "h1")!.getBoundingClientRect();
        const add = headerAdd(el).getBoundingClientRect();
        const list = table(el).getBoundingClientRect();
        expect(text(headerAdd(el))).toBe(t("menus.add"));
        expect(add.top).toBeLessThan(heading.bottom);
        expect(add.bottom).toBeGreaterThan(heading.top);
        expect(add.left).toBeGreaterThan(heading.right);
        expect(add.right).toBeCloseTo(list.right, 0);
        expect(add.bottom).toBeLessThanOrEqual(list.top);
        expect(add.right).toBeLessThanOrEqual(window.innerWidth);
        expect(q(el, ".page-actions")).toBeNull();
      });
    },
  );

  it("moves a long Add label under the heading at phone width, whole and at the trailing edge", async () => {
    await at([320, 700], "es-ES", async () => {
      const el = await mount();
      await vi.waitFor(() => expect(headerAdd(el)).not.toBeNull());
      const oneLine = headerAdd(el).getBoundingClientRect().height;
      // Appended beside Lit's own text, which it must not replace. Too long to share the heading's
      // line at 320 px, short enough for a line of its own.
      headerAdd(el).append(" nueva de temporada");
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const add = headerAdd(el).getBoundingClientRect();
      const heading = q(el, "h1")!.getBoundingClientRect();
      const header = q(el, ".header")!.getBoundingClientRect();
      expect(add.top).toBeGreaterThanOrEqual(heading.bottom);
      expect(add.height).toBeCloseTo(oneLine, 0);
      expect(add.right).toBeCloseTo(header.right, 0);
      expect(add.right).toBeLessThanOrEqual(window.innerWidth);
    });
  });

  it("still offers Add menu under the empty table's sentence, and in the heading's row", async () => {
    const el = await mount(api({ listCatalogues: vi.fn().mockResolvedValue([]) }));
    expect(table(el).querySelector(":scope > [slot=empty-action]")).not.toBeNull();
    expect(headerAdd(el)).not.toBeNull();
  });

  it("returns focus to the heading's Add menu after a menu is made from it, and after Cancel", async () => {
    const el = await mount(
      api({ listCatalogues: vi.fn().mockResolvedValueOnce(menus).mockResolvedValue(menus) }),
    );
    headerAdd(el).focus();
    headerAdd(el).click();
    await el.updateComplete;
    inModal(el, "menu-form", '[data-test="cancel"]').click();
    await vi.waitFor(() => expect(modal(el, "menu-form").open).toBe(false));
    await afterDialogCloses(el);
    expect(el.shadowRoot!.activeElement).toBe(headerAdd(el));
    headerAdd(el).click();
    await el.updateComplete;
    type(inModal(el, "menu-form", 'wt-input[name="name"]'), "Brunch");
    await el.updateComplete;
    inModal(el, "menu-form", '[data-test="menu-save"]').click();
    await vi.waitFor(() => expect(modal(el, "menu-form").open).toBe(false));
    await afterDialogCloses(el);
    expect(el.shadowRoot!.activeElement).toBe(headerAdd(el));
  });
});

describe("a menus list row", () => {
  /** Counts the history entries opening a menu adds, so a double open shows as two. */
  function countOpens(): () => string[] {
    const pushed: string[] = [];
    const real = history.pushState.bind(history);
    vi.spyOn(history, "pushState").mockImplementation((state, unused, url) => {
      pushed.push(String(url));
      real(state, unused, url);
    });
    onTestFinished(() => vi.mocked(history.pushState).mockRestore());
    return () => pushed.filter((url) => url.includes("/menu/"));
  }

  function row(el: MenusScreen, id: string): HTMLTableRowElement {
    return table(el).shadowRoot.querySelector<HTMLTableRowElement>(`tr[data-row-key="${id}"]`)!;
  }

  async function liveRow(el: MenusScreen): Promise<HTMLTableRowElement> {
    await vi.waitFor(() =>
      expect(
        text(row(el, "menu-dinner").querySelector('[data-test="status-menu-dinner"]')),
      ).toContain(t("menu_status.current")),
    );
    return row(el, "menu-dinner");
  }

  it("opens its menu once from a click on its Status cell, as the name does", async () => {
    await at([1280, 900], "en-GB", async () => {
      const opens = countOpens();
      const el = await mount();
      const live = await liveRow(el);
      expect(live.querySelectorAll("td")).toHaveLength(4);
      // Forced, because the status text lies under the row's stretched button, which takes the click.
      await userEvent.click(live.querySelector<HTMLElement>('[data-test="status-menu-dinner"]')!, {
        force: true,
      });
      await vi.waitFor(() =>
        expect(location.pathname).toBe("/manage/menus/menu/menu-dinner/view/structure"),
      );
      expect(opens()).toHaveLength(1);
    });
  });

  it("opens its menu once from a real click on the name button", async () => {
    const opens = countOpens();
    const el = await mount();
    await table(el).updateComplete;
    await userEvent.click(
      table(el).shadowRoot.querySelector<HTMLElement>('[data-test="open-menu-lunch"]')!,
    );
    await vi.waitFor(() => expect(location.pathname).toBe(LUNCH_PATH));
    expect(opens()).toHaveLength(1);
  });

  it("names the row's own button by its action and menu, and opens once from Enter", async () => {
    const opens = countOpens();
    const el = await mount();
    await table(el).updateComplete;
    const activator = row(el, "menu-lunch").querySelector<HTMLButtonElement>(".row-activate")!;
    expect(activator.getAttribute("aria-label")).toBe(`${t("menus.open")}: Lunch Menu`);
    activator.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(location.pathname).toBe(LUNCH_PATH));
    expect(opens()).toHaveLength(1);
  });

  it("keeps the row menu and the sort heading to themselves", async () => {
    const opens = countOpens();
    const el = await mount();
    await table(el).updateComplete;
    await userEvent.click(
      table(el).shadowRoot.querySelector<HTMLElement>('button[data-sort="name"]')!,
    );
    const menu = row(el, "menu-lunch").querySelector<HTMLElement>("wt-row-actions")!;
    await userEvent.click(menu.shadowRoot!.querySelector<HTMLElement>("button")!);
    await userEvent.click(
      table(el).shadowRoot.querySelector<HTMLElement>('[data-test="rename-menu-lunch"]')!,
    );
    await vi.waitFor(() => expect(modal(el, "menu-form").open).toBe(true));
    expect(location.pathname).toBe("/manage/menus");
    expect(opens()).toHaveLength(0);
  });

  it.each(["light", "dark"] as const)(
    "highlights the whole of a hovered or focused Live row, its row menu's cell included (%s)",
    (theme) => at([1280, 900], "en-GB", () => highlightsLiveRow(theme)),
  );

  async function highlightsLiveRow(theme: "light" | "dark"): Promise<void> {
    const { el, host } = await mountWidget<MenusScreen>(
      "dashboard-menus-screen",
      { api: api() },
      theme,
    );
    await vi.waitFor(() => expect(table(el)).not.toBeNull());
    const live = await liveRow(el);
    const cells = [...live.querySelectorAll<HTMLElement>("td")];
    const lifted = getComputedStyle(host).getPropertyValue("--wt-color-surface-lifted").trim();
    const probe = document.createElement("div");
    probe.style.background = lifted;
    host.append(probe);
    const highlight = getComputedStyle(probe).backgroundColor;
    const resting = getComputedStyle(cells.at(-1)!).backgroundColor;
    expect(highlight).not.toBe(resting);
    await userEvent.hover(cells[0]!);
    for (const cell of cells) expect(getComputedStyle(cell).backgroundColor).toBe(highlight);
    await commands.parkPointer();
    for (const cell of cells) expect(getComputedStyle(cell).backgroundColor).not.toBe(highlight);
    live.querySelector<HTMLButtonElement>(".row-activate")!.focus();
    for (const cell of cells) expect(getComputedStyle(cell).backgroundColor).toBe(highlight);
    expect(cells).toHaveLength(4);
  }
});

describe("the menus list's columns", () => {
  it.each([
    [1280, 900, true],
    [390, 844, false],
  ] as const)(
    "offers Customise columns only where Status and Changes are columns (%i px)",
    async (width, height, offered) => {
      await at([width, height], "en-GB", async () => {
        const el = await mount();
        await vi.waitFor(async () => {
          await table(el).updateComplete;
          expect(table(el).shadowRoot.querySelectorAll("tbody tr")).toHaveLength(2);
        });
        expect(table(el).shadowRoot.querySelector(".columns-trigger") !== null).toBe(offered);
        expect(table(el).shadowRoot.querySelector(".table-toolbar") !== null).toBe(offered);
      });
    },
  );

  describe("before the list reports a size", () => {
    // No size report ever arrives, so the layout can come only from the list as it is drawn.
    beforeEach(() => {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
      onTestFinished(() => void vi.unstubAllGlobals());
    });

    it("draws a phone-width list in its phone layout the first time it is shown (390 px)", async () => {
      await at([390, 844], "en-GB", async () => {
        const el = await mount();
        await vi.waitFor(async () => {
          await table(el).updateComplete;
          expect(table(el).shadowRoot.querySelectorAll("tbody tr")).toHaveLength(2);
        });
        expect(table(el).classList.contains("narrow")).toBe(true);
        expect(table(el).shadowRoot.querySelector(".columns-trigger")).toBeNull();
      });
    });

    it("draws the phone layout again on coming back to the list from a menu (390 px)", async () => {
      await at([390, 844], "en-GB", async () => {
        const el = await mount(api(), LUNCH_PATH);
        await vi.waitFor(() => expect(structure(el)).not.toBeNull());
        await click(el, "back");
        await vi.waitFor(() => expect(table(el)).not.toBeNull());
        await table(el).updateComplete;
        expect(table(el).classList.contains("narrow")).toBe(true);
      });
    });
  });

  it("ignores a column choice saved under the list's previous key: Status, and the Lunch row's state on a phone, stay shown", async () => {
    localStorage.setItem("waitron.menus.table:columns", JSON.stringify({ status: false }));
    await at([1280, 900], "en-GB", () => statusSavedHidden());
  });

  async function statusSavedHidden(): Promise<void> {
    const el = await mount();
    const heads = () =>
      [...table(el).shadowRoot.querySelectorAll("thead th")].map((th) => text(th));
    await vi.waitFor(async () => {
      await table(el).updateComplete;
      expect(heads()).toContain(t("menus.status"));
    });
    expect(table(el).shadowRoot.querySelector(".columns-trigger")).not.toBeNull();
    await at([390, 844], "en-GB", async () => {
      await vi.waitFor(async () => {
        await table(el).updateComplete;
        expect(heads()).not.toContain(t("menus.status"));
      });
      await vi.waitFor(() =>
        expect(text(table(el).shadowRoot.querySelector('tr[data-row-key="menu-lunch"] td'))).toBe(
          `Lunch Menu Published Version 2 · ${formatIsoMinute(PUBLISHED_AT)} Unpublished changes`,
        ),
      );
      expect(table(el).shadowRoot.querySelector(".columns-trigger")).toBeNull();
    });
    expect(JSON.parse(localStorage.getItem("waitron.menus.table:columns")!)).toEqual({
      status: false,
    });
  }
});

describe("the menus list's Changes column", () => {
  const PREVIEW = (id: string) => `/manage/menus/menu/${id}/view/preview`;
  const BRUNCH: CatalogueSummary = {
    id: "menu-brunch",
    name: "Brunch Menu",
    active: true,
    version: 1,
  };

  /** Lunch has changes on its live version 2, Dinner is current, Brunch was never published. */
  function mixed(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}): Api {
    return api({
      listCatalogues: vi.fn().mockResolvedValue([...menus, BRUNCH]),
      getMenuStatuses: vi
        .fn()
        .mockResolvedValue({ ...statuses(), "menu-brunch": { state: "unpublished", clashes: 0 } }),
      ...overrides,
    });
  }

  function heads(el: MenusScreen): string[] {
    return [...table(el).shadowRoot.querySelectorAll("thead th")].map((th) => text(th));
  }

  function row(el: MenusScreen, id: string): HTMLTableRowElement {
    return table(el).shadowRoot.querySelector<HTMLTableRowElement>(`tr[data-row-key="${id}"]`)!;
  }

  /** The cell under the Changes heading. */
  function changesCell(el: MenusScreen, id: string): HTMLTableCellElement {
    const index = heads(el).indexOf(t("menus.changes"));
    expect(index).toBeGreaterThan(0);
    return row(el, id).querySelectorAll("td")[index]!;
  }

  function link(el: MenusScreen, id: string): HTMLAnchorElement | null {
    return row(el, id).querySelector<HTMLAnchorElement>("a");
  }

  function statusOf(el: MenusScreen, id: string): string {
    return text(table(el).shadowRoot.querySelector(`[data-test="status-${id}"]`));
  }

  async function listed(client: Api): Promise<MenusScreen> {
    const el = await mount(client);
    await vi.waitFor(async () => {
      await table(el).updateComplete;
      expect(statusOf(el, "menu-dinner")).toContain(t("menu_status.current"));
    });
    return el;
  }

  /** The history entries each open adds, so opening a tab after another shows as two. */
  function opened(): () => string[] {
    const pushed: string[] = [];
    const real = history.pushState.bind(history);
    vi.spyOn(history, "pushState").mockImplementation((state, unused, url) => {
      pushed.push(String(url));
      real(state, unused, url);
    });
    onTestFinished(() => vi.mocked(history.pushState).mockRestore());
    return () =>
      pushed
        .filter((url) => url.includes("/menu/"))
        .map((url) => new URL(url, location.href).pathname);
  }

  it("keeps a changed menu's live version in Status and links its unpublished changes under Changes", async () => {
    await at([1280, 900], "en-GB", async () => {
      const el = await listed(mixed());
      const shown = heads(el);
      expect(shown.indexOf(t("menus.status"))).toBeGreaterThan(0);
      expect(shown.indexOf(t("menus.changes"))).toBe(shown.indexOf(t("menus.status")) + 1);
      expect(statusOf(el, "menu-lunch")).toBe(
        `Published Version 2 · ${formatIsoMinute(PUBLISHED_AT)}`,
      );
      const changes = link(el, "menu-lunch")!;
      expect(changes.closest("td")).toBe(changesCell(el, "menu-lunch"));
      expect(text(changes)).toBe("Unpublished changes");
      expect(new URL(changes.href).pathname).toBe(PREVIEW("menu-lunch"));
      expect(changes.getAttribute("aria-label")).toBe("Unpublished changes: Lunch Menu");
      expect(statusOf(el, "menu-dinner")).toBe(
        `Published Version 5 · ${formatIsoMinute("2026-09-20T18:00:00.000Z")}`,
      );
      expect(statusOf(el, "menu-brunch")).toBe("Unpublished");
      for (const id of ["menu-dinner", "menu-brunch"]) {
        expect(link(el, id), id).toBeNull();
        expect(text(changesCell(el, id)), id).toBe("");
      }
    });
  });

  it("names the column and its link in Spanish", async () => {
    await at([1280, 900], "es-ES", async () => {
      const el = await listed(mixed());
      expect(heads(el)).toContain("Cambios");
      expect(text(link(el, "menu-lunch"))).toBe("Cambios sin publicar");
      expect(link(el, "menu-lunch")!.getAttribute("aria-label")).toBe(
        "Cambios sin publicar: Lunch Menu",
      );
    });
  });

  it("claims nothing under Changes while the states are read, or once their read fails", async () => {
    await at([1280, 900], "en-GB", async () => {
      const held = deferred<Record<string, MenuStatus>>();
      const loading = await mount(api({ getMenuStatuses: vi.fn().mockReturnValue(held.promise) }));
      await vi.waitFor(async () => {
        await table(loading).updateComplete;
        expect(statusOf(loading, "menu-lunch")).toBe("Checking…");
      });
      expect(link(loading, "menu-lunch")).toBeNull();
      expect(text(changesCell(loading, "menu-lunch"))).toBe("");
      cleanupWidgets();

      const failed = await mount(
        api({ getMenuStatuses: vi.fn().mockRejectedValue(new Error("offline")) }),
      );
      await vi.waitFor(async () => {
        await table(failed).updateComplete;
        expect(statusOf(failed, "menu-lunch")).toBe("Could not be checked");
      });
      expect(link(failed, "menu-lunch")).toBeNull();
      expect(text(changesCell(failed, "menu-lunch"))).toBe("");
    });
  });

  it("keeps a changed menu's clashes in Status beside its link", async () => {
    await at([1280, 900], "en-GB", async () => {
      const el = await listed(
        api({
          getMenuStatuses: vi.fn().mockResolvedValue({
            ...statuses(),
            "menu-lunch": { ...statuses()["menu-lunch"], clashes: 2 },
          }),
        }),
      );
      expect(statusOf(el, "menu-lunch")).toBe(
        `Published 2 clashes Version 2 · ${formatIsoMinute(PUBLISHED_AT)}`,
      );
      expect(text(link(el, "menu-lunch"))).toBe("Unpublished changes");
    });
  });

  it("opens the menu's Preview tab straight from the link, never its first tab or the row", async () => {
    await at([1280, 900], "en-GB", async () => {
      const opens = opened();
      const client = mixed();
      const el = await listed(client);
      const changes = link(el, "menu-lunch")!;
      const box = changes.getBoundingClientRect();
      const hit = table(el).shadowRoot.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      expect(changes.contains(hit)).toBe(true);
      await userEvent.click(changes);
      await vi.waitFor(() => expect(location.pathname).toBe(PREVIEW("menu-lunch")));
      expect(opens()).toEqual([PREVIEW("menu-lunch")]);
      await vi.waitFor(() => expect(client.getMenuPreview).toHaveBeenCalledWith("menu-lunch"));
      expect(client.getMenuStatus).not.toHaveBeenCalled();
      expect(client.getMenuPrices).not.toHaveBeenCalled();
    });
  });

  it("opens nothing from a click on the Changes cell's blank space beside its link", async () => {
    await at([1280, 900], "en-GB", async () => {
      const opens = opened();
      const el = await listed(mixed());
      const cell = changesCell(el, "menu-lunch");
      const box = cell.getBoundingClientRect();
      const anchor = link(el, "menu-lunch")!;
      const changes = anchor.getBoundingClientRect();
      expect(changes.right).toBeLessThan(box.right - 2);
      // The cell's padding corner, and the padding past the link's end on its line.
      const points = [
        { x: 2, y: 2 },
        { x: (changes.right + box.right) / 2 - box.x, y: changes.top + changes.height / 2 - box.y },
      ];
      for (const position of points) {
        const label = JSON.stringify(position);
        const hit = table(el).shadowRoot.elementFromPoint(box.x + position.x, box.y + position.y);
        expect(anchor.contains(hit), label).toBe(false);
        expect(cell.contains(hit), label).toBe(true);
        // Forced, so a row activator lying over the point takes the click rather than stalling it.
        await userEvent.click(cell, { position, force: true });
        await el.updateComplete;
        expect(location.pathname, label).toBe("/manage/menus");
      }
      expect(opens()).toEqual([]);
    });
  });

  it("opens the Preview tab from Enter on the focused link", async () => {
    const opens = opened();
    const el = await listed(mixed());
    link(el, "menu-lunch")!.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(location.pathname).toBe(PREVIEW("menu-lunch")));
    expect(opens()).toEqual([PREVIEW("menu-lunch")]);
  });

  it("leaves a click with a modifier key to the browser, such as opening a new tab", async () => {
    const opens = opened();
    const el = await listed(mixed());
    const seen: boolean[] = [];
    // Runs after the link's own handler, then stops the test page itself from navigating.
    const watch = (event: Event) => {
      seen.push(event.defaultPrevented);
      event.preventDefault();
    };
    window.addEventListener("click", watch);
    onTestFinished(() => window.removeEventListener("click", watch));
    link(el, "menu-lunch")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, ctrlKey: true }),
    );
    await el.updateComplete;
    expect(seen).toEqual([false]);
    expect(location.pathname).toBe("/manage/menus");
    expect(opens()).toEqual([]);
  });

  /** The glyph box of the first text inside `parent`, at any depth. */
  function firstLine(parent: Element): DOMRect {
    const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT, (node) =>
      node.textContent!.trim() === "" ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT,
    );
    const range = document.createRange();
    range.selectNodeContents(walker.nextNode()!);
    return range.getClientRects()[0]!;
  }

  it.each(["menu-lunch", "menu-dinner", "menu-brunch"])(
    "starts %s's name, state, changes and row menu at the row's top, on one line",
    async (id) => {
      await at([1280, 900], "en-GB", async () => {
        const el = await listed(mixed());
        expect(table(el).hasAttribute("top-aligned")).toBe(true);
        const cells = [...row(el, id).querySelectorAll("td")];
        expect(cells).toHaveLength(4);
        for (const cell of cells) expect(getComputedStyle(cell).verticalAlign).toBe("top");
        const name = firstLine(row(el, id).querySelector('[part="name-text"]')!);
        const status = firstLine(table(el).shadowRoot.querySelector(`[data-test="status-${id}"]`)!);
        expect(Math.abs(status.bottom - name.bottom), "state against name").toBeLessThanOrEqual(2);
        const changes = link(el, id);
        if (changes)
          expect(
            Math.abs(firstLine(changes).bottom - name.bottom),
            "link against name",
          ).toBeLessThanOrEqual(2);
        const menu = row(el, id)
          .querySelector("wt-row-actions")!
          .shadowRoot!.querySelector("button")!;
        const box = menu.getBoundingClientRect();
        const middle = box.top + box.height / 2;
        expect(middle, "row menu against the line").toBeGreaterThanOrEqual(name.top);
        expect(middle, "row menu against the line").toBeLessThanOrEqual(name.bottom);
        const top = row(el, id).getBoundingClientRect().top;
        const padding = parseFloat(getComputedStyle(cells[0]!).paddingTop);
        expect(box.top - top, "row menu at the row's top").toBeLessThanOrEqual(padding + 2);
      });
    },
  );

  it("stacks the state and the changes link under the name at phone width, with no column chooser", async () => {
    await at([390, 844], "en-GB", async () => {
      const opens = opened();
      const el = await listed(mixed());
      await vi.waitFor(() => expect(heads(el)).not.toContain(t("menus.status")));
      expect(heads(el)).not.toContain(t("menus.changes"));
      const first = row(el, "menu-lunch").querySelector("td")!;
      expect(text(first)).toBe(
        `Lunch Menu Published Version 2 · ${formatIsoMinute(PUBLISHED_AT)} Unpublished changes`,
      );
      expect(link(el, "menu-lunch")!.closest("td")).toBe(first);
      expect(text(row(el, "menu-dinner").querySelector("td"))).toBe(
        `Dinner Menu Published Version 5 · ${formatIsoMinute("2026-09-20T18:00:00.000Z")}`,
      );
      expect(link(el, "menu-dinner")).toBeNull();
      expect(table(el).shadowRoot.querySelector(".columns-trigger")).toBeNull();
      const scroll = table(el).shadowRoot.querySelector<HTMLElement>(".scroll")!;
      expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
      await userEvent.click(link(el, "menu-lunch")!);
      await vi.waitFor(() => expect(location.pathname).toBe(PREVIEW("menu-lunch")));
      expect(opens()).toEqual([PREVIEW("menu-lunch")]);
    });
  });

  async function openChooser(el: MenusScreen): Promise<ShadowRoot> {
    const root = table(el).shadowRoot;
    root.querySelector<HTMLButtonElement>(".columns-trigger")!.click();
    await table(el).updateComplete;
    return root;
  }

  it("offers Customise columns on a desktop list, where Status and Changes can each be hidden", async () => {
    await at([1280, 900], "en-GB", async () => {
      const el = await listed(mixed());
      const root = await openChooser(el);
      for (const key of ["status", "changes"]) {
        const eye = root.querySelector<HTMLInputElement>(`input[data-column="${key}"]`)!;
        expect(eye.checked, key).toBe(true);
        expect(eye.disabled, key).toBe(false);
      }
      root.querySelector<HTMLInputElement>('input[data-column="changes"]')!.click();
      await table(el).updateComplete;
      expect(heads(el)).not.toContain(t("menus.changes"));
      expect(heads(el)).toContain(t("menus.status"));
      expect(JSON.parse(localStorage.getItem(`${LIST_KEY}:columns`)!)).toEqual({ changes: false });
    });
  });

  it("hides Status as saved under the list's own key, still shows Changes, and stacks both on a phone", async () => {
    localStorage.setItem(`${LIST_KEY}:columns`, JSON.stringify({ status: false }));
    await at([1280, 900], "en-GB", async () => {
      const el = await mount(mixed());
      await vi.waitFor(async () => {
        await table(el).updateComplete;
        expect(text(link(el, "menu-lunch"))).toBe("Unpublished changes");
      });
      expect(heads(el)).not.toContain(t("menus.status"));
      expect(heads(el)).toContain(t("menus.changes"));
      const root = await openChooser(el);
      expect(root.querySelector<HTMLInputElement>('input[data-column="status"]')!.checked).toBe(
        false,
      );
      await at([390, 844], "en-GB", async () => {
        await vi.waitFor(() => expect(heads(el)).not.toContain(t("menus.changes")));
        expect(text(row(el, "menu-lunch").querySelector("td"))).toBe(
          `Lunch Menu Published Version 2 · ${formatIsoMinute(PUBLISHED_AT)} Unpublished changes`,
        );
      });
    });
  });

  const HYPHENATED = "Menú-del-mediodía-de-lunes-a-viernes-con-postre";
  const SPACED = "Menú del mediodía de lunes a viernes, con postre y bebida incluidos";
  const UNBROKEN = "Menúdelmediodíadelunesaviernesconpostreybebidaincluidos";

  /** The mixed list, with Lunch, the menu that has changes, under a long name. */
  function named(name: string): Api {
    return mixed({
      listCatalogues: vi.fn().mockResolvedValue([{ ...menus[0]!, name }, menus[1]!, BRUNCH]),
    });
  }

  function scrollBox(el: MenusScreen): HTMLElement {
    return table(el).shadowRoot.querySelector<HTMLElement>(".scroll")!;
  }

  /** The link lies in the table's box, left of the pinned row menu, on the screen, and nothing
   * covers it, with the table scrolled to its start. */
  function expectLinkOnScreen(el: MenusScreen, id: string): void {
    const anchor = link(el, id)!;
    const scroll = scrollBox(el);
    expect(scroll.scrollLeft).toBe(0);
    const box = scroll.getBoundingClientRect();
    const at = anchor.getBoundingClientRect();
    const menu = row(el, id).querySelector("td[data-pinned]")!.getBoundingClientRect();
    expect(at.left, "against the box").toBeGreaterThanOrEqual(box.left);
    expect(at.right, "against the row menu").toBeLessThanOrEqual(menu.left);
    expect(at.right, "against the screen").toBeLessThanOrEqual(window.innerWidth);
    for (const x of [at.left + 2, at.left + at.width / 2, at.right - 2]) {
      const hit = table(el).shadowRoot.elementFromPoint(x, at.top + at.height / 2);
      expect(hit !== null && anchor.contains(hit), `covered at ${x}`).toBe(true);
    }
  }

  async function threeColumns(el: MenusScreen): Promise<void> {
    await vi.waitFor(async () => {
      await table(el).updateComplete;
      expect(heads(el)).toHaveLength(3);
    });
    expect(heads(el)[1]).toBe(t("menus.status"));
  }

  describe.each([
    [600, "en-GB"],
    [600, "es-ES"],
    [700, "en-GB"],
    [700, "es-ES"],
    [790, "en-GB"],
    [790, "es-ES"],
  ] as const)("between the phone layout and a wide list (%i px, %s)", (width, locale) => {
    it.each([HYPHENATED, SPACED, UNBROKEN])(
      "puts the link under the state in Status, on screen without scrolling, beside %s",
      async (name) => {
        await at([width, 900], locale, async () => {
          const el = await listed(named(name));
          await threeColumns(el);
          expect(table(el).shadowRoot.querySelector(".columns-trigger")).toBeNull();
          const cell = row(el, "menu-lunch").querySelectorAll("td")[1]!;
          const anchor = link(el, "menu-lunch")!;
          expect(anchor.closest("td")).toBe(cell);
          expect(text(anchor)).toBe(t("menus.changes_link"));
          const state = cell.querySelector('[data-test="status-menu-lunch"]')!;
          expect(state.contains(anchor)).toBe(false);
          const under = state.getBoundingClientRect();
          const at = anchor.getBoundingClientRect();
          expect(at.top, "under the state").toBeGreaterThanOrEqual(under.bottom - 1);
          expect(Math.abs(at.left - under.left), "lined up with the state").toBeLessThanOrEqual(1);
          expectLinkOnScreen(el, "menu-lunch");
          for (const id of ["menu-dinner", "menu-brunch"]) expect(link(el, id), id).toBeNull();
        });
      },
    );
  });

  describe.each([
    [816, "en-GB"],
    [816, "es-ES"],
    [1280, "en-GB"],
    [1280, "es-ES"],
  ] as const)("on a wide list (%i px, %s)", (width, locale) => {
    it.each([HYPHENATED, SPACED, UNBROKEN])(
      "fits all four columns in the box beside %s, the link under Changes",
      async (name) => {
        await at([width, 900], locale, async () => {
          const el = await listed(named(name));
          await vi.waitFor(async () => {
            await table(el).updateComplete;
            expect(heads(el)).toHaveLength(4);
          });
          expect(heads(el).slice(1, 3)).toEqual([t("menus.status"), t("menus.changes")]);
          const scroll = scrollBox(el);
          expect(scroll.scrollWidth, "no sideways scrolling").toBeLessThanOrEqual(
            scroll.clientWidth,
          );
          expect(link(el, "menu-lunch")!.closest("td")).toBe(changesCell(el, "menu-lunch"));
          expectLinkOnScreen(el, "menu-lunch");
        });
      },
    );
  });

  it("opens the Preview tab, and not the row, from the link in the Status cell", async () => {
    await at([700, 900], "en-GB", async () => {
      const opens = opened();
      const el = await listed(mixed());
      await threeColumns(el);
      await userEvent.click(link(el, "menu-lunch")!);
      await vi.waitFor(() => expect(location.pathname).toBe(PREVIEW("menu-lunch")));
      expect(opens()).toEqual([PREVIEW("menu-lunch")]);
    });
  });

  it.each(["corner", "beside the link"] as const)(
    "opens the menu once from a click on the Status cell's blank space (%s)",
    async (where) => {
      await at([700, 900], "en-GB", async () => {
        const opens = opened();
        const el = await listed(mixed());
        await threeColumns(el);
        const cell = row(el, "menu-lunch").querySelectorAll("td")[1]!;
        const box = cell.getBoundingClientRect();
        const anchor = link(el, "menu-lunch")!;
        const at = anchor.getBoundingClientRect();
        expect(at.right).toBeLessThan(box.right - 4);
        const position =
          where === "corner"
            ? { x: 2, y: 2 }
            : { x: (at.right + box.right) / 2 - box.x, y: at.top + at.height / 2 - box.y };
        const hit = table(el).shadowRoot.elementFromPoint(box.x + position.x, box.y + position.y);
        expect(anchor.contains(hit)).toBe(false);
        // Forced, because the blank space lies under the row's stretched button, which takes it.
        await userEvent.click(cell, { position, force: true });
        const structure = "/manage/menus/menu/menu-lunch/view/structure";
        await vi.waitFor(() => expect(location.pathname).toBe(structure));
        expect(opens()).toEqual([structure]);
      });
    },
  );

  it.each([
    ["Status hidden", { columns: { status: false } }],
    ["Changes hidden", { columns: { changes: false } }],
    ["Changes moved before Status", { "column-order": ["changes", "status"] }],
  ] as const)(
    "keeps the link under the state between the layouts, and the wide choice after, with %s",
    async (_, saved) => {
      for (const [suffix, value] of Object.entries(saved))
        localStorage.setItem(`${LIST_KEY}:${suffix}`, JSON.stringify(value));
      const stored = () => [
        localStorage.getItem(`${LIST_KEY}:columns`),
        localStorage.getItem(`${LIST_KEY}:column-order`),
      ];
      const before = stored();
      await at([1280, 900], "en-GB", async () => {
        const el = await mount(mixed());
        await vi.waitFor(async () => {
          await table(el).updateComplete;
          expect(text(row(el, "menu-lunch"))).toMatch(/Version 2|Unpublished changes/);
        });
        const wide = heads(el);
        expect(wide).toHaveLength("columns" in saved ? 3 : 4);
        await at([700, 900], "en-GB", async () => {
          await threeColumns(el);
          expect(link(el, "menu-lunch")!.closest("td")).toBe(
            row(el, "menu-lunch").querySelectorAll("td")[1],
          );
          expectLinkOnScreen(el, "menu-lunch");
        });
        await vi.waitFor(async () => {
          await table(el).updateComplete;
          expect(heads(el)).toEqual(wide);
        });
      });
      expect(stored()).toEqual(before);
    },
  );
});

it("creating a menu needs a name: an empty one is explained beside the field and above Save", async () => {
  const client = api();
  const el = await mount(client);
  await click(el, "add-menu");
  expect(modal(el, "menu-form").open).toBe(true);
  const name = inModal<HTMLElementTagNameMap["wt-input"]>(el, "menu-form", 'wt-input[name="name"]');
  expect(name.required).toBe(true);
  inModal(el, "menu-form", '[data-test="menu-save"]').click();
  await el.updateComplete;
  expect(name.error).toBe(t("menus.name_required"));
  expect(await bottom(el, "menu-form")).toBe(t("form.fix_fields"));
  expect(client.createCatalogue).not.toHaveBeenCalled();

  type(name, "  Brunch  ");
  await el.updateComplete;
  expect(name.error).toBe("");
  inModal(el, "menu-form", '[data-test="menu-save"]').click();
  await vi.waitFor(() => expect(modal(el, "menu-form").open).toBe(false));
  expect(client.createCatalogue).toHaveBeenCalledExactlyOnceWith("Brunch", {
    names: {},
    image: null,
    color: null,
  });
  expect(client.listCatalogues).toHaveBeenCalledTimes(2);
  // Only the menus can have changed.
  for (const read of [
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
  await vi.waitFor(() =>
    expect(client.createCatalogue).toHaveBeenCalledExactlyOnceWith("Brunch", {
      names: {},
      image: null,
      color: null,
    }),
  );
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
    expect(await bottom(el, "menu-form")).toBe(codeMessage("management.request_invalid")),
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
  expect(client.updateMenuDetails).not.toHaveBeenCalled();
  type(name, "Weekday Lunch");
  await el.updateComplete;
  inModal(el, "menu-form", '[data-test="menu-save"]').click();
  await vi.waitFor(() => expect(modal(el, "menu-form").open).toBe(false));
  expect(client.updateMenuDetails).toHaveBeenCalledExactlyOnceWith("menu-lunch", {
    internalName: "Weekday Lunch",
    names: {},
    image: null,
    color: null,
  });
  expect(client.createCatalogue).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(client.listCatalogues).toHaveBeenCalledTimes(2));
  expect(client.getMenuStructure).toHaveBeenCalled();
});

it("reopens menu details with customer names, image and colour and retains them when renamed", async () => {
  const value = {
    rootSectionId: "root-lunch",
    nodes: lunchNodes(),
    includable: [],
    includedBy: [],
    root: {
      id: "root-lunch",
      internalName: "Lunch Menu",
      names: { en: "Lunch", es: "Almuerzo" },
      image: "lunch-photo.png",
      color: "#aa3300",
      members: [],
    },
  };
  const client = api({ getMenuStructure: vi.fn().mockResolvedValue(value) });
  const el = await mount(client);
  await inTable(el, "rename-menu-lunch");
  const form = q<HTMLElementTagNameMap["dashboard-section-details-form"]>(
    el,
    '[data-test="menu-form"]',
  )!;
  expect(form.value).toEqual(value.root);
  type(inModal(el, "menu-form", 'wt-input[name="name"]'), "Weekday Lunch");
  await el.updateComplete;
  inModal(el, "menu-form", '[data-test="menu-save"]').click();
  await vi.waitFor(() =>
    expect(client.updateMenuDetails).toHaveBeenCalledWith("menu-lunch", {
      internalName: "Weekday Lunch",
      names: { en: "Lunch", es: "Almuerzo" },
      image: "lunch-photo.png",
      color: "#aa3300",
    }),
  );
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
  await vi.waitFor(() => expect(rowOf(el, "home")).not.toBeNull());
  const home = "Página de inicio del dispositivo";
  const names = () => allInStructure(el, '[data-test="name"]').map((name) => text(name));
  expect(names()).toEqual([home, "Burger", "Drinks", "Favourites"]);
  await toggleRow(el, "m-drinks");
  expect(names()).toEqual([home, "Burger", "Drinks", "Lager", "Beer", "Lemonade", "Favourites"]);
  // Staff names only.
  const shown = text(inStructure(el, "tbody"));
  for (const wrong of ["Bebidas", "Something to drink", "for guests", "COCINA"])
    expect(shown).not.toContain(wrong);
});

it("edits the menu's own top level first, with no sharing to report and nothing to duplicate", async () => {
  const el = await mountLunch();
  expect(currentPlace(el)).toBe("Lunch Menu");
  expect(childKeys(el, "root")).toEqual(["m-burger", "m-drinks", "m-fav"]);
  expect(q(el, '[data-test="shared"]')).toBeNull();
  expect(q(el, '[data-test="duplicate-here"]')).toBeNull();
});

it("edits a section in place, marking the path followed in the tree", async () => {
  const el = await mountLunch();
  await editDrinks(el);
  expect(childKeys(el, "m-drinks").map((key) => key.split("/").at(-1))).toEqual([
    "m-lager",
    "m-beer",
    "m-lemonade",
  ]);
  await toggleRow(el, "m-drinks/m-beer");
  expect(currentPlace(el)).toBe("Lunch Menu › Drinks › Beer");
  expect(childKeys(el, "m-drinks/m-beer")).toEqual(["m-drinks/m-beer/m-lager-2"]);
  // The tree marks the same place.
  await settleStructure(el);
  expect(
    rowOf(el, "m-drinks/m-beer")!.querySelector('[data-test="name"]')!.getAttribute("aria-current"),
  ).toBe("true");
  await toggleRow(el, "m-drinks/m-beer");
  expect(currentPlace(el)).toBe("Lunch Menu › Drinks");
  await toggleRow(el, "m-drinks");
  expect(currentPlace(el)).toBe("Lunch Menu");
});

it("keeps the current list's Add actions in its own row's ⋮, not beside the Structure tab", async () => {
  const el = await mountLunch(api());
  await editDrinks(el);
  const tabs = q(el, 'wt-tabs[data-test="menu-tabs"]')!;
  for (const key of ["root", "m-drinks"])
    for (const action of ["new-section", "include-menu", "open-add-products"])
      expect(
        inStructure(el, `[data-test="actions-${key}"] [data-test="${action}-${key}"]`),
        `${action}-${key}`,
      ).not.toBeNull();
  expect(tabs.querySelector('[slot="actions"]')).toBeNull();
});

it("keeps the new-section form open and explains a refused section", async () => {
  const client = api({
    createSectionIn: vi.fn().mockRejectedValue({ code: "management.request_invalid" }),
  });
  const el = await mountLunch(client);
  await editDrinks(el);
  await rowAction(el, "m-drinks", "new-section");
  type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Ciders");
  await el.updateComplete;
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(async () =>
    expect(await bottom(el, "new-section")).toBe(codeMessage("management.request_invalid")),
  );
  expect(modal(el, "new-section").open).toBe(true);
  expect(client.addSectionMember).not.toHaveBeenCalled();
});

it("creates a section without leaving the editor and adds it to the list being edited", async () => {
  const client = api();
  const el = await mountLunch(client);
  await editDrinks(el);
  await rowAction(el, "m-drinks", "new-section");
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
  expect(await bottom(el, "new-section")).toBe(t("form.fix_fields"));
  expect(writeCalls(client)).toEqual([]);

  type(name, "Ciders");
  await el.updateComplete;
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(() => expect(modal(el, "new-section").open).toBe(false));
  expect(client.createSectionIn).toHaveBeenCalledExactlyOnceWith("s-drinks", {
    internalName: "Ciders",
    names: {},
    image: null,
    color: null,
  });
  expect(client.addSectionMember).not.toHaveBeenCalled();
  expect(currentPlace(el)).toBe("Lunch Menu › Drinks");
});

it("closes the new-section form, sending nothing, when another change takes its list off the menu before Save", async () => {
  const live = new LiveData();
  const client = api({ liveData: live });
  const el = await mountLunch(client);
  await editDrinks(el);
  await rowAction(el, "m-drinks", "new-section");
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
  const creating = deferred<SectionDetails>();
  const client = api({ liveData: live, createSectionIn: vi.fn(() => creating.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  await rowAction(el, "m-drinks", "new-section");
  type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Ciders");
  await el.updateComplete;
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(() => expect(client.createSectionIn).toHaveBeenCalledOnce());
  await takeDrinksOff(el, client, live);
  expect(modal(el, "new-section").open).toBe(true);
  expect(modal(el, "new-section").heading).toBe(
    t("menus.new_section_heading").replace("{list}", "Drinks"),
  );
  creating.reject({ code: "management.request_invalid" });
  await vi.waitFor(async () =>
    expect(await bottom(el, "new-section")).toBe(codeMessage("management.request_invalid")),
  );
  expect(modal(el, "new-section").open).toBe(true);
  expect(q(el, '[data-test="member-error"]')).toBeNull();
  expect(client.addSectionMember).not.toHaveBeenCalled();

  // Saved again, with its list gone, it closes and sends nothing.
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await new Promise((resolve) => setTimeout(resolve));
  expect(client.createSectionIn).toHaveBeenCalledOnce();
  expect(modal(el, "new-section").open).toBe(false);
  expect(text(q(el, '[data-test="member-error"]'))).toBe(
    t("menus.list_gone").replace("{name}", "Drinks"),
  );
});

it("says a created section was added to its list when that list left the menu while it was being created", async () => {
  const live = new LiveData();
  const creating = deferred<SectionDetails>();
  const client = api({ liveData: live, createSectionIn: vi.fn(() => creating.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  await rowAction(el, "m-drinks", "new-section");
  type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Ciders");
  await el.updateComplete;
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(() => expect(client.createSectionIn).toHaveBeenCalledOnce());
  await takeDrinksOff(el, client, live);
  creating.resolve({ ...sections()[3]!, id: "s-ciders", internalName: "Ciders" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      t("menus.list_gone_saved").replace("{name}", "Drinks"),
    ),
  );
  expect(client.createSectionIn).toHaveBeenCalledExactlyOnceWith("s-drinks", {
    internalName: "Ciders",
    names: {},
    image: null,
    color: null,
  });
  expect(client.addSectionMember).not.toHaveBeenCalled();
  expect(modal(el, "new-section").open).toBe(false);
});

it("shows no message when the person opens another list while a section is being created there and the save succeeds", async () => {
  const adding = deferred<SectionDetails>();
  const client = api({ createSectionIn: vi.fn(() => adding.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  await rowAction(el, "m-drinks", "new-section");
  type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Ciders");
  await el.updateComplete;
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(() => expect(client.createSectionIn).toHaveBeenCalledOnce());
  await toggleRow(el, "m-drinks");
  expect(currentPlace(el)).toBe("Lunch Menu");
  adding.resolve({ ...sections()[3]!, id: "s-new", internalName: "Ciders" });
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  expect(q(el, '[data-test="member-error"]')).toBeNull();
});

it("names the list a product removal takes a member out of, and offers section editing and deletion", async () => {
  const client = api();
  const el = await mountLunch(client);
  expect(text(inStructure(el, '[data-test="remove-m-burger"]'))).toBe(
    t("members.remove_from").replace("{list}", "Lunch Menu"),
  );
  await editDrinks(el);
  expect(text(inStructure(el, '[data-test="remove-m-drinks/m-lemonade"]'))).toBe(
    t("members.remove_from").replace("{list}", "Drinks"),
  );
  await settleStructure(el);
  const actions = inStructure(el, '[data-test="actions-m-drinks/m-beer"]')!;
  const labels = [...actions.querySelectorAll("wt-button")].map((button) => text(button));
  expect(labels).toEqual([
    t("menus.new_section"),
    t("menus.include_menu"),
    t("sections.add_products"),
    t("action.edit"),
    t("action.delete"),
  ]);
  await rowAction(el, "m-drinks/m-lemonade", "remove");
  await vi.waitFor(() =>
    expect(client.removeSectionMember).toHaveBeenCalledExactlyOnceWith("s-drinks", "m-lemonade"),
  );
  expect(client.deleteSection).not.toHaveBeenCalled();
});

it("edits section details and deletes its owned descendants while keeping included menus out of the count", async () => {
  const snapshot: MenuStructure = {
    rootSectionId: "root-lunch",
    root: {
      id: "root-lunch",
      internalName: "Lunch Menu",
      names: {},
      image: null,
      color: null,
      members: [],
    },
    nodes: lunchNodes(),
    includable: [],
    includedBy: [],
  };
  const client = api({ getMenuStructure: vi.fn().mockResolvedValue(snapshot) });
  const el = await mountLunch(client);
  await rowAction(el, "m-drinks", "edit");
  const form = q<HTMLElementTagNameMap["dashboard-section-details-form"]>(
    el,
    '[data-test="section-form"]',
  )!;
  expect(form.value?.internalName).toBe("Drinks");
  emit(form, "wt-submit", {
    internalName: "Drinks list",
    names: { en: "Refreshments", es: "Bebidas" },
    image: null,
    color: "#aa3300",
  });
  await vi.waitFor(() =>
    expect(client.updateSection).toHaveBeenCalledWith("s-drinks", {
      internalName: "Drinks list",
      names: { en: "Refreshments", es: "Bebidas" },
      image: null,
      color: "#aa3300",
    }),
  );
  await vi.waitFor(() => expect(form.open).toBe(false));
  const drinks = snapshot.nodes.find((node) => node.memberId === "m-drinks")!;
  drinks.children!.push({
    memberId: "included-other",
    ref: { kind: "section", sectionId: "wine-root" },
    internalName: "Wine menu",
    includedMenuId: "wine",
    children: [
      {
        memberId: "wine-owned",
        ref: { kind: "section", sectionId: "red-wines" },
        internalName: "Red wines",
        children: [],
      },
    ],
  });
  await rowAction(el, "m-drinks", "delete");
  expect(modal(el, "delete-section").textContent).toContain(
    t("menus.delete_section_one").replace("{name}", "Drinks"),
  );
  inModal(el, "delete-section", '[data-test="delete-section-save"]').click();
  await vi.waitFor(() => expect(client.deleteSection).toHaveBeenCalledWith("s-drinks"));
  expect(client.removeSectionMember).not.toHaveBeenCalled();
});

it("ArrowUp and ArrowDown reorder the list being edited, and focus stays on the moved row", async () => {
  const client = api();
  const el = await mountLunch(client);
  await pressReorder(el);
  const list = structureRows(el);
  const handle = () =>
    list.shadowRoot.querySelector<HTMLButtonElement>('[data-test="drag-m-burger"]')!;
  const order = () =>
    [...list.shadowRoot.querySelectorAll('tbody tr[aria-level="2"]')].map((row) =>
      row.getAttribute("data-row-key"),
    );
  handle().focus();
  handle().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await vi.waitFor(() =>
    expect(client.moveSectionMember).toHaveBeenCalledWith("root-lunch", "m-burger", 1),
  );
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-drinks", "m-burger", "m-fav"]));
  await el.updateComplete;
  await list.updateComplete;
  expect(order()).toEqual(["m-drinks", "m-burger", "m-fav"]);
  expect(list.shadowRoot!.activeElement).toBe(handle());

  handle().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  await vi.waitFor(() =>
    expect(client.moveSectionMember).toHaveBeenLastCalledWith("root-lunch", "m-burger", 0),
  );
  // The tree follows the order the server answered.
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-burger", "m-drinks", "m-fav"]));
  await el.updateComplete;
  await list.updateComplete;
  expect(order()).toEqual(["m-burger", "m-drinks", "m-fav"]);
  expect(list.shadowRoot!.activeElement).toBe(handle());
  expect(client.getMenuStructure).toHaveBeenCalledOnce();
});

it("shows the order the last of several queued moves answered", async () => {
  const client = api();
  const el = await mountLunch(client);
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-burger", to: 1 });
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-burger", to: 2 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-drinks", "m-fav", "m-burger"]));
  expect(client.getMenuStructure).toHaveBeenCalledOnce();
});

it("shows the order the last of several queued moves of different members answered, without reading the menu again", async () => {
  const client = api();
  const el = await mountLunch(client);
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-burger", to: 1 });
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-fav", to: 0 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-fav", "m-drinks", "m-burger"]));
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
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-burger", to: 1 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  // Another change's order reaches the screen before the move's answer does.
  const newer = lunchNodes().reverse();
  client.getMenuStructure.mockResolvedValue({
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
    nodes: newer,
  });
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-fav", "m-drinks", "m-burger"]));
  answer([
    sectionMember("m-drinks", 0, "s-drinks"),
    productMember("m-burger", 1, "p-burger"),
    sectionMember("m-fav", 2, "s-fav"),
  ]);
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  expect(topLevelKeys(el)).toEqual(["m-fav", "m-drinks", "m-burger"]);
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(3));
  await el.updateComplete;
  expect(topLevelKeys(el)).toEqual(["m-fav", "m-drinks", "m-burger"]);
});

it("reads the menu again when another change moves a different item past the moved one while the move is out", async () => {
  const live = new LiveData();
  const moving = deferred<SectionMember[]>();
  const client = api({ liveData: live, moveSectionMember: vi.fn(() => moving.promise) });
  const el = await mountLunch(client);
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-burger", to: 1 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  // Someone else's change: Favourites moved up past Burger, after our move reached the server.
  const [burger, drinks, fav] = lunchNodes();
  client.getMenuStructure.mockResolvedValue({
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
    nodes: [drinks!, fav!, burger!],
  });
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-drinks", "m-fav", "m-burger"]));
  moving.resolve([
    sectionMember("m-drinks", 0, "s-drinks"),
    productMember("m-burger", 1, "p-burger"),
    sectionMember("m-fav", 2, "s-fav"),
  ]);
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(3));
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  expect(topLevelKeys(el)).toEqual(["m-drinks", "m-fav", "m-burger"]);
});

it("takes a move's answer without reading the menu again when a read already showing that order lands first", async () => {
  const live = new LiveData();
  const moving = deferred<SectionMember[]>();
  const client = api({ liveData: live, moveSectionMember: vi.fn(() => moving.promise) });
  const el = await mountLunch(client);
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-burger", to: 1 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  const [burger, drinks, fav] = lunchNodes();
  client.getMenuStructure.mockResolvedValue({
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
    nodes: [drinks!, burger!, fav!],
  });
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-drinks", "m-burger", "m-fav"]));
  moving.resolve([
    sectionMember("m-drinks", 0, "s-drinks"),
    productMember("m-burger", 1, "p-burger"),
    sectionMember("m-fav", 2, "s-fav"),
  ]);
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  expect(client.getMenuStructure).toHaveBeenCalledTimes(2);
  expect(topLevelKeys(el)).toEqual(["m-drinks", "m-burger", "m-fav"]);
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
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-burger", to: 1 });
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-burger", to: 2 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledTimes(2));
  // The first move's update, read before the second move was made.
  const [burger, drinks, fav] = lunchNodes();
  client.getMenuStructure.mockResolvedValueOnce({
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
    nodes: [drinks!, burger!, fav!],
  });
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-drinks", "m-burger", "m-fav"]));
  second.resolve([
    sectionMember("m-drinks", 0, "s-drinks"),
    sectionMember("m-fav", 1, "s-fav"),
    productMember("m-burger", 2, "p-burger"),
  ]);
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-drinks", "m-fav", "m-burger"]));
  await new Promise((resolve) => setTimeout(resolve));
  expect(client.getMenuStructure).toHaveBeenCalledTimes(2);
});

it("reads the menu again when a later move is out and a read lands in the order an earlier, finished batch of moves answered", async () => {
  const live = new LiveData();
  const client = api({ liveData: live });
  const el = await mountLunch(client);
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-burger", to: 1 });
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-burger", to: 2 });
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-drinks", "m-fav", "m-burger"]));
  const third = deferred<SectionMember[]>();
  client.moveSectionMember.mockImplementationOnce(() => third.promise);
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-fav", to: 0 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledTimes(3));
  // Another change's read, in the order the first move answered.
  const [burger, drinks, fav] = lunchNodes();
  client.getMenuStructure.mockResolvedValue({
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
    nodes: [drinks!, burger!, fav!],
  });
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-drinks", "m-burger", "m-fav"]));
  third.resolve([
    sectionMember("m-fav", 0, "s-fav"),
    sectionMember("m-drinks", 1, "s-drinks"),
    productMember("m-burger", 2, "p-burger"),
  ]);
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(3));
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  expect(topLevelKeys(el)).toEqual(["m-drinks", "m-burger", "m-fav"]);
});

it("reads the menu again when a move made after a refusal is out and a read lands in the order a move before the refusal answered", async () => {
  const live = new LiveData();
  const client = api({ liveData: live });
  const move =
    client.moveSectionMember.getMockImplementation()! as DashboardApi["moveSectionMember"];
  const [burger, drinks, fav] = lunchNodes();
  client.moveSectionMember
    .mockImplementationOnce(move)
    .mockImplementationOnce(() => Promise.reject({ code: "menu_section.invalid" }));
  const el = await mountLunch(client);
  // What the menu reads after the refusal: another change's order.
  client.getMenuStructure.mockResolvedValueOnce({
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
    nodes: [fav!, drinks!, burger!],
  });
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-burger", to: 1 });
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-burger", to: 2 });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(codeMessage("menu_section.invalid")),
  );
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-fav", "m-drinks", "m-burger"]));
  const third = deferred<SectionMember[]>();
  client.moveSectionMember.mockImplementationOnce(() => third.promise);
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-burger", to: 0 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledTimes(3));
  // Another change's read, in the order the first move answered before the refusal.
  client.getMenuStructure.mockResolvedValue({
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
    nodes: [drinks!, burger!, fav!],
  });
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-drinks", "m-burger", "m-fav"]));
  third.resolve([
    productMember("m-burger", 0, "p-burger"),
    sectionMember("m-fav", 1, "s-fav"),
    sectionMember("m-drinks", 2, "s-drinks"),
  ]);
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(4));
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  expect(topLevelKeys(el)).toEqual(["m-drinks", "m-burger", "m-fav"]);
});

it("drops a move's answer that lands after the person has left the menu", async () => {
  const moving = deferred<SectionMember[]>();
  const client = api({ moveSectionMember: vi.fn(() => moving.promise) });
  const el = await mountLunch(client);
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-burger", to: 1 });
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
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-burger", to: 1 });
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-burger", to: 2 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  await click(el, "back");
  first.resolve([
    sectionMember("m-drinks", 0, "s-drinks"),
    productMember("m-burger", 1, "p-burger"),
    sectionMember("m-fav", 2, "s-fav"),
  ]);
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledTimes(2));
  await inTable(el, "open-menu-lunch");
  await vi.waitFor(() => expect(structure(el)).not.toBeNull());
  expect(client.getMenuStructure).toHaveBeenCalledTimes(2);
  second.resolve([
    sectionMember("m-drinks", 0, "s-drinks"),
    sectionMember("m-fav", 1, "s-fav"),
    productMember("m-burger", 2, "p-burger"),
  ]);
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(3));
});

it("a move reorders the owned section and keeps the other owned section unchanged, without reading the menu again", async () => {
  const nodes = lunchNodes();
  nodes.find((node) => node.memberId === "m-fav")!.children = [
    productNode("m-fav-lemonade", "p-lemonade"),
  ];
  const client = api({
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
      nodes,
      includable: [],
      includedBy: [],
    }),
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
  emit(structure(el), "wt-member-move", { path: ["m-drinks"], memberId: "m-beer", to: 2 });
  await vi.waitFor(() =>
    expect(childKeys(el, "m-drinks").map((key) => key.split("/").at(-1))).toEqual([
      "m-lager",
      "m-lemonade",
      "m-beer",
    ]),
  );
  expect(client.moveSectionMember).toHaveBeenCalledExactlyOnceWith("s-drinks", "m-beer", 2);
  await toggleRow(el, "m-fav");
  const inside = (path: string) => childKeys(el, path);
  expect(inside("m-drinks")).toEqual([
    "m-drinks/m-lager",
    "m-drinks/m-lemonade",
    "m-drinks/m-beer",
  ]);
  expect(inside("m-fav")).toEqual(["m-fav/m-fav-lemonade"]);
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
  emit(structure(el), "wt-member-move", { path: ["m-drinks"], memberId: "m-lager", to: 0 });
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(2));
});

it("explains a refused move, reads the menu again, and drops the moves queued behind it", async () => {
  let refuse!: (error: unknown) => void;
  const client = api();
  const move =
    client.moveSectionMember.getMockImplementation()! as DashboardApi["moveSectionMember"];
  client.moveSectionMember.mockImplementationOnce(
    () => new Promise((_, reject) => (refuse = reject)),
  );
  const el = await mountLunch(client);
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-burger", to: 1 });
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-burger", to: 2 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  refuse({ code: "menu_section.invalid" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(codeMessage("menu_section.invalid")),
  );
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(2));
  expect(client.moveSectionMember).toHaveBeenCalledOnce();
  // A move made after the refusal is sent.
  client.moveSectionMember.mockImplementation(move);
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-fav", to: 0 });
  await vi.waitFor(() =>
    expect(client.moveSectionMember).toHaveBeenLastCalledWith("root-lunch", "m-fav", 0),
  );
  expect(client.moveSectionMember.mock.calls).toEqual([
    ["root-lunch", "m-burger", 1],
    ["root-lunch", "m-fav", 0],
  ]);
});

it("adds products to a section, leaving out the section's own and marking this menu's", async () => {
  const client = api();
  const el = await mountLunch(client);
  await editDrinks(el);
  await rowAction(el, "m-drinks", "open-add-products");
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
  // What the section already holds is not offered at all.
  for (const held of ["p-lager", "p-lemonade"])
    expect(picker.shadowRoot!.querySelector(`li[data-product="${held}"]`)).toBeNull();
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
  await rowAction(el, "m-drinks", "open-add-products");
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
  await rowAction(el, "m-drinks", "open-add-products");
  const picker = inModal<SectionAddProducts>(el, "add-products", "dashboard-section-add-products");
  // A change that leaves Drinks in place keeps the picker open.
  client.getMenuStructure.mockResolvedValue({
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
    nodes: lunchNodes().reverse(),
  });
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-fav", "m-drinks", "m-burger"]));
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
  await rowAction(el, "m-drinks", "open-add-products");
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
  await rowAction(el, "m-drinks", "open-add-products");
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

it("hides no products from another list in a picker whose section left the menu while its add is out", async () => {
  const live = new LiveData();
  const adding = deferred<{ added: number }>();
  const client = api({ liveData: live, addSectionProducts: vi.fn(() => adding.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  await rowAction(el, "m-drinks", "open-add-products");
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
  await rowAction(el, "m-drinks", "open-add-products");
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
  await vi.waitFor(() => expect(structure(el)).not.toBeNull());
  await el.updateComplete;
}

const DINNER_PATH = "/manage/menus/menu/menu-dinner/view/structure";

it("closes an open window without a message when the person goes to another menu", async () => {
  const el = await mountLunch();
  await rowAction(el, "root", "new-section");
  expect(modal(el, "new-section").heading).toBe(
    t("menus.new_section_heading").replace("{list}", "Lunch Menu"),
  );
  await visit(el, DINNER_PATH, "Dinner Menu");
  expect(modal(el, "new-section").open).toBe(false);
  expect(q(el, '[data-test="member-error"]')).toBeNull();

  await rowAction(el, "root", "open-add-products");
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
      ? {
          rootSectionId: "root-dinner",
          root: {
            id: "root-dinner",
            internalName: "Dinner Menu",
            names: {},
            image: null,
            color: null,
            members: [],
          },
          includable: [],
          includedBy: [],
          nodes: [productNode("m-dinner-chips", "p-chips")],
        }
      : lunchStructure(id),
  );
  const el = await mountLunch(client);
  await editDrinks(el);
  await rowAction(el, "m-drinks", "open-add-products");
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
  await rowAction(el, "m-drinks", "open-add-products");
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
  const creating = deferred<SectionDetails>();
  const client = api({ createSectionIn: vi.fn(() => creating.promise) });
  const el = await mountLunch(client);
  await rowAction(el, "root", "new-section");
  type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Specials");
  await el.updateComplete;
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(() => expect(client.createSectionIn).toHaveBeenCalledOnce());
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
  await vi.waitFor(() => expect(structure(el)).not.toBeNull());
  await el.updateComplete;
  expect(modal(el, "new-section").open).toBe(false);
  expect(q(el, '[data-test="member-error"]')).toBeNull();
});

it("names the list on the menus list when a change to it is refused after the person pressed Back", async () => {
  const removing = deferred<void>();
  const client = api({ removeSectionMember: vi.fn(() => removing.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  await rowAction(el, "m-drinks/m-lemonade", "remove");
  await vi.waitFor(() => expect(client.removeSectionMember).toHaveBeenCalledOnce());
  await click(el, "back");
  expect(table(el)).not.toBeNull();
  removing.reject({ code: "menu_section.not_found" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      t("menus.change_not_saved")
        .replace("{name}", "Drinks")
        .replace("{reason}", codeMessage("menu_section.not_found")),
    ),
  );
});

it("names the list on the menus list when a move in it is refused after the person pressed Back", async () => {
  const moving = deferred<SectionMember[]>();
  const client = api({ moveSectionMember: vi.fn(() => moving.promise) });
  const el = await mountLunch(client);
  emit(structure(el), "wt-member-move", { path: [], memberId: "m-burger", to: 1 });
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
  const removing = deferred<void>();
  const client = api({ removeSectionMember: vi.fn(() => removing.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  await rowAction(el, "m-drinks/m-lemonade", "remove");
  await vi.waitFor(() => expect(client.removeSectionMember).toHaveBeenCalledOnce());
  await toggleRow(el, "m-drinks");
  expect(currentPlace(el)).toBe("Lunch Menu");
  removing.reject({ code: "menu_section.not_found" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      t("menus.change_not_saved")
        .replace("{name}", "Drinks")
        .replace("{reason}", codeMessage("menu_section.not_found")),
    ),
  );
});

it("names the list when a move in it is refused after the person went up to the menu's top level", async () => {
  const moving = deferred<SectionMember[]>();
  const client = api({ moveSectionMember: vi.fn(() => moving.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  emit(structure(el), "wt-member-move", { path: ["m-drinks"], memberId: "m-lager", to: 1 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  await toggleRow(el, "m-drinks");
  expect(currentPlace(el)).toBe("Lunch Menu");
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
  emit(structure(el), "wt-member-move", { path: ["m-drinks"], memberId: "m-lager", to: 1 });
  await vi.waitFor(() => expect(client.moveSectionMember).toHaveBeenCalledOnce());
  moving.reject({ code: "menu_section.invalid" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(codeMessage("menu_section.invalid")),
  );
  expect(structure(el)).not.toBeNull();
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
  await rowAction(el, "m-drinks", "open-add-products");
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

  reading.resolve({
    rootSectionId: "root-dinner",
    root: {
      id: "root-dinner",
      internalName: "Dinner Menu",
      names: {},
      image: null,
      color: null,
      members: [],
    },
    includable: [],
    includedBy: [],
    nodes: [],
  });
  await vi.waitFor(() => expect(structure(el)).not.toBeNull());
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
  const creating = deferred<SectionDetails>();
  const client = api({ createSectionIn: vi.fn(() => creating.promise) });
  const el = await mountLunch(client);
  await rowAction(el, "root", "new-section");
  type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Specials");
  await el.updateComplete;
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(() => expect(client.createSectionIn).toHaveBeenCalledOnce());
  await visit(el, DINNER_PATH, "Dinner Menu");
  creating.resolve({ ...sections()[3]!, id: "s-new", internalName: "Specials" });
  await vi.waitFor(() => expect(modal(el, "new-section").open).toBe(false));
  expect(client.createSectionIn).toHaveBeenCalledOnce();
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  expect(client.createSectionIn).toHaveBeenCalledWith("root-lunch", {
    internalName: "Specials",
    names: {},
    image: null,
    color: null,
  });
  expect(client.addSectionMember).not.toHaveBeenCalled();
  expect(q(el, '[data-test="member-error"]')).toBeNull();
});

it("keeps a picker whose add was refused open, and sends a second add, when the person is back on its menu before that menu's structure is read", async () => {
  const adding = deferred<{ added: number }>();
  const client = api({ addSectionProducts: vi.fn(() => adding.promise) });
  const el = await mountLunch(client);
  await editDrinks(el);
  await rowAction(el, "m-drinks", "open-add-products");
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
  reading.resolve({
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
    nodes: lunchNodes(),
  });
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
  await rowAction(el, "root", "open-add-products");
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
  await vi.waitFor(() => expect(structure(el)).not.toBeNull());
  await el.updateComplete;
  expect(q(el, '[data-test="member-error"]')).toBeNull();
});

it("shows a refused change beside the list", async () => {
  const client = api({
    removeSectionMember: vi.fn().mockRejectedValue({ code: "menu_section.not_found" }),
  });
  const el = await mountLunch(client);
  await rowAction(el, "m-burger", "remove");
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(codeMessage("menu_section.not_found")),
  );
  expect(q(el, '[data-test="structure-error"]')).toBeNull();
});

it("a change that saved but could not then be reloaded is a load failure, not a failed change", async () => {
  const client = api();
  const el = await mountLunch(client);
  client.getMenuStructure.mockRejectedValue(new Error("down"));
  emit(structure(el), "wt-member-remove", { path: [], memberId: "m-burger" });
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
  await vi.waitFor(() => expect(structure(el)).not.toBeNull());
  expect(q(el, '[data-test="structure-error"]')).toBeNull();
});

/** The staff name, the included menu's own customer names and the folder's fixed name all read
 * differently, so a dialog showing the wrong one fails. */
const WINE_NAMES = { en: "Wine list", es: "Carta de vinos" };

/** Lunch, with the Wines menu included at its top level; the fake keeps what a save sets. */
function winesClient(
  folder: IncludeFolder,
  overrides: Partial<Record<keyof DashboardApi, unknown>> = {},
) {
  const live = new LiveData();
  let stored = folder;
  let names: Record<string, string> = WINE_NAMES;
  const client = api({
    liveData: live,
    setIncludeFolder: vi.fn(async (_list: string, _member: string, input: IncludeFolderInput) => {
      stored = { showAsFolder: input.showAsFolder, overrides: input.overrides ?? {} };
      return stored;
    }),
    ...overrides,
  });
  const read = client.getMenuStructure.getMockImplementation()! as (
    id: string,
  ) => Promise<MenuStructure>;
  client.getMenuStructure.mockImplementation(async (id: string) => {
    const answer = await read(id);
    if (id !== "menu-lunch") return answer;
    const wines: MenuStructureNode = {
      memberId: "included-wine",
      ref: { kind: "section", sectionId: "wine-root" },
      internalName: "Wines",
      names: { ...names },
      image: null,
      color: "#112233",
      includedMenuId: "wine",
      ownerMenuId: "wine",
      folder: structuredClone(stored),
      children: [productNode("wine-chips", "p-chips")],
    };
    return { ...answer, nodes: [...answer.nodes, wines] };
  });
  return {
    client,
    live,
    rename(next: Record<string, string>) {
      names = next;
    },
  };
}

type IncludeForm = HTMLElementTagNameMap["dashboard-include-folder-form"];

function includeForm(el: MenusScreen): IncludeForm {
  return q<IncludeForm>(el, '[data-test="include-folder-form"]')!;
}
const includeModal = (el: MenusScreen) => includeForm(el).shadowRoot!.querySelector("wt-modal")!;

describe("the Structure tree", () => {
  /** Wines is another menu, included at Lunch's top level after Lunch's own members. */
  function wines(): MenuStructureNode {
    return {
      memberId: "included-wine",
      ref: { kind: "section", sectionId: "wine-root" },
      internalName: "Wines",
      includedMenuId: "wine",
      ownerMenuId: "wine",
      children: [
        {
          memberId: "wine-red",
          ref: { kind: "section", sectionId: "red-wines" },
          internalName: "Red wines",
          ownerMenuId: "wine",
          children: [productNode("wine-lager", "p-lager")],
        },
        productNode("wine-chips", "p-chips"),
      ],
    };
  }

  /** Lunch, with Wines among the menus it could include. */
  function includeClient(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}) {
    const client = api(overrides);
    const read = client.getMenuStructure.getMockImplementation()! as (
      id: string,
    ) => Promise<MenuStructure>;
    client.getMenuStructure.mockImplementation(async (id: string) => ({
      ...(await read(id)),
      includable: [{ id: "wine", name: "Wines", rootSectionId: "wine-root" }],
    }));
    return client;
  }

  const NEW_SECTION = { internalName: "Ciders", names: {}, image: null, color: null };

  /** The Drinks shown inside Favourites is the same list as the Drinks at the top level. */
  const places = [
    { key: "m-fav/m-fav-drinks", open: ["m-fav"], list: "s-drinks", name: "Drinks" },
    { key: "m-fav", open: [], list: "s-fav", name: "Favourites" },
    { key: "root", open: [], list: "root-lunch", name: "Lunch Menu" },
  ];

  it.each(places)(
    "adds products to the list of the row they are chosen from: $key",
    async (row) => {
      const client = api();
      const el = await mountLunch(client);
      for (const key of row.open) await toggleRow(el, key);
      await rowAction(el, row.key, "open-add-products");
      expect(modal(el, "add-products").heading).toBe(
        t("sections.add_products_heading").replace("{name}", row.name),
      );
      const picker = inModal<SectionAddProducts>(
        el,
        "add-products",
        "dashboard-section-add-products",
      );
      // What that list already holds is left out of the offer.
      const held: Record<string, string[]> = {
        "s-drinks": ["p-lager", "p-lemonade"],
        "s-fav": ["p-lemonade"],
        "root-lunch": ["p-burger"],
      };
      expect([...picker.inSection].sort()).toEqual(held[row.list]);
      emit(picker, "wt-add-products", { productIds: ["p-chips"] });
      await vi.waitFor(() =>
        expect(client.addSectionProducts).toHaveBeenCalledExactlyOnceWith(row.list, ["p-chips"]),
      );
    },
  );

  it.each(places)(
    "creates a section in the list of the row it is chosen from: $key",
    async (row) => {
      const client = api();
      const el = await mountLunch(client);
      for (const key of row.open) await toggleRow(el, key);
      await rowAction(el, row.key, "new-section");
      expect(modal(el, "new-section").heading).toBe(
        t("menus.new_section_heading").replace("{list}", row.name),
      );
      emit(q(el, '[data-test="section-form"]')!, "wt-submit", NEW_SECTION);
      await vi.waitFor(() =>
        expect(client.createSectionIn).toHaveBeenCalledExactlyOnceWith(row.list, NEW_SECTION),
      );
    },
  );

  it.each(places)("includes a menu in the list of the row it is chosen from: $key", async (row) => {
    const client = includeClient();
    const el = await mountLunch(client);
    for (const key of row.open) await toggleRow(el, key);
    await rowAction(el, row.key, "include-menu");
    await chooseOption(inModal(el, "include", '[name="included-menu"]'), "wine-root");
    await vi.waitFor(() =>
      expect(client.addSectionMember).toHaveBeenCalledExactlyOnceWith(row.list, {
        kind: "section",
        sectionId: "wine-root",
      }),
    );
  });

  it("makes the row an add is chosen from current, leaves a refusal in that list unnamed, and names a refused move in another", async () => {
    const moving = deferred<SectionMember[]>();
    const client = api({
      removeSectionMember: vi.fn().mockRejectedValue({ code: "menu_section.not_found" }),
      moveSectionMember: vi.fn(() => moving.promise),
    });
    const el = await mountLunch(client);
    expect(currentPlace(el)).toBe("Lunch Menu");
    await rowAction(el, "m-fav", "open-add-products");
    expect(currentPlace(el)).toBe("Lunch Menu › Favourites");
    inModal(el, "add-products", '[data-test="add-products-cancel"]').click();
    await vi.waitFor(() => expect(modal(el, "add-products").open).toBe(false));

    await rowAction(el, "m-fav/m-fav-lemonade", "remove");
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="member-error"]'))).toBe(codeMessage("menu_section.not_found")),
    );
    expect(client.removeSectionMember).toHaveBeenCalledExactlyOnceWith("s-fav", "m-fav-lemonade");

    await settleStructure(el);
    await pressReorder(el);
    const grip = inStructure<HTMLButtonElement>(el, '[data-test="drag-m-burger"]')!;
    grip.focus();
    grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await vi.waitFor(() =>
      expect(client.moveSectionMember).toHaveBeenCalledExactlyOnceWith("root-lunch", "m-burger", 1),
    );
    moving.reject({ code: "menu_section.invalid" });
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="member-error"]'))).toBe(
        t("menus.change_not_saved")
          .replace("{name}", "Lunch Menu")
          .replace("{reason}", codeMessage("menu_section.invalid")),
      ),
    );
  });

  it("moves a member inside Drinks and shows the answer in both places Drinks appears, without reading the menu again", async () => {
    // An answer unlike the move itself, so the order shown is the answer's, not the tree's own.
    const client = api({
      moveSectionMember: vi
        .fn()
        .mockResolvedValue([
          productMember("m-lemonade", 0, "p-lemonade"),
          sectionMember("m-beer", 1, "s-beer"),
          productMember("m-lager", 2, "p-lager"),
        ]),
    });
    const el = await mountLunch(client);
    await toggleRow(el, "m-drinks");
    await toggleRow(el, "m-fav");
    await toggleRow(el, "m-fav/m-fav-drinks");
    await pressReorder(el);
    const grip = inStructure<HTMLButtonElement>(el, '[data-test="drag-m-drinks/m-lager"]')!;
    grip.focus();
    grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await vi.waitFor(() =>
      expect(client.moveSectionMember).toHaveBeenCalledExactlyOnceWith("s-drinks", "m-lager", 1),
    );
    await vi.waitFor(() =>
      expect(childKeys(el, "m-drinks")).toEqual([
        "m-drinks/m-lemonade",
        "m-drinks/m-beer",
        "m-drinks/m-lager",
      ]),
    );
    expect(childKeys(el, "m-fav/m-fav-drinks")).toEqual([
      "m-fav/m-fav-drinks/m-lemonade",
      "m-fav/m-fav-drinks/m-beer",
      "m-fav/m-fav-drinks/m-lager",
    ]);
    expect(client.getMenuStructure).toHaveBeenCalledOnce();
  });

  it("removes a member from the list holding it, though another list is current", async () => {
    const client = api();
    const el = await mountLunch(client);
    await toggleRow(el, "m-drinks");
    await toggleRow(el, "m-fav");
    expect(currentPlace(el)).toBe("Lunch Menu › Favourites");
    await rowAction(el, "m-drinks/m-lemonade", "remove");
    await vi.waitFor(() =>
      expect(client.removeSectionMember).toHaveBeenCalledExactlyOnceWith("s-drinks", "m-lemonade"),
    );
  });

  describe("Reorder mode", () => {
    beforeEach(() => {
      const before = currentLocale();
      setLocale("en");
      onTestFinished(() => setLocale(before));
    });

    const grips = (el: MenusScreen) => allInStructure(el, '[data-test^="drag-"]');

    it("starts with no grip on any row and the Reorder toggle not pressed", async () => {
      const el = await mountLunch();
      await toggleRow(el, "m-drinks");
      expect(grips(el)).toEqual([]);
      expect(reorderToggle(el).getAttribute("aria-pressed")).toBe("false");
      expect(q(el, '[data-test="reorder-done"]')).toBeNull();
    });

    it("offers Reorder as an icon button with a tooltip; pressed, every owned row has a grip, and an arrow on one moves it", async () => {
      const client = api();
      const el = await mountLunch(client);
      await toggleRow(el, "m-drinks");
      const toggle = reorderToggle(el);
      expect(toggle.localName).toBe("button");
      expect(toggle.getAttribute("type")).toBe("button");
      expect(toggle.getAttribute("slot")).toBe("toolbar-start");
      expect(toggle.getAttribute("aria-label")).toBe("Reorder");
      const tooltip = toggle.querySelector<HTMLElement>(".icon-tooltip")!;
      expect(tooltip.textContent!.trim()).toBe("Reorder");
      expect(tooltip.getAttribute("aria-hidden")).toBe("true");
      // The shared icon-button look, so the styles reached this screen: a native button's border
      // is 2px outset, and an unstyled tooltip is always shown.
      expect(getComputedStyle(toggle).borderTopStyle).toBe("solid");
      expect(getComputedStyle(toggle).borderTopWidth).toBe("1px");
      expect(getComputedStyle(tooltip).display).toBe("none");
      expect(toggle.assignedSlot).not.toBeNull();
      expect(toggle.getBoundingClientRect().width).toBeGreaterThan(0);

      await pressReorder(el);
      expect(toggle.getAttribute("aria-pressed")).toBe("true");
      const owned = allInStructure(el, 'tbody tr[data-row-key^="m-"]');
      expect(owned.map((tr) => tr.dataset.rowKey)).toEqual([
        "m-burger",
        "m-drinks",
        "m-drinks/m-lager",
        "m-drinks/m-beer",
        "m-drinks/m-lemonade",
        "m-fav",
      ]);
      for (const tr of owned)
        expect(tr.querySelector('[part~="drag-grip"]'), tr.dataset.rowKey).not.toBeNull();

      const handle = inStructure<HTMLButtonElement>(el, '[data-test="drag-m-burger"]')!;
      handle.focus();
      await userEvent.keyboard("{ArrowDown}");
      await vi.waitFor(() =>
        expect(client.moveSectionMember).toHaveBeenCalledWith("root-lunch", "m-burger", 1),
      );
      await settleStructure(el);
      expect(structureRows(el).shadowRoot.activeElement).toBe(
        inStructure(el, '[data-test="drag-m-burger"]'),
      );
    });

    it("names Reorder in Spanish", async () => {
      setLocale("es");
      const el = await mountLunch();
      expect(reorderToggle(el).getAttribute("aria-label")).toBe("Reordenar");
      expect(reorderToggle(el).querySelector(".icon-tooltip")!.textContent!.trim()).toBe(
        "Reordenar",
      );
      await pressReorder(el);
      expect(text(q(el, '[data-test="reorder-done"]'))).toBe("Listo");
    });

    it("leaves the mode by Done, handing focus back to the toggle, and by a second press", async () => {
      const el = await mountLunch();
      await pressReorder(el);
      const done = q(el, '[data-test="reorder-done"]')!;
      expect(done.localName).toBe("wt-button");
      expect(done.getAttribute("slot")).toBe("toolbar-end");
      expect(done.assignedSlot).not.toBeNull();
      expect(done.getBoundingClientRect().width).toBeGreaterThan(0);
      expect(text(done)).toBe("Done");
      expect(grips(el).length).toBeGreaterThan(0);
      done.focus();
      await userEvent.keyboard("{Enter}");
      await settleStructure(el);
      expect(grips(el)).toEqual([]);
      expect(q(el, '[data-test="reorder-done"]')).toBeNull();
      expect(reorderToggle(el).getAttribute("aria-pressed")).toBe("false");
      expect(el.shadowRoot!.activeElement).toBe(reorderToggle(el));

      await pressReorder(el);
      expect(grips(el).length).toBeGreaterThan(0);
      await pressReorder(el);
      expect(grips(el)).toEqual([]);
      expect(q(el, '[data-test="reorder-done"]')).toBeNull();
    });

    it("turns the mode off when another menu is opened", async () => {
      const el = await mountLunch();
      await pressReorder(el);
      expect(structure(el).reordering).toBe(true);
      history.pushState(null, "", DINNER_PATH);
      window.dispatchEvent(new PopStateEvent("popstate"));
      await vi.waitFor(() => expect(text(q(el, "h1"))).toBe("Dinner Menu"));
      await vi.waitFor(() => expect(structure(el)).not.toBeNull());
      await settleStructure(el);
      expect(structure(el).reordering).toBe(false);
      expect(reorderToggle(el).getAttribute("aria-pressed")).toBe("false");
      expect(q(el, '[data-test="reorder-done"]')).toBeNull();
    });
  });

  describe("an included menu", () => {
    async function mountWithWines(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}) {
      const client = includeClient({
        getMenuStructure: vi.fn().mockResolvedValue(lunchWith([...lunchNodes(), wines()])),
        ...overrides,
      });
      return { client, el: await mountLunch(client) };
    }

    it("opens for browsing, and offers no ⋮ or grip on anything inside it", async () => {
      const { el } = await mountWithWines();
      await pressReorder(el);
      await toggleRow(el, "included-wine");
      expect(childKeys(el, "included-wine")).toEqual([
        "included-wine/wine-red",
        "included-wine/wine-chips",
      ]);
      await toggleRow(el, "included-wine/wine-red");
      expect(childKeys(el, "included-wine/wine-red")).toEqual([
        "included-wine/wine-red/wine-lager",
      ]);
      expect(currentPlace(el)).toBe("Lunch Menu");
      for (const key of [
        "included-wine/wine-red",
        "included-wine/wine-chips",
        "included-wine/wine-red/wine-lager",
      ]) {
        expect(rowOf(el, key)!.querySelector("wt-row-actions"), key).toBeNull();
        expect(rowOf(el, key)!.querySelector('[part~="drag-grip"]'), key).toBeNull();
      }
    });

    it("removes the inclusion from this menu alone, and links to the included menu's own Structure tab", async () => {
      const { client, el } = await mountWithWines();
      expect(inStructure(el, '[data-test="source-included-wine"]')!.getAttribute("href")).toBe(
        "/manage/menus/menu/wine/view/structure",
      );
      await rowAction(el, "included-wine", "remove");
      await vi.waitFor(() =>
        expect(client.removeSectionMember).toHaveBeenCalledExactlyOnceWith(
          "root-lunch",
          "included-wine",
        ),
      );
      await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(2));
      expect(writeCalls(client)).toEqual(["removeSectionMember"]);
    });

    it("keeps a refused inclusion in the include window", async () => {
      const { client, el } = await mountWithWines({
        addSectionMember: vi.fn().mockRejectedValue({ code: "menu_section.member_cycle" }),
      });
      await rowAction(el, "root", "include-menu");
      await chooseOption(inModal(el, "include", '[name="included-menu"]'), "wine-root");
      await vi.waitFor(async () =>
        expect(await bottom(el, "include")).toBe(codeMessage("menu_section.member_cycle")),
      );
      expect(modal(el, "include").open).toBe(true);
      expect(q(el, '[data-test="member-error"]')).toBeNull();
      expect(client.addSectionMember).toHaveBeenCalledOnce();
    });
  });

  /** The ⋮ that has focus in the tree's table, as its row's key. */
  function focusedRowMenu(el: MenusScreen): string | undefined {
    const focused = structureRows(el).shadowRoot.activeElement;
    return focused?.localName === "wt-row-actions"
      ? focused.closest("tr")?.dataset.rowKey
      : `not a row menu: ${focused?.localName ?? "nothing"}`;
  }

  async function closeSectionForm(el: MenusScreen): Promise<void> {
    inModal(el, "new-section", '[data-test="new-section-cancel"]').click();
    await vi.waitFor(() => expect(modal(el, "new-section").open).toBe(false));
  }

  const windows: {
    name: string;
    client?: () => Api;
    open: (el: MenusScreen) => Promise<void>;
    close: (el: MenusScreen, client: Api) => Promise<void>;
    focused: string;
  }[] = [
    {
      name: "New section here, cancelled",
      open: (el) => rowAction(el, "m-drinks", "new-section"),
      close: closeSectionForm,
      focused: "m-drinks",
    },
    {
      name: "New section here, saved",
      open: (el) => rowAction(el, "m-drinks", "new-section"),
      close: async (el, client) => {
        type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Ciders");
        await el.updateComplete;
        inModal(el, "new-section", '[data-test="new-section-save"]').click();
        await vi.waitFor(() => expect(modal(el, "new-section").open).toBe(false));
        await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(2));
      },
      focused: "m-drinks",
    },
    {
      name: "New section here, refused and then cancelled",
      client: () =>
        api({ createSectionIn: vi.fn().mockRejectedValue({ code: "menu_section.invalid" }) }),
      open: (el) => rowAction(el, "m-drinks", "new-section"),
      close: async (el) => {
        type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Ciders");
        await el.updateComplete;
        inModal(el, "new-section", '[data-test="new-section-save"]').click();
        await vi.waitFor(async () =>
          expect(await bottom(el, "new-section")).toBe(codeMessage("menu_section.invalid")),
        );
        await closeSectionForm(el);
      },
      focused: "m-drinks",
    },
    {
      name: "Add products, cancelled",
      open: (el) => rowAction(el, "m-fav", "open-add-products"),
      close: async (el) => {
        inModal(el, "add-products", '[data-test="add-products-cancel"]').click();
        await vi.waitFor(() => expect(modal(el, "add-products").open).toBe(false));
      },
      focused: "m-fav",
    },
    {
      name: "Add products, saved",
      open: (el) => rowAction(el, "m-fav", "open-add-products"),
      close: async (el, client) => {
        emit(inModal(el, "add-products", "dashboard-section-add-products"), "wt-add-products", {
          productIds: ["p-chips"],
        });
        await vi.waitFor(() => expect(modal(el, "add-products").open).toBe(false));
        await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(2));
      },
      focused: "m-fav",
    },
    {
      name: "Include a menu, cancelled",
      open: (el) => rowAction(el, "root", "include-menu"),
      close: async (el) => {
        await click(el, "include-cancel");
        await vi.waitFor(() => expect(modal(el, "include").open).toBe(false));
      },
      focused: "root",
    },
    {
      name: "Edit, cancelled",
      open: (el) => rowAction(el, "m-drinks", "edit"),
      close: closeSectionForm,
      focused: "m-drinks",
    },
    {
      name: "Include Edit, cancelled",
      client: () => winesClient({ showAsFolder: true, overrides: {} }).client,
      open: async (el) => {
        await rowAction(el, "included-wine", "edit");
        await vi.waitFor(() => expect(includeModal(el).open).toBe(true));
      },
      close: async (el) => {
        includeForm(el).shadowRoot!.querySelector<HTMLElement>('[data-test="cancel"]')!.click();
        await vi.waitFor(() => expect(includeModal(el).open).toBe(false));
      },
      focused: "included-wine",
    },
    {
      name: "Include Edit, saved, and read back without the include",
      client: () => winesClient({ showAsFolder: true, overrides: {} }).client,
      open: async (el) => {
        await rowAction(el, "included-wine", "edit");
        await vi.waitFor(() => expect(includeModal(el).open).toBe(true));
      },
      close: async (el, client) => {
        // Someone else took the include out meanwhile, so the dialog's own focus return has no ⋮.
        const read = client.getMenuStructure.getMockImplementation()! as (
          id: string,
        ) => Promise<MenuStructure>;
        client.getMenuStructure.mockImplementationOnce(async (id: string) => {
          const answer = await read(id);
          return {
            ...answer,
            nodes: answer.nodes.filter((node) => node.memberId !== "included-wine"),
          };
        });
        emit(
          includeForm(el).shadowRoot!.querySelector('wt-switch[name="show-as-folder"]')!,
          "wt-change",
          { checked: false },
        );
        await includeForm(el).updateComplete;
        includeForm(el).shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
        await vi.waitFor(() => expect(includeModal(el).open).toBe(false));
        await vi.waitFor(() => expect(topLevelKeys(el)).not.toContain("included-wine"));
      },
      focused: "root",
    },
    {
      name: "Delete, confirmed",
      client: () => {
        const client = api();
        const noBeer = lunchNodes().map((node) =>
          node.memberId === "m-fav"
            ? node
            : {
                ...node,
                children: node.children?.filter((child) => child.memberId !== "m-beer"),
              },
        );
        client.deleteSection.mockImplementation(async () => {
          client.getMenuStructure.mockResolvedValue(lunchWith(noBeer));
        });
        return client;
      },
      open: async (el) => {
        await toggleRow(el, "m-drinks");
        await rowAction(el, "m-drinks/m-beer", "delete");
      },
      close: async (el, client) => {
        inModal(el, "delete-section", '[data-test="delete-section-save"]').click();
        await vi.waitFor(() => expect(modal(el, "delete-section").open).toBe(false));
        await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(2));
      },
      // Beer's row is gone, so the nearest row still drawn is Drinks.
      focused: "m-drinks",
    },
  ];

  it.each(windows)("hands focus back to the ⋮ a window was opened from: $name", async (each) => {
    const client = each.client?.() ?? api();
    const el = await mountLunch(client);
    await each.open(el);
    await each.close(el, client);
    await afterDialogCloses(el);
    await settleStructure(el);
    expect(focusedRowMenu(el)).toBe(each.focused);
  });

  it("hands focus back only once the menu is read again after the save, so it lands on the row's own ⋮", async () => {
    const reading = deferred<MenuStructure>();
    const client = api();
    const el = await mountLunch(client);
    await rowAction(el, "m-fav", "open-add-products");
    // The read after the save is held, and then answers with a product added above Favourites,
    // which redraws every row from there down.
    client.getMenuStructure.mockImplementationOnce(() => reading.promise);
    emit(inModal(el, "add-products", "dashboard-section-add-products"), "wt-add-products", {
      productIds: ["p-chips"],
    });
    await vi.waitFor(() => expect(modal(el, "add-products").open).toBe(false));
    await afterDialogCloses(el);
    reading.resolve(lunchWith([productNode("m-new-chips", "p-chips"), ...lunchNodes()]));
    await vi.waitFor(() =>
      expect(topLevelKeys(el)).toEqual(["m-new-chips", "m-burger", "m-drinks", "m-fav"]),
    );
    await afterDialogCloses(el);
    await settleStructure(el);
    expect(focusedRowMenu(el)).toBe("m-fav");
  });

  it("hands focus back from a second window, opened after the first one closed", async () => {
    const el = await mountLunch();
    await rowAction(el, "m-fav", "open-add-products");
    inModal(el, "add-products", '[data-test="add-products-cancel"]').click();
    await vi.waitFor(() => expect(modal(el, "add-products").open).toBe(false));
    await afterDialogCloses(el);
    await settleStructure(el);
    expect(focusedRowMenu(el)).toBe("m-fav");
    await rowAction(el, "m-drinks", "new-section");
    await afterDialogCloses(el);
    await settleStructure(el);
    await closeSectionForm(el);
    await afterDialogCloses(el);
    await settleStructure(el);
    expect(focusedRowMenu(el)).toBe("m-drinks");
  });

  it("hands focus to the holding section's ⋮ after a removal", async () => {
    const client = api();
    const el = await mountLunch(client);
    await toggleRow(el, "m-drinks");
    await rowAction(el, "m-drinks/m-lemonade", "remove");
    await vi.waitFor(() =>
      expect(client.removeSectionMember).toHaveBeenCalledExactlyOnceWith("s-drinks", "m-lemonade"),
    );
    await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(2));
    await settleStructure(el);
    await vi.waitFor(() => expect(focusedRowMenu(el)).toBe("m-drinks"));
  });

  it("hands focus to the nearest row still drawn when a window closes because its list left", async () => {
    const live = new LiveData();
    const client = api({ liveData: live });
    const el = await mountLunch(client);
    await toggleRow(el, "m-drinks");
    await rowAction(el, "m-drinks/m-beer", "open-add-products");
    // Another change takes Beer out of Drinks.
    const nodes = lunchNodes();
    nodes[1]!.children = nodes[1]!.children!.filter((node) => node.memberId !== "m-beer");
    client.getMenuStructure.mockResolvedValue(lunchWith(nodes));
    live.invalidate([{ type: "section_members" }]);
    await vi.waitFor(() => expect(modal(el, "add-products").open).toBe(false));
    await afterDialogCloses(el);
    await settleStructure(el);
    expect(focusedRowMenu(el)).toBe("m-drinks");
  });

  it("returns no focus to a menu the person has since left", async () => {
    const el = await mountLunch();
    await rowAction(el, "root", "include-menu");
    await visit(el, DINNER_PATH, "Dinner Menu");
    await afterDialogCloses(el);
    await settleStructure(el);
    expect(focusedRowMenu(el)).not.toBe("root");
  });

  it.each(["an add", "a removal"] as const)(
    "disables every ⋮ action and grip while %s is out",
    async (write) => {
      const held = deferred<unknown>();
      const client = api({
        addSectionProducts: vi.fn(() => held.promise),
        removeSectionMember: vi.fn(() => held.promise),
      });
      const el = await mountLunch(client);
      await pressReorder(el);
      await toggleRow(el, "m-drinks");
      if (write === "an add") {
        await rowAction(el, "m-drinks", "open-add-products");
        emit(inModal(el, "add-products", "dashboard-section-add-products"), "wt-add-products", {
          productIds: ["p-chips"],
        });
      } else await rowAction(el, "m-drinks/m-lemonade", "remove");
      await settleStructure(el);
      const controls = () => [
        ...allInStructure<HTMLButtonElement>(el, '[part~="drag-grip"]'),
        ...allInStructure<HTMLElementTagNameMap["wt-button"]>(el, "wt-row-actions wt-button"),
      ];
      expect(controls().length).toBeGreaterThan(10);
      for (const control of controls()) expect(control.disabled).toBe(true);
      held.resolve({ added: 1 });
      await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(2));
      await settleStructure(el);
      for (const control of controls()) expect(control.disabled).toBe(false);
    },
  );

  it("puts nothing beside the tabs", async () => {
    const el = await mountLunch();
    await settleStructure(el);
    const tabs = q(el, 'wt-tabs[data-test="menu-tabs"]')!;
    expect(tabs.querySelector('[slot="actions"]')).toBeNull();
  });

  it("fits a phone: the tab does not scroll sideways and every row's ⋮ is on screen (390 px)", async () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    await page.viewport(390, 844);
    onTestFinished(() => page.viewport(width, height));
    const el = await mountLunch();
    await vi.waitFor(() => expect(rowOf(el, "home")).not.toBeNull());
    await toggleRow(el, "m-drinks");
    await toggleRow(el, "m-drinks/m-beer");
    expect(window.innerWidth).toBe(390);
    expect(document.scrollingElement!.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    const menus = allInStructure(el, 'wt-row-actions[data-test^="actions-"]');
    expect(menus.map((menu) => menu.closest("tr")!.dataset.rowKey)).toEqual([
      "home",
      "root",
      "m-burger",
      "m-drinks",
      "m-drinks/m-lager",
      "m-drinks/m-beer",
      "m-drinks/m-beer/m-lager-2",
      "m-drinks/m-lemonade",
      "m-fav",
    ]);
    for (const menu of menus) {
      const key = menu.closest("tr")!.dataset.rowKey!;
      const button = menu.shadowRoot!.querySelector("button")!;
      window.scrollTo(0, button.getBoundingClientRect().top + window.scrollY - 100);
      const at = button.getBoundingClientRect();
      expect(at.left, key).toBeGreaterThanOrEqual(0);
      expect(at.right, key).toBeLessThanOrEqual(window.innerWidth);
      const hit = menu.shadowRoot!.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2);
      expect(hit !== null && button.contains(hit), `${key} is covered`).toBe(true);
    }
  });

  it("fits a phone with the Device Home Page row and Drinks › Beer open: every row's ⋮ is on screen and nothing scrolls sideways (390 px)", async () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    await page.viewport(390, 844);
    onTestFinished(() => page.viewport(width, height));
    const el = await mountLunch();
    await vi.waitFor(() => expect(rowOf(el, "home")).not.toBeNull());
    await toggleRow(el, "home");
    await toggleRow(el, "m-drinks");
    await toggleRow(el, "m-drinks/m-beer");
    expect(window.innerWidth).toBe(390);
    expect(document.scrollingElement!.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    const menus = allInStructure(el, 'wt-row-actions[data-test^="actions-"]');
    expect(menus.map((menu) => menu.closest("tr")!.dataset.rowKey)).toEqual([
      "home",
      "home/t-burger",
      "home/t-drinks",
      "home/t-chips",
      "root",
      "m-burger",
      "m-drinks",
      "m-drinks/m-lager",
      "m-drinks/m-beer",
      "m-drinks/m-beer/m-lager-2",
      "m-drinks/m-lemonade",
      "m-fav",
    ]);
    for (const menu of menus) {
      const key = menu.closest("tr")!.dataset.rowKey!;
      const button = menu.shadowRoot!.querySelector("button")!;
      window.scrollTo(0, button.getBoundingClientRect().top + window.scrollY - 100);
      const at = button.getBoundingClientRect();
      expect(at.left, key).toBeGreaterThanOrEqual(0);
      expect(at.right, key).toBeLessThanOrEqual(window.innerWidth);
      const hit = menu.shadowRoot!.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2);
      expect(hit !== null && button.contains(hit), `${key} is covered`).toBe(true);
    }
  });

  it.each(["en-GB", "es-ES"])(
    "at 390 px a product row's ⋮ shows Edit product wholly on screen, and choosing it asks for that product's editor (%s)",
    async (locale) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const before = currentLocale();
      setLocale(locale);
      onTestFinished(() => setLocale(before));
      await page.viewport(390, 844);
      onTestFinished(() => page.viewport(width, height));
      const el = await mountLunch();
      await settleStructure(el);
      expect(window.innerWidth).toBe(390);
      expect(document.scrollingElement!.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      const menu = inStructure<HTMLElementTagNameMap["wt-row-actions"]>(
        el,
        '[data-test="actions-m-burger"]',
      )!;
      menu.scrollIntoView({ block: "center" });
      menu.show();
      await vi.waitFor(() =>
        expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true),
      );
      const link = inStructure<HTMLAnchorElement>(el, '[data-test="edit-product-m-burger"]')!;
      expect(link.textContent!.trim()).toBe(t("product.edit"));
      expect(link.getAttribute("href")).toBe("/manage/catalogue/product/p-burger");
      await vi.waitFor(() => {
        const at = link.getBoundingClientRect();
        expect(at.width).toBeGreaterThan(0);
        expect(at.left).toBeGreaterThanOrEqual(0);
        expect(at.right).toBeLessThanOrEqual(window.innerWidth);
        expect(at.top).toBeGreaterThanOrEqual(0);
        expect(at.bottom).toBeLessThanOrEqual(window.innerHeight);
      });
      const at = link.getBoundingClientRect();
      // The point lands in the screen's shadow trees, so walk the hit back to the link.
      const deepest = (root: Document | ShadowRoot, x: number, y: number): Element | null => {
        const found = root.elementFromPoint(x, y);
        if (found?.shadowRoot && found.shadowRoot !== root) {
          const inner = deepest(found.shadowRoot, x, y);
          if (inner && inner !== found) return inner;
        }
        return found;
      };
      const target = deepest(document, at.x + at.width / 2, at.y + at.height / 2);
      expect(target !== null && link.contains(target), "Edit product is covered").toBe(true);
      expect(document.scrollingElement!.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

      const heard: unknown[] = [];
      const listen = (event: Event) => heard.push((event as CustomEvent).detail);
      document.addEventListener("wt-edit-product", listen);
      onTestFinished(() => document.removeEventListener("wt-edit-product", listen));
      link.click();
      expect(heard).toEqual([{ productId: "p-burger" }]);
    },
  );

  it("keeps the open sections and the current one through a refresh that leaves them in place", async () => {
    const live = new LiveData();
    const client = api({ liveData: live });
    const el = await mountLunch(client);
    await toggleRow(el, "m-drinks");
    await toggleRow(el, "m-drinks/m-beer");
    expect(currentPlace(el)).toBe("Lunch Menu › Drinks › Beer");
    client.getMenuStructure.mockResolvedValue(lunchWith(lunchNodes().slice(1)));
    live.invalidate([{ type: "section_members" }]);
    await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-drinks", "m-fav"]));
    await settleStructure(el);
    expect(client.getMenuStructure).toHaveBeenCalledTimes(2);
    expect(rowOf(el, "m-drinks")!.getAttribute("aria-expanded")).toBe("true");
    expect(rowOf(el, "m-drinks/m-beer")!.getAttribute("aria-expanded")).toBe("true");
    expect(
      rowOf(el, "m-drinks/m-beer")!
        .querySelector('[data-test="name"]')!
        .getAttribute("aria-current"),
    ).toBe("true");
  });
});

describe("an include's Edit dialog", () => {
  const includeField = (el: MenusScreen, name: string) =>
    includeForm(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      `wt-input[name="${name}"]`,
    )!;
  const includeSave = (el: MenusScreen) =>
    includeForm(el).shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!;

  async function openWines(el: MenusScreen): Promise<void> {
    await rowAction(el, "included-wine", "edit");
    await vi.waitFor(() => expect(includeModal(el).open).toBe(true));
    await includeForm(el).updateComplete;
  }

  it("opens from the include's menu with the folder's values", async () => {
    const { client } = winesClient({
      showAsFolder: true,
      overrides: { names: { en: "Our wines" } },
    });
    const el = await mountLunch(client);
    await openWines(el);
    expect(includeModal(el).heading).toBe(
      t("menus.include_edit_heading").replace("{name}", "Wines"),
    );
    expect(includeField(el, "names-en").value).toBe("Our wines");
    expect(includeField(el, "names-es").value).toBe("Carta de vinos");
  });

  it("saves the switch and the changed fields to the include's list, and refreshes", async () => {
    const { client } = winesClient({
      showAsFolder: true,
      overrides: { names: { en: "Our wines" } },
    });
    const el = await mountLunch(client);
    expect(text(inStructure(el, '[data-test="folder-setting-included-wine"]'))).toBe(
      t("menus.include_as_folder"),
    );
    await openWines(el);
    emit(
      includeForm(el).shadowRoot!.querySelector('wt-switch[name="show-as-folder"]')!,
      "wt-change",
      { checked: false },
    );
    await includeForm(el).updateComplete;
    includeSave(el).click();
    await vi.waitFor(() =>
      expect(client.setIncludeFolder).toHaveBeenCalledExactlyOnceWith(
        "root-lunch",
        "included-wine",
        { showAsFolder: false },
      ),
    );
    await vi.waitFor(() => expect(includeModal(el).open).toBe(false));
    await vi.waitFor(async () => {
      await settleStructure(el);
      expect(text(inStructure(el, '[data-test="folder-setting-included-wine"]'))).toBe(
        t("menus.include_direct"),
      );
    });
  });

  it("an untouched field still follows after the included menu was renamed while the dialog was open", async () => {
    const { client, live, rename } = winesClient({ showAsFolder: true, overrides: {} });
    const el = await mountLunch(client);
    await openWines(el);
    rename({ en: "Wines by the glass", es: "Vinos por copa" });
    live.invalidate([{ type: "sections" }]);
    await vi.waitFor(() =>
      expect(structure(el).nodes.find((node) => node.memberId === "included-wine")?.names?.en).toBe(
        "Wines by the glass",
      ),
    );
    await el.updateComplete;
    includeForm(el).shadowRoot!.querySelector<HTMLElement>("[data-color='#256bb1']")!.click();
    await includeForm(el).updateComplete;
    includeSave(el).click();
    await vi.waitFor(() =>
      expect(client.setIncludeFolder).toHaveBeenCalledExactlyOnceWith(
        "root-lunch",
        "included-wine",
        { showAsFolder: true, overrides: { color: "#256bb1" } },
      ),
    );
  });

  it("puts a translation refusal about the folder beside the name field and keeps the dialog open", async () => {
    const before = currentLocale();
    setLocale("en");
    onTestFinished(() => setLocale(before));
    const { client } = winesClient(
      { showAsFolder: true, overrides: {} },
      {
        setIncludeFolder: vi.fn().mockRejectedValue({
          code: "menu_section.translation_required",
          params: { field: "names", language: "en" },
        }),
      },
    );
    const el = await mountLunch(client);
    await openWines(el);
    includeSave(el).click();
    await vi.waitFor(() =>
      expect(includeField(el, "names-en").error).toBe(
        "Add the folder's customer-facing name in the default content language, or remove all of the folder's customer-facing names.",
      ),
    );
    expect(await bottomIn(includeModal(el))).toBe(t("form.fix_fields"));
    expect(includeModal(el).open).toBe(true);
    expect(client.setIncludeFolder).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "image",
      "include-image-error",
      "The folder's image is not in the library. Choose another, or remove it.",
    ],
    [
      "color",
      "include-color-error",
      "The folder's colour was not accepted. Choose another colour, or no colour.",
    ],
  ])(
    "puts an invalid-%s refusal about the folder beside its field and keeps the dialog open",
    async (field, errorId, message) => {
      const before = currentLocale();
      setLocale("en");
      onTestFinished(() => setLocale(before));
      const { client } = winesClient(
        { showAsFolder: true, overrides: {} },
        {
          setIncludeFolder: vi
            .fn()
            .mockRejectedValue({ code: "menu_section.invalid", params: { field } }),
        },
      );
      const el = await mountLunch(client);
      await openWines(el);
      includeSave(el).click();
      await vi.waitFor(() =>
        expect(includeForm(el).shadowRoot!.querySelector(`#${errorId}`)?.textContent?.trim()).toBe(
          message,
        ),
      );
      expect(await bottomIn(includeModal(el))).toBe(t("form.fix_fields"));
      expect(includeModal(el).open).toBe(true);
    },
  );

  it("a refusal that names no shown field shows at the bottom", async () => {
    const { client } = winesClient(
      { showAsFolder: true, overrides: {} },
      { setIncludeFolder: vi.fn().mockRejectedValue({ code: "menu_section.not_found" }) },
    );
    const el = await mountLunch(client);
    await openWines(el);
    includeSave(el).click();
    await vi.waitFor(async () =>
      expect(await bottomIn(includeModal(el))).toBe(codeMessage("menu_section.not_found")),
    );
    expect(includeField(el, "names-en").error).toBe("");
    expect(includeModal(el).open).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The Price overrides tab

function prices(el: MenusScreen): MenuPricesTable {
  return q<MenuPricesTable>(el, "dashboard-menu-prices-table")!;
}

/** Opens Lunch's Prices from its address and waits for its rows. */
async function mountPrices(client: Api = api()) {
  const el = await mount(client, PRICES_PATH);
  await vi.waitFor(() => expect(prices(el)?.rows.length).toBe(3));
  return el;
}

// Where `fits` is false the field may start under the pinned row menu, the table's box scrolling
// sideways under it: once scrolled until the field ends at the menu, the whole field is in view.
it.each([
  ["en-GB", "12.50", "15.00", "", true],
  ["es-ES", "12.50", "15.00", "", true],
  ["en-GB", "1000.00", "9999.99", "", true],
  ["es-ES", "1000.00", "9999.99", "", false],
  ["es-ES", "1000.00", "9999.99", "Verdana", false],
])(
  "shows Lemonade's range placeholder whole, left of its row menu, in the dashboard at 390 px (%s, %s – %s, font %s)",
  async (locale, low, high, font, fits) => {
    await import("../dashboard-app.js");
    registerIcons(DASHBOARD_ICONS);
    const width = window.innerWidth,
      height = window.innerHeight;
    const before = currentLocale();
    onTestFinished(async () => {
      setLocale(before);
      await page.viewport(width, height);
    });
    await page.viewport(390, 844);
    history.replaceState(null, "", PRICES_PATH);
    const rows = lunchPrices();
    rows[1] = {
      ...rows[1]!,
      override: null,
      combined: combinedFixture(
        "p-lemonade",
        low,
        [
          { variantId: "v-small", price: low },
          { variantId: "v-large", price: high },
        ],
        null,
        low,
        { "v-small": low, "v-large": high },
      ),
      variants: [
        { variantId: "v-small", price: low, active: true, available: true },
        { variantId: "v-large", price: high, active: true, available: true },
      ],
    };
    const client = api({
      getMenuPrices: vi.fn().mockResolvedValue(rows),
      getMe: async () => ({
        personId: "p1",
        email: "ada@example.com",
        role: "manager",
        locale,
        venueLocale: locale,
        sessionDefault: locale,
        venueName: "Venue",
        permissions: ["product.manage"],
        modules: [],
      }),
      getLocales: async () => ({
        locales: [
          { code: "en-GB", label: "English" },
          { code: "es-ES", label: "Español" },
        ],
        venueDefault: locale,
        loginDefault: locale,
        venueName: "Venue",
        onboardingIntent: "prepare",
      }),
      listAlerts: async () => ({ visible: false, alerts: [] }),
      getGoogleConfig: async () => ({ configured: false }),
      passkeySignals: async () => ({
        rpId: "localhost",
        userId: "cDE",
        credentialIds: [],
        name: "ada@example.com",
        displayName: "Ada",
      }),
    });
    const { el: app, host } = await mountWidget<DashboardApp>(
      "dashboard-app",
      { api: client },
      "light",
    );
    if (font !== "") {
      const family = getComputedStyle(host).getPropertyValue("--wt-font-family");
      expect(family).not.toBe("");
      host.style.setProperty("--wt-font-family", `${font}, ${family}`);
    }
    const screen = () =>
      app.shadowRoot!.querySelector<MenusScreen>("dashboard-menus-screen") ?? undefined;
    await vi.waitFor(() => expect(screen() && prices(screen()!)?.rows.length).toBe(3));
    const widget = prices(screen()!);
    await vi.waitFor(() => expect(widget.style.getPropertyValue("--actions-width")).not.toBe(""));
    const grid = widget.shadowRoot!.querySelector("wt-data-table")!;
    await vi.waitFor(() => expect(grid.hasAttribute("narrow")).toBe(true));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(window.innerWidth).toBe(390);
    expect(currentLocale()).toBe(locale);
    const rowOf = (key: string) =>
      grid.shadowRoot!.querySelector<HTMLElement>(`tr[data-row-key="${key}"]`)!;
    rowOf("mi-lemonade").querySelector<HTMLElement>("button.tree-toggle")!.click();
    await vi.waitFor(() => expect(rowOf("mi-lemonade:v-large")).not.toBeNull());
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const input = (key: string) =>
      rowOf(key).querySelector("wt-price-input")!.shadowRoot!.querySelector("input")!;
    // As typed into the field, with a point whatever the language.
    expect(input("mi-lemonade").placeholder).toBe(`${low} – ${high}`);
    for (const key of [
      "mi-burger",
      "mi-lemonade",
      "mi-lemonade:v-small",
      "mi-lemonade:v-large",
      "mi-lager",
    ]) {
      const field = input(key);
      const shown = field.value === "" ? field.placeholder : field.value;
      const style = getComputedStyle(field);
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = getComputedStyle(field, field.value === "" ? "::placeholder" : null).font;
      const fit = {
        key,
        shown,
        needed: context.measureText(shown).width,
        room: field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      };
      expect(fit.needed, JSON.stringify(fit)).toBeLessThanOrEqual(fit.room);
      const fieldOf = () => rowOf(key).querySelector("wt-price-input")!.getBoundingClientRect();
      const menuOf = () =>
        rowOf(key).querySelector('td[data-pinned="end"]')!.getBoundingClientRect();
      const scroller = grid.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
      if (!fits) {
        scroller.scrollLeft = 0;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        scroller.scrollLeft = Math.max(0, Math.ceil(fieldOf().right - menuOf().left));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(fieldOf().left, key).toBeGreaterThanOrEqual(scroller.getBoundingClientRect().left);
      }
      const menu = menuOf();
      expect(fieldOf().right, key).toBeLessThanOrEqual(menu.left + 0.5);
      expect(menu.right, key).toBeLessThanOrEqual(window.innerWidth);
      rowOf(key).scrollIntoView({ block: "center", inline: "nearest" });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const trigger = rowOf(key)
        .querySelector("wt-row-actions")!
        .shadowRoot!.querySelector("button")!
        .getBoundingClientRect();
      const hit = grid.shadowRoot!.elementFromPoint(
        trigger.left + trigger.width / 2,
        trigger.top + trigger.height / 2,
      );
      expect(
        hit !== null && rowOf(key).querySelector('td[data-pinned="end"]')!.contains(hit),
        `${key} ⋮ covered`,
      ).toBe(true);
      scroller.scrollLeft = 0;
    }
  },
);

async function chooseTab(el: MenusScreen, key: string): Promise<void> {
  const tabs = q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!;
  tabs.shadowRoot!.querySelector<HTMLElement>(`[role="tab"][data-key="${key}"]`)!.click();
  await el.updateComplete;
}

function priceField(el: MenusScreen, key: string) {
  const table = prices(el).shadowRoot!.querySelector<Table>("wt-data-table")!;
  return table.shadowRoot.querySelector<HTMLElementTagNameMap["wt-price-input"]>(
    `wt-price-input[data-row="${key}"]`,
  )!;
}

/** Types a price into a row's field and presses Enter in it. */
async function commitPrice(el: MenusScreen, key: string, value: string): Promise<void> {
  type(priceField(el, key), value);
  await el.updateComplete;
  priceField(el, key)
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await el.updateComplete;
}

/** Opens a product's sizes in the prices table. */
async function expandPrices(el: MenusScreen, key: string): Promise<void> {
  const table = prices(el).shadowRoot!.querySelector<Table>("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot
    .querySelector<HTMLButtonElement>(`tr[data-row-key="${key}"] button.tree-toggle`)!
    .click();
  await table.updateComplete;
}

it("keeps the Price overrides tab in the address, and switching tabs keeps the chosen menu", async () => {
  const client = api();
  const el = await mountLunch(client);
  expect(client.getMenuPrices).not.toHaveBeenCalled();
  const tab = q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!.shadowRoot!.querySelector(
    '[role="tab"][data-key="prices"]',
  );
  expect(text(tab)).toBe(t("menus.tab_prices"));
  expect([t("menus.tab_prices", "en"), t("menus.tab_prices", "es-ES")]).toEqual([
    "Price overrides",
    "Precios propios",
  ]);
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

it("keeps its tab when a change event bubbles up from a control inside a tab's content", async () => {
  const el = await mountLunch();
  await chooseTab(el, "prices");
  q(el, '[slot="prices"]')!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "structure" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!.value).toBe("prices");
  expect(location.pathname).toBe(PRICES_PATH);
});

it("opens the Price overrides tab the address names, with the structure's sections, categories and products", async () => {
  const client = api({ listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()) });
  const el = await mountPrices(client);
  expect(q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!.value).toBe("prices");
  const table = prices(el);
  expect(table.sections.map(({ id }) => id)).toEqual(["s-drinks", "s-beer", "s-fav"]);
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

it("writes each field on its own, a product's through its menu item and a size's through its own route, reading the prices again after each", async () => {
  const client = api({ listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()) });
  const el = await mountPrices(client);
  await expandPrices(el, "mi-lemonade");
  const reads = client.getMenuPrices.mock.calls.length;
  await commitPrice(el, "mi-lemonade", "2.80");
  await vi.waitFor(() => expect(client.getMenuPrices.mock.calls.length).toBe(reads + 1));
  await commitPrice(el, "mi-lemonade:v-small", "1.90");
  await vi.waitFor(() => expect(client.getMenuPrices.mock.calls.length).toBe(reads + 2));
  expect(client.updateMenuItem.mock.calls).toEqual([
    ["menu-lunch", "mi-lemonade", { grossPrice: "2.80" }],
  ]);
  expect(client.setMenuVariantPrice.mock.calls).toEqual([
    ["menu-lunch", "mi-lemonade", "v-small", "1.90"],
  ]);
  expect(writeCalls(client)).toEqual(["updateMenuItem", "setMenuVariantPrice"]);
  await vi.waitFor(() => expect(prices(el).saving.size).toBe(0));
});

it("writes a product without sizes through its menu item alone", async () => {
  const client = api();
  const el = await mountPrices(client);
  await commitPrice(el, "mi-burger", "11.00");
  await vi.waitFor(() => expect(client.updateMenuItem).toHaveBeenCalledOnce());
  expect(client.updateMenuItem.mock.calls).toEqual([
    ["menu-lunch", "mi-burger", { grossPrice: "11.00" }],
  ]);
  expect(client.setMenuVariantPrice).not.toHaveBeenCalled();
});

it("writes only the product's price when only its field changed on a product with sizes", async () => {
  const client = api({ listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()) });
  const el = await mountPrices(client);
  await commitPrice(el, "mi-lemonade", "2.60");
  await vi.waitFor(() => expect(client.updateMenuItem).toHaveBeenCalledOnce());
  expect(client.updateMenuItem.mock.calls).toEqual([
    ["menu-lunch", "mi-lemonade", { grossPrice: "2.60" }],
  ]);
  await vi.waitFor(() => expect(prices(el).saving.size).toBe(0));
  expect(writeCalls(client)).toEqual(["updateMenuItem"]);
});

it("writes only that size's price when only a size's field changed, then reads the prices again", async () => {
  const client = api({ listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()) });
  const el = await mountPrices(client);
  await expandPrices(el, "mi-lemonade");
  const reads = client.getMenuPrices.mock.calls.length;
  await commitPrice(el, "mi-lemonade:v-small", "1.90");
  await vi.waitFor(() => expect(client.setMenuVariantPrice).toHaveBeenCalledOnce());
  expect(client.setMenuVariantPrice.mock.calls).toEqual([
    ["menu-lunch", "mi-lemonade", "v-small", "1.90"],
  ]);
  await vi.waitFor(() => expect(client.getMenuPrices.mock.calls.length).toBeGreaterThan(reads));
  await vi.waitFor(() => expect(prices(el).saving.size).toBe(0));
  expect(writeCalls(client)).toEqual(["setMenuVariantPrice"]);
});

it("writes nothing and marks nothing as saving for Enter on an unchanged field", async () => {
  const client = api({ listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()) });
  const el = await mountPrices(client);
  await commitPrice(el, "mi-lemonade", "2.50");
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(writeCalls(client)).toEqual([]);
  expect(prices(el).saving.size).toBe(0);
});

it("sends grossPrice: null for an emptied field", async () => {
  const client = api({ listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()) });
  const el = await mountPrices(client);
  expect(priceField(el, "mi-lemonade").value).toBe("2.50");
  await commitPrice(el, "mi-lemonade", "");
  await vi.waitFor(() => expect(client.updateMenuItem).toHaveBeenCalledOnce());
  expect(client.updateMenuItem.mock.calls[0]![2]).toEqual({ grossPrice: null });
});

it("keeps a refused price and its refusal in the field, which stays editable, and writes nothing else", async () => {
  const client = api({
    listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()),
    updateMenuItem: vi
      .fn()
      .mockRejectedValue({ code: "management.request_invalid", params: { field: "grossPrice" } }),
  });
  const el = await mountPrices(client);
  await commitPrice(el, "mi-lemonade", "2.80");
  await vi.waitFor(() =>
    expect(priceField(el, "mi-lemonade").error).toBe(codeMessage("management.request_invalid")),
  );
  expect(priceField(el, "mi-lemonade").value).toBe("2.80");
  expect(priceField(el, "mi-lemonade").disabled).toBe(false);
  expect(writeCalls(client)).toEqual(["updateMenuItem"]);
  expect(prices(el).saving.size).toBe(0);
});

it("refuses a malformed price in its field without sending anything", async () => {
  const client = api();
  const el = await mountPrices(client);
  await commitPrice(el, "mi-burger", "-2");
  await vi.waitFor(() => expect(priceField(el, "mi-burger").error).toBe(t("editor.price_invalid")));
  expect(priceField(el, "mi-burger").value).toBe("-2");
  expect(writeCalls(client)).toEqual([]);
});

it("sends a second change to a field whose save is out once the first is answered, keeping the field listed as saving until both are", async () => {
  const pending = deferred<void>();
  let written: string | null = null;
  const client = api({
    updateMenuItem: vi
      .fn()
      .mockImplementationOnce(
        async (_menu: string, _item: string, body: { grossPrice: string }) => {
          await pending.promise;
          written = body.grossPrice;
        },
      )
      .mockImplementation(async (_menu: string, _item: string, body: { grossPrice: string }) => {
        written = body.grossPrice;
      }),
    getMenuPrices: vi.fn(async (id: string) =>
      id === "menu-lunch"
        ? lunchPrices().map((row) =>
            row.menuItemId === "mi-burger" ? { ...row, override: written } : row,
          )
        : [],
    ),
  });
  const el = await mountPrices(client);
  await commitPrice(el, "mi-burger", "11.00");
  await commitPrice(el, "mi-burger", "11.50");
  expect(client.updateMenuItem).toHaveBeenCalledOnce();
  expect([...prices(el).saving]).toEqual(["mi-burger"]);
  pending.resolve();
  await vi.waitFor(() => expect(client.updateMenuItem).toHaveBeenCalledTimes(2));
  expect(client.updateMenuItem.mock.calls.map(([, , body]) => body)).toEqual([
    { grossPrice: "11.00" },
    { grossPrice: "11.50" },
  ]);
  await vi.waitFor(() => expect(prices(el).saving.size).toBe(0));
  expect(prices(el).rows.find((row) => row.menuItemId === "mi-burger")!.override).toBe("11.50");
  await prices(el).updateComplete;
  expect(priceField(el, "mi-burger").value).toBe("11.50");
});

it("a save that succeeded but could not then be reloaded is a load failure, not a refused save", async () => {
  const client = api();
  const el = await mountPrices(client);
  client.getMenuPrices.mockRejectedValue(new Error("down"));
  await commitPrice(el, "mi-burger", "11.00");
  await vi.waitFor(() => expect(prices(el).failed).toBe(true));
  expect(prices(el).refusals).toEqual({});
  expect(prices(el).outcome).toBeNull();
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
  await commitPrice(el, "mi-burger", "11.00");
  history.pushState(null, "", "/manage/menus/menu/menu-dinner/view/prices");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await vi.waitFor(() => expect(text(q(el, "h1"))).toBe("Dinner Menu"));
  pending.reject({ code: "catalogue.not_found" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      t("menus.change_not_saved")
        .replace("{name}", "Burger")
        .replace("{reason}", codeMessage("catalogue.not_found")),
    ),
  );
  expect(prices(el).outcome).toBeNull();
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
  await commitPrice(el, "mi-burger", "11.00");
  history.pushState(null, "", "/manage/menus/menu/menu-dinner/view/prices");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await vi.waitFor(() => expect(client.getMenuPrices).toHaveBeenCalledWith("menu-dinner"));
  const lunchReads = client.getMenuPrices.mock.calls.filter(([id]) => id === "menu-lunch").length;
  expect(client.updateMenuItem).toHaveBeenCalledOnce();
  pending.resolve();
  await vi.waitFor(() => expect(prices(el).saving.size).toBe(0));
  expect(client.getMenuPrices.mock.calls.filter(([id]) => id === "menu-lunch")).toHaveLength(
    lunchReads,
  );
  expect(q(el, '[data-test="member-error"]')).toBeNull();
  expect(prices(el).rows).toEqual([]);
  expect(prices(el).outcome).toBeNull();
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

it("stops following the prices while the Structure tab is shown, and reads them again on return", async () => {
  const live = new LiveData();
  const client = api({ liveData: live });
  const el = await mountPrices(client);
  await chooseTab(el, "structure");
  const reads = client.getMenuPrices.mock.calls.length;
  const structureReads = client.getMenuStructure.mock.calls.length;
  live.invalidate([{ type: "section_members" }, { type: "menu_items" }]);
  // The structure's own read shows the change notice was handled.
  await vi.waitFor(() =>
    expect(client.getMenuStructure.mock.calls.length).toBeGreaterThan(structureReads),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(client.getMenuPrices.mock.calls.length).toBe(reads);
  await chooseTab(el, "prices");
  await vi.waitFor(() => expect(client.getMenuPrices.mock.calls.length).toBe(reads + 1));
  expect(client.getMenuPrices).toHaveBeenLastCalledWith("menu-lunch");
});

it("shows the prices as loading on return to the Price overrides tab until they are read again", async () => {
  const client = api();
  const el = await mountPrices(client);
  await chooseTab(el, "structure");
  const again = deferred<MenuPriceRow[]>();
  client.getMenuPrices.mockImplementation(() => again.promise);
  const reads = client.getMenuPrices.mock.calls.length;
  await chooseTab(el, "prices");
  await vi.waitFor(() => expect(client.getMenuPrices.mock.calls.length).toBe(reads + 1));
  await el.updateComplete;
  expect(prices(el).rows).toEqual([]);
  expect(prices(el).loading).toBe(true);
  again.resolve(lunchPrices());
  await vi.waitFor(() => expect(prices(el).rows.length).toBe(3));
  expect(prices(el).loading).toBe(false);
});

it("starts no second read when the address is read again on the Price overrides tab it already shows", async () => {
  const client = api();
  const el = await mountPrices(client);
  const reads = client.getMenuPrices.mock.calls.length;
  window.dispatchEvent(new PopStateEvent("popstate"));
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(client.getMenuPrices.mock.calls.length).toBe(reads);
  expect(prices(el).rows.length).toBe(3);
});

it("reads no prices when a save finishes after the person has left the Price overrides tab", async () => {
  const pending = deferred<void>();
  const client = api({ updateMenuItem: vi.fn(() => pending.promise) });
  const el = await mountPrices(client);
  await commitPrice(el, "mi-burger", "11.00");
  await chooseTab(el, "structure");
  const reads = client.getMenuPrices.mock.calls.length;
  expect(client.updateMenuItem).toHaveBeenCalledOnce();
  pending.resolve();
  await vi.waitFor(() => expect(prices(el).saving.size).toBe(0));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(client.getMenuPrices.mock.calls.length).toBe(reads);
  expect(prices(el).outcome).toBeNull();
});

it("saves an edit left by choosing another tab", async () => {
  const client = api();
  const el = await mountPrices(client);
  type(priceField(el, "mi-burger"), "11.00");
  await el.updateComplete;
  priceField(el, "mi-burger").dispatchEvent(
    new FocusEvent("focusout", { bubbles: true, composed: true }),
  );
  await chooseTab(el, "structure");
  await vi.waitFor(() =>
    expect(client.updateMenuItem).toHaveBeenCalledExactlyOnceWith("menu-lunch", "mi-burger", {
      grossPrice: "11.00",
    }),
  );
});

it("reports beside the Structure tab a save refused after Back left the Price overrides tab", async () => {
  const pending = deferred<void>();
  const client = api({ updateMenuItem: vi.fn(() => pending.promise) });
  const el = await mountLunch(client);
  await chooseTab(el, "prices");
  await vi.waitFor(() => expect(prices(el).rows.length).toBe(3));
  await commitPrice(el, "mi-burger", "11.00");
  history.back();
  await vi.waitFor(() => expect(location.pathname).toBe(LUNCH_PATH));
  pending.reject({ code: "catalogue.not_found" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      t("menus.change_not_saved")
        .replace("{name}", "Burger")
        .replace("{reason}", codeMessage("catalogue.not_found")),
    ),
  );
  expect(prices(el).outcome).toBeNull();
});

it("puts a size's refused price under that size's field, writing nothing else and reading no prices", async () => {
  const client = api({
    listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()),
    setMenuVariantPrice: vi
      .fn()
      .mockRejectedValue({ code: "product.variant_invalid", params: { field: "price" } }),
  });
  const el = await mountPrices(client);
  await expandPrices(el, "mi-lemonade");
  const reads = client.getMenuPrices.mock.calls.length;
  await commitPrice(el, "mi-lemonade:v-small", "1.90");
  const expected = codeMessage("product.variant_invalid");
  await vi.waitFor(() => expect(priceField(el, "mi-lemonade:v-small").error).toBe(expected));
  expect(prices(el).refusals).toEqual({ "mi-lemonade:v-small": expected });
  expect(prices(el).outcome).toMatchObject({
    kind: "refused",
    reason: expected,
    save: { key: "mi-lemonade:v-small" },
  });
  expect(client.setMenuVariantPrice).toHaveBeenCalledOnce();
  expect(client.updateMenuItem).not.toHaveBeenCalled();
  expect(priceField(el, "mi-lemonade:v-small").value).toBe("1.90");
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(client.getMenuPrices.mock.calls.length).toBe(reads);
});

it("names the product and its size beside the list when a size's refusal lands after the person left its menu", async () => {
  const pending = deferred<void>();
  const client = api({
    listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()),
    setMenuVariantPrice: vi.fn(() => pending.promise),
  });
  const el = await mountPrices(client);
  await expandPrices(el, "mi-lemonade");
  await commitPrice(el, "mi-lemonade:v-small", "1.90");
  await vi.waitFor(() => expect(client.setMenuVariantPrice).toHaveBeenCalledOnce());
  history.pushState(null, "", "/manage/menus/menu/menu-dinner/view/prices");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await vi.waitFor(() => expect(text(q(el, "h1"))).toBe("Dinner Menu"));
  pending.reject({ code: "management.request_invalid" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      t("menus.change_not_saved")
        .replace("{name}", "Lemonade — Small")
        .replace("{reason}", codeMessage("management.request_invalid")),
    ),
  );
  expect(client.updateMenuItem).not.toHaveBeenCalled();
});

it("says a connection failure in the outcome message, under no field", async () => {
  const client = api({ updateMenuItem: vi.fn().mockRejectedValue({ code: "connection.failed" }) });
  const el = await mountPrices(client);
  await commitPrice(el, "mi-burger", "11.00");
  await vi.waitFor(() =>
    expect(prices(el).outcome).toMatchObject({
      kind: "refused",
      reason: codeMessage("connection.failed"),
    }),
  );
  expect(prices(el).refusals).toEqual({});
  expect(priceField(el, "mi-burger").error).toBe("");
  expect(priceField(el, "mi-burger").value).toBe("11.00");
  expect(q(el, '[data-test="member-error"]')).toBeNull();
});

function closeOutcome(el: MenusScreen): void {
  prices(el)
    .shadowRoot!.querySelector('[data-test="price-outcome"]')!
    .shadowRoot!.querySelector<HTMLButtonElement>("button.close")!
    .click();
}

it("shows the stored price again once a refusal said under no field is closed, and leaving the field writes nothing", async () => {
  const client = api({ updateMenuItem: vi.fn().mockRejectedValue({ code: "connection.failed" }) });
  const el = await mountPrices(client);
  await commitPrice(el, "mi-burger", "11.00");
  await vi.waitFor(() => expect(prices(el).outcome).toMatchObject({ kind: "refused" }));
  await prices(el).updateComplete;
  expect(priceField(el, "mi-burger").value).toBe("11.00");
  closeOutcome(el);
  await vi.waitFor(() => expect(priceField(el, "mi-burger").value).toBe(""));
  expect(prices(el).outcome).toBeNull();
  priceField(el, "mi-burger").dispatchEvent(
    new FocusEvent("focusout", { bubbles: true, composed: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(client.updateMenuItem).toHaveBeenCalledOnce();
});

it("keeps a price typed since a refusal when that refusal's message is closed", async () => {
  const client = api({ updateMenuItem: vi.fn().mockRejectedValue({ code: "connection.failed" }) });
  const el = await mountPrices(client);
  await commitPrice(el, "mi-burger", "11.00");
  await vi.waitFor(() => expect(prices(el).outcome).toMatchObject({ kind: "refused" }));
  type(priceField(el, "mi-burger"), "12.00");
  await el.updateComplete;
  closeOutcome(el);
  await vi.waitFor(() => expect(prices(el).outcome).toBeNull());
  await prices(el).updateComplete;
  expect(priceField(el, "mi-burger").value).toBe("12.00");
});

it("shows the stored price again after a refused save once the tab is left and opened again, and leaving the field writes nothing", async () => {
  const client = api({ updateMenuItem: vi.fn().mockRejectedValue({ code: "connection.failed" }) });
  const el = await mountPrices(client);
  await commitPrice(el, "mi-burger", "11.00");
  await vi.waitFor(() => expect(prices(el).outcome).not.toBeNull());
  expect(priceField(el, "mi-burger").value).toBe("11.00");
  await chooseTab(el, "structure");
  await chooseTab(el, "prices");
  await vi.waitFor(() => expect(prices(el).rows.length).toBe(3));
  await prices(el).updateComplete;
  expect(prices(el).outcome).toBeNull();
  expect(priceField(el, "mi-burger").value).toBe("");
  priceField(el, "mi-burger").dispatchEvent(
    new FocusEvent("focusout", { bubbles: true, composed: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(client.updateMenuItem).toHaveBeenCalledOnce();
});

it("keeps the sent price in the field, listed as saving, until the re-read after its write has answered", async () => {
  const client = api();
  const el = await mountPrices(client);
  const reread = deferred<MenuPriceRow[]>();
  client.getMenuPrices.mockImplementation(() => reread.promise);
  await commitPrice(el, "mi-burger", "11.00");
  await vi.waitFor(() => expect(client.updateMenuItem).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(client.getMenuPrices).toHaveBeenLastCalledWith("menu-lunch"));
  await new Promise((resolve) => setTimeout(resolve, 50));
  await prices(el).updateComplete;
  expect([...prices(el).saving]).toEqual(["mi-burger"]);
  expect(priceField(el, "mi-burger").value).toBe("11.00");
  reread.resolve(
    lunchPrices().map((row) =>
      row.menuItemId === "mi-burger" ? { ...row, override: "11.00" } : row,
    ),
  );
  await vi.waitFor(() => expect(prices(el).saving.size).toBe(0));
  await prices(el).updateComplete;
  expect(prices(el).rows.find((row) => row.menuItemId === "mi-burger")!.override).toBe("11.00");
  expect(priceField(el, "mi-burger").value).toBe("11.00");
});

function priceUndo(el: MenusScreen): HTMLElement | null {
  return prices(el).shadowRoot!.querySelector<HTMLElement>('[data-test="price-undo"]');
}

const burgerSave = {
  key: "mi-burger",
  menuItemId: "mi-burger",
  variantId: null,
  name: "Burger",
  price: "11.00",
  previous: null,
};

/** Ways of leaving Lunch's Price overrides tab. */
const AWAY_FROM_PRICES = [
  {
    away: "another menu",
    leave: async () => {
      history.pushState(null, "", "/manage/menus/menu/menu-dinner/view/prices");
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
  },
  { away: "the Structure tab", leave: (el: MenusScreen) => chooseTab(el, "structure") },
];

it("says a save was saved once the prices are read again, and Undo writes the previous price back, offering no second Undo", async () => {
  const client = api();
  const el = await mountPrices(client);
  const reread = deferred<MenuPriceRow[]>();
  client.getMenuPrices.mockImplementationOnce(() => reread.promise);
  await commitPrice(el, "mi-burger", "11.00");
  await vi.waitFor(() => expect(client.getMenuPrices).toHaveBeenLastCalledWith("menu-lunch"));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(prices(el).outcome).toBeNull();
  reread.resolve(
    lunchPrices().map((row) =>
      row.menuItemId === "mi-burger" ? { ...row, override: "11.00" } : row,
    ),
  );
  await vi.waitFor(() => expect(prices(el).outcome).toEqual({ kind: "saved", save: burgerSave }));
  await prices(el).updateComplete;
  priceUndo(el)!.click();
  await vi.waitFor(() => expect(client.updateMenuItem).toHaveBeenCalledTimes(2));
  expect(client.updateMenuItem.mock.calls[1]).toEqual([
    "menu-lunch",
    "mi-burger",
    { grossPrice: null },
  ]);
  await vi.waitFor(() =>
    expect(prices(el).outcome).toEqual({
      kind: "saved",
      save: { ...burgerSave, price: null, previous: "11.00", undo: true },
    }),
  );
  await prices(el).updateComplete;
  expect(priceUndo(el)).toBeNull();
});

it("undoes on a click while that field holds a price typed and not yet saved, sending the Undo alone", async () => {
  let written: string | null = null;
  const client = api({
    updateMenuItem: vi.fn(async (_menu: string, _item: string, body: { grossPrice: string }) => {
      written = body.grossPrice;
    }),
    getMenuPrices: vi.fn(async (id: string) =>
      id === "menu-lunch"
        ? lunchPrices().map((row) =>
            row.menuItemId === "mi-burger" ? { ...row, override: written } : row,
          )
        : [],
    ),
  });
  const el = await mountPrices(client);
  await commitPrice(el, "mi-burger", "11.00");
  await vi.waitFor(() => expect(prices(el).outcome).toEqual({ kind: "saved", save: burgerSave }));
  await prices(el).updateComplete;
  await userEvent.fill(priceField(el, "mi-burger").shadowRoot!.querySelector("input")!, "13.00");
  await userEvent.click(priceUndo(el)!);
  await vi.waitFor(() => expect(client.updateMenuItem).toHaveBeenCalledTimes(2));
  expect(client.updateMenuItem.mock.calls[1]![2]).toEqual({ grossPrice: null });
  await vi.waitFor(() => expect(prices(el).saving.size).toBe(0));
  priceField(el, "mi-burger").shadowRoot!.querySelector("input")!.blur();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(client.updateMenuItem).toHaveBeenCalledTimes(2);
  await prices(el).updateComplete;
  expect(priceField(el, "mi-burger").value).toBe("");
});

it.each(AWAY_FROM_PRICES)(
  "clears what the outcome message said about a saved price once $away is opened",
  async ({ leave }) => {
    const el = await mountPrices();
    await commitPrice(el, "mi-burger", "11.00");
    await vi.waitFor(() => expect(prices(el).outcome).toMatchObject({ kind: "saved" }));
    await leave(el);
    await vi.waitFor(() => expect(prices(el).outcome).toBeNull());
  },
);

it.each(AWAY_FROM_PRICES)(
  "says nothing was saved when $away is opened while the prices are read again after a save",
  async ({ leave }) => {
    const client = api();
    const el = await mountPrices(client);
    const reread = deferred<MenuPriceRow[]>();
    client.getMenuPrices.mockImplementation(() => reread.promise);
    await commitPrice(el, "mi-burger", "11.00");
    await vi.waitFor(() => expect(client.getMenuPrices).toHaveBeenLastCalledWith("menu-lunch"));
    await leave(el);
    await vi.waitFor(() => expect(prices(el).saving.size).toBe(0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(prices(el).outcome).toBeNull();
  },
);

it("says only the last save made, and its Undo writes back the price the save before it sent", async () => {
  const first = deferred<void>();
  const second = deferred<void>();
  let written: string | null = null;
  const holds = [first, second];
  const client = api({
    updateMenuItem: vi.fn(async (_menu: string, _item: string, body: { grossPrice: string }) => {
      await holds.shift()?.promise;
      written = body.grossPrice;
    }),
    getMenuPrices: vi.fn(async (id: string) =>
      id === "menu-lunch"
        ? lunchPrices().map((row) =>
            row.menuItemId === "mi-burger" ? { ...row, override: written } : row,
          )
        : [],
    ),
  });
  const el = await mountPrices(client);
  await commitPrice(el, "mi-burger", "11.00");
  await commitPrice(el, "mi-burger", "11.50");
  first.resolve();
  await vi.waitFor(() => expect(client.updateMenuItem).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(prices(el).outcome).toBeNull();
  second.resolve();
  await vi.waitFor(() =>
    expect(prices(el).outcome).toEqual({
      kind: "saved",
      save: { ...burgerSave, price: "11.50", previous: "11.00" },
    }),
  );
  await prices(el).updateComplete;
  priceUndo(el)!.click();
  await vi.waitFor(() => expect(client.updateMenuItem).toHaveBeenCalledTimes(3));
  expect(client.updateMenuItem.mock.calls[2]![2]).toEqual({ grossPrice: "11.00" });
  await vi.waitFor(() => expect(prices(el).saving.size).toBe(0));
  await prices(el).updateComplete;
  expect(priceField(el, "mi-burger").value).toBe("11.00");
});

it.each([
  { second: "another field's", key: "mi-lager", price: "5.00" },
  { second: "the same field's", key: "mi-burger", price: "11.50" },
])(
  "keeps an earlier save's refusal in the outcome message when $second later save succeeds, offering no Undo",
  async ({ key, price }) => {
    const refused = deferred<void>();
    const holds = [refused];
    const client = api({
      updateMenuItem: vi.fn(async () => {
        await holds.shift()?.promise;
      }),
    });
    const el = await mountPrices(client);
    await commitPrice(el, "mi-burger", "11.00");
    await commitPrice(el, key, price);
    refused.reject({ code: "connection.failed" });
    await vi.waitFor(() => expect(client.updateMenuItem).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(prices(el).saving.size).toBe(0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(prices(el).outcome).toEqual({
      kind: "refused",
      save: burgerSave,
      reason: codeMessage("connection.failed"),
    });
    await prices(el).updateComplete;
    expect(priceUndo(el)).toBeNull();
    if (key !== "mi-burger") expect(priceField(el, "mi-burger").value).toBe("11.00");
  },
);

it("takes an earlier save's refusal from under its field once a later save of that field succeeds, still saying it in the outcome message", async () => {
  const refused = deferred<void>();
  let written: string | null = null;
  const holds = [refused];
  const client = api({
    updateMenuItem: vi.fn(async (_menu: string, _item: string, body: { grossPrice: string }) => {
      await holds.shift()?.promise;
      written = body.grossPrice;
    }),
    getMenuPrices: vi.fn(async (id: string) =>
      id === "menu-lunch"
        ? lunchPrices().map((row) =>
            row.menuItemId === "mi-burger" ? { ...row, override: written } : row,
          )
        : [],
    ),
  });
  const el = await mountPrices(client);
  await commitPrice(el, "mi-burger", "11.00");
  await commitPrice(el, "mi-burger", "11.50");
  const reason = codeMessage("management.request_invalid");
  refused.reject({ code: "management.request_invalid", params: { field: "grossPrice" } });
  await vi.waitFor(() => expect(client.updateMenuItem).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(prices(el).saving.size).toBe(0));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(written).toBe("11.50");
  expect(prices(el).refusals).toEqual({});
  await prices(el).updateComplete;
  expect(priceField(el, "mi-burger").value).toBe("11.50");
  expect(priceField(el, "mi-burger").error).toBe("");
  expect(prices(el).outcome).toEqual({ kind: "refused", save: burgerSave, reason });
});

it("keeps a refusal under its field when a later save of another field succeeds", async () => {
  const refused = deferred<void>();
  const holds = [refused];
  const client = api({
    updateMenuItem: vi.fn(async () => {
      await holds.shift()?.promise;
    }),
  });
  const el = await mountPrices(client);
  await commitPrice(el, "mi-burger", "11.00");
  await commitPrice(el, "mi-lager", "5.00");
  refused.reject({ code: "management.request_invalid", params: { field: "grossPrice" } });
  await vi.waitFor(() => expect(client.updateMenuItem).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(prices(el).saving.size).toBe(0));
  await new Promise((resolve) => setTimeout(resolve, 50));
  const reason = codeMessage("management.request_invalid");
  expect(prices(el).refusals).toEqual({ "mi-burger": reason });
  await prices(el).updateComplete;
  expect(priceField(el, "mi-burger").error).toBe(reason);
});

it("clears a refusal from the outcome message, and from under its field, once that field is sent again", async () => {
  const again = deferred<void>();
  const client = api({
    updateMenuItem: vi
      .fn()
      .mockRejectedValueOnce({
        code: "management.request_invalid",
        params: { field: "grossPrice" },
      })
      .mockImplementationOnce(() => again.promise),
  });
  const el = await mountPrices(client);
  await commitPrice(el, "mi-burger", "11.00");
  await vi.waitFor(() => expect(prices(el).outcome).not.toBeNull());
  expect(prices(el).refusals).toEqual({ "mi-burger": codeMessage("management.request_invalid") });
  await commitPrice(el, "mi-burger", "11.00");
  await vi.waitFor(() => expect(client.updateMenuItem).toHaveBeenCalledTimes(2));
  expect(prices(el).outcome).toBeNull();
  expect(prices(el).refusals).toEqual({});
  again.resolve();
  await vi.waitFor(() => expect(prices(el).saving.size).toBe(0));
});

it.each([
  ["mi-burger", { code: "management.request_invalid", params: { field: "_form" } }],
  ["mi-burger", { code: "management.request_invalid", params: { field: "variants" } }],
  ["mi-burger", { code: "product.variant_not_found", params: {} }],
  ["mi-lemonade:v-small", { code: "management.request_invalid", params: { field: "variantId" } }],
  ["mi-lemonade:v-small", { code: "product.variant_invalid", params: { field: "variants.1" } }],
  ["mi-lemonade:v-small", { code: "menu_item.not_found", params: {} }],
])(
  "says %s's refusal %j, which names no price, in the outcome message under no field",
  async (key, refusal) => {
    const client = api({
      listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()),
      updateMenuItem: vi.fn().mockRejectedValue(refusal),
      setMenuVariantPrice: vi.fn().mockRejectedValue(refusal),
    });
    const el = await mountPrices(client);
    await expandPrices(el, "mi-lemonade");
    await commitPrice(el, key, "1.90");
    await vi.waitFor(() =>
      expect(prices(el).outcome).toMatchObject({
        kind: "refused",
        reason: codeMessage(refusal.code),
        save: { key },
      }),
    );
    expect(prices(el).refusals).toEqual({});
    await vi.waitFor(() => expect(priceField(el, key).value).toBe("1.90"));
    expect(priceField(el, key).error).toBe("");
  },
);

it.each([
  ["mi-burger", { code: "management.request_invalid", params: { field: "grossPrice" } }],
  ["mi-lemonade:v-small", { code: "product.variant_invalid", params: { field: "price" } }],
  ["mi-lemonade:v-small", { code: "product.variant_not_found", params: { variantId: "v-small" } }],
])("puts a refusal naming %s's price under its field, and focuses it", async (key, refusal) => {
  const client = api({
    listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()),
    updateMenuItem: vi.fn().mockRejectedValue(refusal),
    setMenuVariantPrice: vi.fn().mockRejectedValue(refusal),
  });
  const el = await mountPrices(client);
  await expandPrices(el, "mi-lemonade");
  await commitPrice(el, key, "1.90");
  await vi.waitFor(() => expect(priceField(el, key).error).toBe(codeMessage(refusal.code)));
  const input = priceField(el, key);
  await vi.waitFor(() =>
    expect(input.shadowRoot!.activeElement).toBe(input.shadowRoot!.querySelector("input")),
  );
});

it("writes two fields one after the other, the second waiting for the first's answer", async () => {
  const first = deferred<void>();
  const client = api({
    listLibraryProducts: vi.fn().mockResolvedValue(variantProducts()),
    updateMenuItem: vi.fn(() => first.promise),
  });
  const el = await mountPrices(client);
  await expandPrices(el, "mi-lemonade");
  await commitPrice(el, "mi-burger", "11.00");
  await commitPrice(el, "mi-lemonade:v-small", "1.90");
  expect(client.updateMenuItem).toHaveBeenCalledOnce();
  expect(client.setMenuVariantPrice).not.toHaveBeenCalled();
  expect([...prices(el).saving].sort()).toEqual(["mi-burger", "mi-lemonade:v-small"]);
  first.resolve();
  await vi.waitFor(() =>
    expect(client.setMenuVariantPrice).toHaveBeenCalledExactlyOnceWith(
      "menu-lunch",
      "mi-lemonade",
      "v-small",
      "1.90",
    ),
  );
  await vi.waitFor(() => expect(prices(el).saving.size).toBe(0));
  expect(writeCalls(client)).toEqual(["updateMenuItem", "setMenuVariantPrice"]);
});

/** A client whose product writes wait on `holds` in turn and whose price reads carry what they
 * wrote. */
function heldPriceWrites(holds: { promise: Promise<void> }[]) {
  const written = new Map<string, string | null>();
  return api({
    updateMenuItem: vi.fn(
      async (_menu: string, item: string, body: { grossPrice: string | null }) => {
        await holds.shift()?.promise;
        written.set(item, body.grossPrice);
      },
    ),
    getMenuPrices: vi.fn(async (id: string) =>
      id === "menu-lunch"
        ? lunchPrices().map((row) =>
            written.has(row.menuItemId) ? { ...row, override: written.get(row.menuItemId)! } : row,
          )
        : [],
    ),
  });
}

it("reads the prices again once for saves made one behind another, each field keeping its sent price, listed as saving, until that read", async () => {
  const first = deferred<void>();
  const second = deferred<void>();
  const client = heldPriceWrites([first, second]);
  const el = await mountPrices(client);
  const reads = client.getMenuPrices.mock.calls.length;
  await commitPrice(el, "mi-burger", "11.00");
  await commitPrice(el, "mi-lager", "5.00");
  first.resolve();
  await vi.waitFor(() => expect(client.updateMenuItem).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 50));
  await prices(el).updateComplete;
  expect(client.getMenuPrices.mock.calls.length).toBe(reads);
  expect([...prices(el).saving].sort()).toEqual(["mi-burger", "mi-lager"]);
  expect(priceField(el, "mi-burger").value).toBe("11.00");
  second.resolve();
  await vi.waitFor(() => expect(prices(el).saving.size).toBe(0));
  expect(client.getMenuPrices.mock.calls.length).toBe(reads + 1);
  await prices(el).updateComplete;
  expect(priceField(el, "mi-burger").value).toBe("11.00");
  expect(priceField(el, "mi-lager").value).toBe("5.00");
});

it("reads the prices again after a refused last save when a save before it was stored", async () => {
  const first = deferred<void>();
  const refused = deferred<void>();
  const client = heldPriceWrites([first, refused]);
  const el = await mountPrices(client);
  const reads = client.getMenuPrices.mock.calls.length;
  await commitPrice(el, "mi-burger", "11.00");
  await commitPrice(el, "mi-lager", "5.00");
  first.resolve();
  await vi.waitFor(() => expect(client.updateMenuItem).toHaveBeenCalledTimes(2));
  refused.reject({ code: "connection.failed" });
  await vi.waitFor(() => expect(prices(el).saving.size).toBe(0));
  expect(client.getMenuPrices.mock.calls.length).toBe(reads + 1);
  expect(prices(el).rows.find((row) => row.menuItemId === "mi-burger")!.override).toBe("11.00");
  expect(prices(el).outcome).toMatchObject({ kind: "refused", save: { key: "mi-lager" } });
  await prices(el).updateComplete;
  expect(priceField(el, "mi-burger").value).toBe("11.00");
  expect(priceField(el, "mi-lager").value).toBe("5.00");
});

it("still sends a queued save after the one before it is refused", async () => {
  const client = api({
    updateMenuItem: vi
      .fn()
      .mockRejectedValueOnce({
        code: "management.request_invalid",
        params: { field: "grossPrice" },
      })
      .mockResolvedValue(undefined),
  });
  const el = await mountPrices(client);
  await commitPrice(el, "mi-burger", "11.00");
  await commitPrice(el, "mi-lager", "2.10");
  await vi.waitFor(() => expect(client.updateMenuItem).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(priceField(el, "mi-burger").error).toBe(codeMessage("management.request_invalid")),
  );
  expect(priceField(el, "mi-burger").value).toBe("11.00");
});

it("reports beside the list, naming the product, a refusal for a row the menu no longer lists", async () => {
  const pending = deferred<void>();
  const live = new LiveData();
  const client = api({ liveData: live, updateMenuItem: vi.fn(() => pending.promise) });
  const el = await mountPrices(client);
  await commitPrice(el, "mi-burger", "11.00");
  client.getMenuPrices.mockResolvedValue(lunchPrices().filter((r) => r.menuItemId !== "mi-burger"));
  live.invalidate([{ type: "menu_items" }]);
  await vi.waitFor(() =>
    expect(prices(el).rows.map((r) => r.menuItemId)).not.toContain("mi-burger"),
  );
  pending.reject({ code: "menu_item.not_found" });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      t("menus.change_not_saved")
        .replace("{name}", "Burger")
        .replace("{reason}", codeMessage("menu_item.not_found")),
    ),
  );
  expect(prices(el).outcome).toBeNull();
});

// ---------------------------------------------------------------------------
// Publishing

describe("publishing", () => {
  // Read as a person reads the page, in English unless a case says otherwise, on a screen wide enough for every column.
  const frame = { width: 0, height: 0 };
  beforeEach(async () => {
    setLocale("en");
    frame.width = window.innerWidth;
    frame.height = window.innerHeight;
    await page.viewport(1280, 900);
  });
  afterEach(async () => {
    setLocale("es-ES");
    await page.viewport(frame.width, frame.height);
  });

  function statusCell(el: MenusScreen, menuId: string): string {
    return text(table(el).shadowRoot.querySelector(`[data-test="status-${menuId}"]`));
  }

  function panel(el: MenusScreen) {
    return q<HTMLElementTagNameMap["dashboard-menu-preview"]>(el, "dashboard-menu-preview")!;
  }

  function inPanel(el: MenusScreen, testId: string): HTMLElement | null {
    return panel(el).shadowRoot!.querySelector<HTMLElement>(`[data-test="${testId}"]`);
  }

  async function mountPreview(client: Api = api()) {
    const el = await mount(client, PREVIEW_PATH);
    await vi.waitFor(() => expect(inPanel(el, "changes")).not.toBeNull());
    return el;
  }

  async function publish(el: MenusScreen): Promise<void> {
    inPanel(el, "publish")!.click();
    await panel(el).updateComplete;
    inPanel(el, "publish-confirm")?.click();
    await el.updateComplete;
  }

  it("renders the publications widget for the open menu with the preview it read", async () => {
    const client = api();
    const el = await mountPreview(client);
    const schedule = panel(el).querySelector<HTMLElementTagNameMap["dashboard-menu-publications"]>(
      "dashboard-menu-publications",
    )!;
    expect(schedule.slot).toBe("schedule");
    expect(schedule.menuId).toBe("menu-lunch");
    expect(schedule.menuName).toBe("Lunch Menu");
    expect(schedule.api).toBe(client);
    expect(schedule.preview).toBe(panel(el).preview);
    expect(schedule.preview?.hash).toBe(LUNCH_HASH);
    const slot = panel(el).shadowRoot!.querySelector('slot[name="schedule"]');
    expect(slot).not.toBeNull();
    expect(schedule.assignedSlot).toBe(slot);
    await vi.waitFor(() => expect(client.getMenuPublications).toHaveBeenCalledWith("menu-lunch"));
  });

  it("hands the publications widget no preview once a background preview read fails", async () => {
    const live = new LiveData();
    const client = api({
      liveData: live,
      getMenuPreview: vi.fn().mockResolvedValue(lunchPreview()),
    });
    const el = await mountPreview(client);
    const schedule = panel(el).querySelector<HTMLElementTagNameMap["dashboard-menu-publications"]>(
      "dashboard-menu-publications",
    )!;
    expect(schedule.preview?.hash).toBe(LUNCH_HASH);
    client.getMenuPreview.mockRejectedValue({ code: "server.internal" });
    live.invalidate([{ type: "products" }]);
    await vi.waitFor(() => expect(inPanel(el, "preview-error")).not.toBeNull());
    expect(panel(el).preview).not.toBeNull();
    expect(schedule.preview).toBeNull();
  });

  function navigablePreview(): MenuPreview {
    const snapshot = lunchPreview();
    const live = lunchDocument();
    snapshot.live = { versionId: "live-lunch-2", document: live };
    const offer = snapshot.document.offers["mi-lemonade"]!;
    offer.description = { en: "Proposed fresh lemon", es: "Limón propuesto" };
    const variant = {
      kitchenName: offer.kitchenName,
      image: offer.image,
      menuPrice: null,
      pricingUnit: "each" as const,
      unit: offer.unit,
      vatClass: offer.vatClass,
      allergens: offer.allergens,
      diet: offer.diet,
      dietDerivation: offer.dietDerivation,
      dietOverride: offer.dietOverride,
      dietaryDeclarations: offer.dietaryDeclarations,
    };
    offer.variants = [
      {
        ...variant,
        id: "v-small",
        name: "Counter small",
        customerName: { en: "Small glass", es: "Vaso pequeño" },
        unitPrice: "2.00",
      },
      {
        ...variant,
        id: "v-large",
        name: "Counter large",
        customerName: { en: "Large glass", es: "Vaso grande" },
        unitPrice: "4.00",
      },
    ];
    const target = {
      kind: "product" as const,
      sectionIds: ["s-drinks"],
      menuItemId: "mi-lemonade",
      productId: "p-lemonade",
      field: { kind: "description" as const, language: "en" },
    };
    snapshot.changes = [
      {
        id: "lemon-description",
        kind: "product_changed",
        productId: "p-lemonade",
        name: "Counter Lemonade",
        fields: ["description"],
        source: "shared_product",
        targets: { before: [target], after: [target] },
      },
      {
        id: "removed-burger",
        kind: "product_removed",
        productId: "p-burger",
        name: "Old Burger",
        under: [],
        source: "this_menu",
        targets: {
          before: [
            {
              kind: "product",
              sectionIds: [],
              menuItemId: "mi-burger",
              productId: "p-burger",
              field: { kind: "summary" },
            },
          ],
          after: [],
        },
      },
      {
        id: "home-columns",
        kind: "home_display_changed",
        device: "handheld",
        source: "this_menu",
        targets: {
          before: [{ kind: "home", device: "handheld", field: "columns" }],
          after: [{ kind: "home", device: "handheld", field: "columns" }],
        },
      },
    ];
    snapshot.document.root.members = snapshot.document.root.members.filter(
      (m) => m.kind !== "product",
    );
    delete snapshot.document.offers["mi-burger"];
    return snapshot;
  }

  async function content(el: MenusScreen): Promise<CustomerMenu> {
    const renderer = panel(el).shadowRoot!.querySelector<CustomerMenu>("dashboard-customer-menu")!;
    await renderer.updateComplete;
    return renderer;
  }

  async function followChange(el: MenusScreen, id: string): Promise<void> {
    panel(el)
      .shadowRoot!.querySelector<HTMLButtonElement>(`button[data-change-id="${id}"]`)!
      .click();
    await panel(el).updateComplete;
    await vi.waitFor(async () => {
      const renderer = await content(el);
      if (id === "home-columns") expect(inPanel(el, "home-target")).not.toBeNull();
      else expect(renderer.shadowRoot!.querySelector("[data-detail]")).not.toBeNull();
    });
  }

  it("inspects preview languages, variants, Before and Home without another read or write", async () => {
    const snapshot = navigablePreview();
    const original = JSON.stringify(snapshot);
    const client = api({ getMenuPreview: vi.fn().mockResolvedValue(snapshot) });
    const el = await mountPreview(client);
    await followChange(el, "lemon-description");
    const renderer = await content(el);
    expect(renderer.view).toEqual({ kind: "customer", language: "en" });
    expect(renderer.shadowRoot!.textContent).toContain("Proposed fresh lemon");
    const reads = client.getMenuPreview.mock.calls.length;
    renderer.shadowRoot!.querySelector<HTMLButtonElement>('[data-variant="v-large"]')!.click();
    await renderer.updateComplete;
    expect(
      renderer.shadowRoot!.querySelector('[data-variant="v-large"]')!.getAttribute("aria-pressed"),
    ).toBe("true");
    setLocale("es-ES");
    await panel(el).updateComplete;
    await renderer.updateComplete;
    expect(renderer.view).toEqual({ kind: "customer", language: "en" });
    expect(renderer.shadowRoot!.textContent).toContain("Proposed fresh lemon");
    const selector = panel(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      'wt-combobox[name="menu-preview-view"]',
    )!;
    await chooseOption(selector, "internal");
    await renderer.updateComplete;
    expect(renderer.view).toEqual({ kind: "internal" });
    expect(renderer.shadowRoot!.textContent).toContain("Lemonade");
    await chooseOption(selector, "es");
    await renderer.updateComplete;
    expect(renderer.view).toEqual({ kind: "customer", language: "es" });
    expect(renderer.shadowRoot!.textContent).toContain("Limón propuesto");
    await followChange(el, "removed-burger");
    expect((await content(el)).shadowRoot!.textContent).toContain("Burger para clientes");
    await followChange(el, "home-columns");
    expect(inPanel(el, "home-target")!.textContent).toContain("Columnas");
    expect(client.getMenuPreview.mock.calls.length).toBe(reads);
    expect(writeCalls(client)).toEqual([]);
    expect(JSON.stringify(snapshot)).toBe(original);
  });

  it("publishes the proposed preview hash while inspecting the removed live dish", async () => {
    const snapshot = navigablePreview();
    const client = api({ getMenuPreview: vi.fn().mockResolvedValue(snapshot) });
    const el = await mountPreview(client);
    await followChange(el, "removed-burger");
    expect((await content(el)).document).toBe(snapshot.live!.document);
    await publish(el);
    expect(client.publishMenu.mock.calls).toEqual([["menu-lunch", LUNCH_HASH]]);
    expect(writeCalls(client)).toEqual(["publishMenu"]);
  });

  it("replaces the whole preview envelope without stealing focus or retaining local variant picks", async () => {
    const live = new LiveData();
    const initial = navigablePreview();
    const refreshed = navigablePreview();
    refreshed.hash = "f".repeat(64);
    refreshed.document.offers["mi-lemonade"]!.description = { en: "New frozen description" };
    refreshed.live!.versionId = "new-live-version";
    refreshed.live!.document.offers["mi-burger"]!.name = "New frozen before name";
    const client = api({ liveData: live, getMenuPreview: vi.fn().mockResolvedValue(initial) });
    const el = await mountPreview(client);
    await followChange(el, "lemon-description");
    const renderer = await content(el);
    renderer.shadowRoot!.querySelector<HTMLButtonElement>('[data-variant="v-large"]')!.click();
    await renderer.updateComplete;
    const back = q<HTMLElement>(el, '[data-test="back"]')!;
    back.focus();
    expect(el.shadowRoot!.activeElement).toBe(back);
    client.getMenuPreview.mockResolvedValue(refreshed);
    live.invalidate([{ type: "products" }]);
    await vi.waitFor(() => expect(panel(el).preview).toBe(refreshed));
    await vi.waitFor(() =>
      expect(renderer.shadowRoot!.textContent).toContain("New frozen description"),
    );
    expect(inPanel(el, "publish-confirmation")).toBeNull();
    expect(el.shadowRoot!.activeElement).toBe(back);
    expect(
      renderer.shadowRoot!.querySelector('[data-variant="v-small"]')!.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      renderer.shadowRoot!.querySelector('[data-variant="v-large"]')!.getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      panel(el)
        .shadowRoot!.querySelector('[data-change-id="lemon-description"]')!
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await followChange(el, "removed-burger");
    expect((await content(el)).document).toBe(refreshed.live!.document);
    expect(writeCalls(client)).toEqual([]);
  });

  it("retires the previous preview warning approval when a new envelope arrives", async () => {
    const live = new LiveData();
    const initial = navigablePreview();
    const next = navigablePreview();
    next.hash = "f".repeat(64);
    const client = api({ liveData: live, getMenuPreview: vi.fn().mockResolvedValue(initial) });
    const el = await mountPreview(client);
    inPanel(el, "publish")!.click();
    await panel(el).updateComplete;
    const retired = inPanel(el, "publish-confirm")!;
    expect(inPanel(el, "publish-confirmation")).not.toBeNull();
    client.getMenuPreview.mockResolvedValue(next);
    live.invalidate([{ type: "products" }]);
    await vi.waitFor(() => expect(panel(el).preview).toBe(next));
    expect(inPanel(el, "publish-confirmation")).toBeNull();
    retired.click();
    await el.updateComplete;
    expect(writeCalls(client)).toEqual([]);
    await publish(el);
    expect(client.publishMenu.mock.calls).toEqual([["menu-lunch", "f".repeat(64)]]);
  });

  it("hides an out-of-date preview until its replacement arrives and retries with the new hash", async () => {
    const replacement = deferred<MenuPreview>();
    const initial = navigablePreview();
    const next = navigablePreview();
    next.hash = "e".repeat(64);
    const client = api({
      getMenuPreview: vi.fn().mockResolvedValueOnce(initial).mockReturnValue(replacement.promise),
      publishMenu: vi
        .fn()
        .mockRejectedValueOnce({ code: "menu.changed_since_preview" })
        .mockResolvedValue({ versionId: "v3", number: 3 }),
    });
    const el = await mountPreview(client);
    await publish(el);
    await vi.waitFor(() => expect(inPanel(el, "preview-loading")).not.toBeNull());
    expect(inPanel(el, "publish")).toBeNull();
    expect(inPanel(el, "document")).toBeNull();
    replacement.resolve(next);
    await vi.waitFor(() => expect(panel(el).preview).toBe(next));
    await publish(el);
    expect(client.publishMenu.mock.calls).toEqual([
      ["menu-lunch", LUNCH_HASH],
      ["menu-lunch", "e".repeat(64)],
    ]);
  });

  it.each(["success", "refusal"])(
    "ignores a previous menu's late preview %s after navigation",
    async (answer) => {
      const live = new LiveData();
      const oldRead = deferred<MenuPreview>();
      const initial = navigablePreview();
      const dinner = dinnerPreview();
      dinner.document.menuId = "menu-dinner";
      dinner.document.menuName = "Frozen dinner title";
      let lunchReads = 0;
      const client = api({
        liveData: live,
        getMenuPreview: vi.fn((id: string) => {
          if (id === "menu-dinner") return Promise.resolve(dinner);
          return ++lunchReads === 1 ? Promise.resolve(initial) : oldRead.promise;
        }),
      });
      const el = await mountPreview(client);
      await followChange(el, "lemon-description");
      live.invalidate([{ type: "products" }]);
      await vi.waitFor(() => expect(lunchReads).toBe(2));
      history.pushState(null, "", "/manage/menus/menu/menu-dinner/view/preview");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await vi.waitFor(() => expect(panel(el).preview).toBe(dinner));
      if (answer === "success") oldRead.resolve(initial);
      else oldRead.reject({ code: "menu.reset_required" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await el.updateComplete;
      const renderer = await content(el);
      expect(panel(el).preview).toBe(dinner);
      expect(renderer.document!.menuId).toBe("menu-dinner");
      expect(renderer.view).toEqual({ kind: "customer", language: "es" });
      expect(renderer.shadowRoot!.textContent).toContain("Frozen dinner title");
      expect(renderer.shadowRoot!.textContent).not.toContain("Proposed fresh lemon");
      expect(inPanel(el, "preview-error")).toBeNull();
      expect(inPanel(el, "return-change")).toBeNull();
      expect(writeCalls(client)).toEqual([]);
    },
  );

  it.each(
    (["en", "es-ES"] as const).flatMap((locale) =>
      (["light", "dark"] as const).flatMap((theme) =>
        [390, 1280].map((width) => ({ locale, theme, width })),
      ),
    ),
  )(
    "keeps dense Preview accessible and within the full screen at $locale $theme $width",
    async ({ locale, theme, width }) => {
      registerIcons(DASHBOARD_ICONS);
      setLocale(locale);
      await page.viewport(width, 844);
      expect(window.innerWidth).toBe(width);
      const snapshot = navigablePreview();
      const name = "VeryLongUnbrokenMenuTitle".repeat(8);
      snapshot.document.menuName = name;
      snapshot.document.offers["mi-lemonade"]!.customerName = { en: "GuestLemonade".repeat(15) };
      const section = snapshot.document.root.members[0]!;
      if (section.kind !== "section") throw new Error("section fixture");
      section.names = { en: "LongUnbrokenSectionName".repeat(10) };
      section.members.push(
        ...Array.from({ length: 12 }, (_, n) =>
          documentSection(`empty-${n}`, `Empty section ${n}`, []),
        ),
      );
      snapshot.live!.document.root.members.push(
        documentSection("removed-empty", "RemovedEmptySection".repeat(10), []),
      );
      snapshot.changes.push({
        id: "removed-empty",
        kind: "section_removed",
        sectionId: "removed-empty",
        parentSectionIds: [],
        name: "RemovedEmptySection".repeat(10),
        under: [],
        source: "this_menu",
        targets: {
          before: [{ kind: "section", sectionIds: ["removed-empty"], field: { kind: "summary" } }],
          after: [],
        },
      });
      const client = api({
        listCatalogues: vi.fn().mockResolvedValue([{ ...menus[0]!, name }]),
        getMenuPreview: vi.fn().mockResolvedValue(snapshot),
      });
      const el = await mount(client, PREVIEW_PATH, theme);
      await vi.waitFor(() => expect(inPanel(el, "changes")).not.toBeNull());
      const panes = () => [
        inPanel(el, "document-pane")!.getBoundingClientRect(),
        inPanel(el, "changes-pane")!.getBoundingClientRect(),
      ];
      const checkWidth = () => {
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
        for (const id of ["document-pane", "changes-pane"])
          expect(inPanel(el, id)!.scrollWidth).toBeLessThanOrEqual(inPanel(el, id)!.clientWidth);
      };
      checkWidth();
      const [left, right] = panes();
      if (width === 1280) {
        expect(right!.left).toBeGreaterThanOrEqual(left!.right);
        expect(Math.abs(right!.top - left!.top)).toBeLessThan(1);
      } else expect(right!.top).toBeGreaterThanOrEqual(left!.bottom);
      expect(inPanel(el, "publish")!.getBoundingClientRect().bottom).toBeLessThanOrEqual(left!.top);
      const selector = panel(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
        'wt-combobox[name="menu-preview-view"]',
      )!;
      for (const view of ["es", "en", "internal"]) {
        await chooseOption(selector, view);
        await (
          await content(el)
        ).updateComplete;
        checkWidth();
        await expectNoA11yViolations(el.parentElement!);
      }
      await chooseOption(selector, locale === "en" ? "internal" : "es");
      await (
        await content(el)
      ).updateComplete;
      await page.screenshot({
        element: inPanel(el, "document-pane")!,
        path: `.superpowers/w95-final-screen/${locale}-${theme}-${width}-hierarchy.png`,
      });
      await followChange(el, "lemon-description");
      checkWidth();
      await expectNoA11yViolations(el.parentElement!);
      await page.screenshot({
        element: inPanel(el, "document-pane")!,
        path: `.superpowers/w95-final-screen/${locale}-${theme}-${width}-detail.png`,
      });
      const returnButton = inPanel(el, "return-change")!;
      const menuPane = inPanel(el, "document-pane")!;
      menuPane.scrollTop = menuPane.scrollHeight;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(returnButton.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        menuPane.getBoundingClientRect().top,
      );
      expect(returnButton.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        menuPane.getBoundingClientRect().bottom,
      );
      returnButton.click();
      await panel(el).updateComplete;
      expect(panel(el).shadowRoot!.activeElement?.getAttribute("data-change-id")).toBe(
        "lemon-description",
      );
      panel(el)
        .shadowRoot!.querySelector<HTMLButtonElement>('button[data-change-id="removed-empty"]')!
        .click();
      await vi.waitFor(() => expect(inPanel(el, "before")).not.toBeNull());
      checkWidth();
      await expectNoA11yViolations(el.parentElement!);
      await page.screenshot({
        element: inPanel(el, "document-pane")!,
        path: `.superpowers/w95-final-screen/${locale}-${theme}-${width}-removed.png`,
      });
      await followChange(el, "home-columns");
      checkWidth();
      await expectNoA11yViolations(el.parentElement!);
      await page.screenshot({
        element: inPanel(el, "document-pane")!,
        path: `.superpowers/w95-final-screen/${locale}-${theme}-${width}-home.png`,
      });
      expect(client.getMenuPreview).toHaveBeenCalledTimes(1);
      expect(writeCalls(client)).toEqual([]);
    },
  );

  it.each(["server.internal", "menu.reset_required"])(
    "retires an open preview confirmation when the live read fails with %s",
    async (code) => {
      const live = new LiveData();
      const client = api({ liveData: live });
      const el = await mountPreview(client);
      inPanel(el, "publish")!.click();
      await panel(el).updateComplete;
      const retired = inPanel(el, "publish-confirm")!;
      expect(retired).not.toBeNull();
      client.getMenuPreview.mockRejectedValue({ code });
      live.invalidate([{ type: "products" }]);
      await vi.waitFor(() => expect(inPanel(el, "preview-error")).not.toBeNull());
      expect(inPanel(el, "publish-confirmation")).toBeNull();
      retired.click();
      await el.updateComplete;
      expect(writeCalls(client)).toEqual([]);
      expect(inPanel(el, "publish")).toBeNull();
      expect(inPanel(el, "document")).toBeNull();
    },
  );

  it("refuses a retired preview publish control after a background read failure", async () => {
    const live = new LiveData();
    const snapshot = { ...lunchPreview(), warnings: [] };
    const client = api({ liveData: live, getMenuPreview: vi.fn().mockResolvedValue(snapshot) });
    const el = await mountPreview(client);
    const retired = inPanel(el, "publish")!;
    client.getMenuPreview.mockRejectedValue({ code: "server.internal" });
    live.invalidate([{ type: "products" }]);
    await vi.waitFor(() => expect(inPanel(el, "preview-error")).not.toBeNull());
    retired.click();
    await el.updateComplete;
    expect(writeCalls(client)).toEqual([]);
  });

  it("shows each menu's publication state in the list, from one read for every menu", async () => {
    const client = api({
      listCatalogues: vi
        .fn()
        .mockResolvedValue([
          ...menus,
          { id: "menu-brunch", name: "Brunch Menu", active: true, version: 1 },
        ]),
      getMenuStatuses: vi
        .fn()
        .mockResolvedValue({ ...statuses(), "menu-brunch": { state: "unpublished", clashes: 0 } }),
    });
    const el = await mount(client);
    await table(el).updateComplete;
    await vi.waitFor(() => expect(statusCell(el, "menu-brunch")).toBe("Unpublished"));
    expect(statusCell(el, "menu-lunch")).toBe(
      `Published Version 2 · ${formatIsoMinute(PUBLISHED_AT)}`,
    );
    expect(statusCell(el, "menu-dinner")).toBe(
      `Published Version 5 · ${formatIsoMinute("2026-09-20T18:00:00.000Z")}`,
    );
    expect(client.getMenuStatuses).toHaveBeenCalledTimes(1);
    expect(client.getMenuStatus).not.toHaveBeenCalled();
  });

  it("puts the menus waiting for a publish first when the status heading is pressed", async () => {
    const client = api({
      listCatalogues: vi
        .fn()
        .mockResolvedValue([
          ...menus,
          { id: "menu-brunch", name: "Brunch Menu", active: true, version: 1 },
        ]),
      getMenuStatuses: vi
        .fn()
        .mockResolvedValue({ ...statuses(), "menu-brunch": { state: "unpublished", clashes: 0 } }),
    });
    const el = await mount(client);
    await vi.waitFor(() => expect(statusCell(el, "menu-brunch")).toBe("Unpublished"));
    table(el).shadowRoot.querySelector<HTMLElement>('button[data-sort="status"]')!.click();
    await table(el).updateComplete;
    expect(
      [...table(el).shadowRoot.querySelectorAll("tbody tr")].map((row) =>
        row.getAttribute("data-row-key"),
      ),
    ).toEqual(["menu-brunch", "menu-lunch", "menu-dinner"]);
  });

  it("says in the editor when the menu's state could not be checked", async () => {
    const el = await mount(
      api({ getMenuStatus: vi.fn().mockRejectedValue(new Error("offline")) }),
      LUNCH_PATH,
    );
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="menu-status"]'))).toBe("Could not be checked"),
    );
    cleanupWidgets();

    const onPreview = await mount(
      api({ getMenuPreview: vi.fn().mockRejectedValue(new Error("offline")) }),
      PREVIEW_PATH,
    );
    await vi.waitFor(() =>
      expect(text(q(onPreview, '[data-test="menu-status"]'))).toBe("Could not be checked"),
    );
    await vi.waitFor(() =>
      expect(text(inPanel(onPreview, "live"))).toBe("The live version could not be checked."),
    );
  });

  it("keeps the state it read on another tab when the preview cannot be read", async () => {
    const client = api({ getMenuPreview: vi.fn().mockRejectedValue(new Error("offline")) });
    const el = await mountLunch(client);
    const shown = `Unpublished changes · Live: version 2 · ${formatIsoMinute(PUBLISHED_AT)}`;
    await vi.waitFor(() => expect(text(q(el, '[data-test="menu-status"]'))).toBe(shown));
    await chooseTab(el, "preview");
    await vi.waitFor(() => expect(inPanel(el, "preview-error")).not.toBeNull());
    expect(text(q(el, '[data-test="menu-status"]'))).toBe(shown);
    expect(text(inPanel(el, "live"))).toBe(`Version 2, published ${formatIsoMinute(PUBLISHED_AT)}`);
  });

  it("says a menu's state could not be checked, still listing the menus", async () => {
    const el = await mount(
      api({ getMenuStatuses: vi.fn().mockRejectedValue(new Error("offline")) }),
    );
    await table(el).updateComplete;
    await vi.waitFor(() => expect(statusCell(el, "menu-lunch")).toBe("Could not be checked"));
    expect(q(el, '[data-test="load-error"]')).toBeNull();
  });

  it("reads every menu's state again when the person retries a failed load", async () => {
    const client = api({
      listCatalogues: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(menus),
      getMenuStatuses: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(statuses()),
    });
    const el = await mount(client);
    expect(q(el, '[data-test="load-error"]')).not.toBeNull();
    await click(el, "retry");
    await vi.waitFor(() => expect(table(el)).not.toBeNull());
    await vi.waitFor(async () => {
      await table(el).updateComplete;
      expect(statusCell(el, "menu-dinner")).toBe(
        `Published Version 5 · ${formatIsoMinute("2026-09-20T18:00:00.000Z")}`,
      );
    });
    expect(client.getMenuStatuses).toHaveBeenCalledTimes(2);
  });

  it("keeps the open menu's state and reads its preview again when a failed load is retried on the Preview tab", async () => {
    const client = api({
      listCatalogues: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(menus),
    });
    const el = await mount(client, PREVIEW_PATH);
    expect(q(el, '[data-test="load-error"]')).not.toBeNull();
    const shown = `Unpublished changes · Live: version 2 · ${formatIsoMinute(PUBLISHED_AT)}`;
    await vi.waitFor(() => expect(text(q(el, '[data-test="menu-status"]'))).toBe(shown));
    const previews = client.getMenuPreview.mock.calls.length;
    await click(el, "retry");
    expect(text(q(el, '[data-test="menu-status"]'))).toBe(shown);
    await vi.waitFor(() => expect(client.getMenuPreview.mock.calls.length).toBe(previews + 1));
    await vi.waitFor(() => expect(q(el, '[data-test="load-error"]')).toBeNull());
    expect(text(q(el, '[data-test="menu-status"]'))).toBe(shown);
    expect(client.getMenuStatus).not.toHaveBeenCalled();
  });

  it("lists the status column, with a column chooser offering status and changes", async () => {
    setLocale("es-ES");
    const el = await mount();
    const headerTexts = () =>
      [...table(el).shadowRoot.querySelectorAll("thead th")].map((th) => text(th));
    await vi.waitFor(async () => {
      await table(el).updateComplete;
      expect(headerTexts()).toContain(t("menus.status"));
    });
    const root = table(el).shadowRoot;
    expect(root.querySelector(".columns-trigger")).not.toBeNull();
    expect(
      [...root.querySelectorAll<HTMLInputElement>("input[data-column]")].map(
        (input) => input.dataset.column,
      ),
    ).toEqual(["status", "changes"]);
  });

  it("shows each menu's state under its name on a phone-width list, with no status column", async () => {
    const reported: string[] = [];
    const report = (event: ErrorEvent) => reported.push(event.message);
    window.addEventListener("error", report);
    onTestFinished(() => window.removeEventListener("error", report));
    const el = await mount();
    await page.viewport(390, 844);
    await vi.waitFor(async () => {
      await table(el).updateComplete;
      expect(
        [...table(el).shadowRoot.querySelectorAll("thead th")].map((th) => text(th)),
      ).not.toContain("Status");
    });
    const lunchRow = table(el).shadowRoot.querySelector('tr[data-row-key="menu-lunch"]')!;
    await vi.waitFor(() =>
      expect(text(lunchRow.querySelector("td"))).toBe(
        `Lunch Menu Published Version 2 · ${formatIsoMinute(PUBLISHED_AT)} Unpublished changes`,
      ),
    );
    const scroll = table(el).shadowRoot.querySelector<HTMLElement>(".scroll")!;
    expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
    await page.viewport(1280, 900);
    await vi.waitFor(async () => {
      await table(el).updateComplete;
      expect(
        [...table(el).shadowRoot.querySelectorAll("thead th")].map((th) => text(th)),
      ).toContain("Status");
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(reported).toEqual([]);
  });

  it("sorts by name, and shows it, when a list sorted by status turns phone-width", async () => {
    const client = api({
      listCatalogues: vi
        .fn()
        .mockResolvedValue([
          ...menus,
          { id: "menu-brunch", name: "Brunch Menu", active: true, version: 1 },
        ]),
      getMenuStatuses: vi
        .fn()
        .mockResolvedValue({ ...statuses(), "menu-brunch": { state: "unpublished", clashes: 0 } }),
    });
    const el = await mount(client);
    await vi.waitFor(() => expect(statusCell(el, "menu-brunch")).toBe("Unpublished"));
    table(el).shadowRoot.querySelector<HTMLElement>('button[data-sort="status"]')!.click();
    await table(el).updateComplete;
    const order = () =>
      [...table(el).shadowRoot.querySelectorAll("tbody tr")].map((row) =>
        row.getAttribute("data-row-key"),
      );
    expect(order()).toEqual(["menu-brunch", "menu-lunch", "menu-dinner"]);
    await page.viewport(390, 844);
    await vi.waitFor(() => expect(order()).toEqual(["menu-brunch", "menu-dinner", "menu-lunch"]));
    const sorted = [...table(el).shadowRoot.querySelectorAll("thead th")].filter(
      (th) => th.getAttribute("aria-sort") === "ascending",
    );
    expect(sorted.map((th) => text(th))).toEqual(["Name▲"]);
  });

  it("follows every menu's state on the list alone, and one menu's in its editor", async () => {
    const live = new LiveData();
    const client = api({ liveData: live });
    const el = await mount(client);
    await vi.waitFor(() => expect(client.getMenuStatuses).toHaveBeenCalledTimes(1));
    await inTable(el, "open-menu-lunch");
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="menu-status"]'))).toBe(
        `Unpublished changes · Live: version 2 · ${formatIsoMinute(PUBLISHED_AT)}`,
      ),
    );
    expect(client.getMenuStatus).toHaveBeenCalledWith("menu-lunch");
    const one = client.getMenuStatus.mock.calls.length;
    live.invalidate([{ type: "menu_publications" }]);
    await vi.waitFor(() => expect(client.getMenuStatus.mock.calls.length).toBe(one + 1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.getMenuStatuses).toHaveBeenCalledTimes(1);
    await click(el, "back");
    await vi.waitFor(() => expect(client.getMenuStatuses).toHaveBeenCalledTimes(2));
    live.invalidate([{ type: "menu_publications" }]);
    await vi.waitFor(() => expect(client.getMenuStatuses).toHaveBeenCalledTimes(3));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.getMenuStatus.mock.calls.length).toBe(one + 1);
  });

  it("keeps the Preview tab in the address, and reads the preview only while that tab is open", async () => {
    const live = new LiveData();
    const client = api({ liveData: live });
    const el = await mountLunch(client);
    expect(client.getMenuPreview).not.toHaveBeenCalled();
    await chooseTab(el, "preview");
    expect(location.pathname).toBe(PREVIEW_PATH);
    await vi.waitFor(() =>
      expect(
        [...panel(el).shadowRoot!.querySelectorAll('[data-test="changes"] li')].map(text),
      ).toEqual([
        "Chips added under Drinks — this menu",
        "Lemonade: allergens — shared product, also on Dinner Menu",
      ]),
    );
    expect(client.getMenuPreview).toHaveBeenCalledWith("menu-lunch");
    expect(text(inPanel(el, "live"))).toBe(`Version 2, published ${formatIsoMinute(PUBLISHED_AT)}`);
    expect(text(inPanel(el, "warnings"))).toBe(
      "1 shortcut on Lunch Menu's Device Home Page points at something no longer in this menu. It stays as an empty space until you remove it.",
    );
    const reads = client.getMenuPreview.mock.calls.length;
    await chooseTab(el, "structure");
    const structureReads = client.getMenuStructure.mock.calls.length;
    live.invalidate([{ type: "section_members" }, { type: "products" }]);
    await vi.waitFor(() =>
      expect(client.getMenuStructure.mock.calls.length).toBeGreaterThan(structureReads),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.getMenuPreview.mock.calls.length).toBe(reads);
    await chooseTab(el, "preview");
    await vi.waitFor(() => expect(client.getMenuPreview.mock.calls.length).toBe(reads + 1));
    await click(el, "back");
    live.invalidate([{ type: "products" }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.getMenuPreview.mock.calls.length).toBe(reads + 1);
  });

  it("follows the open menu's state through its preview alone while the Preview tab is shown", async () => {
    const live = new LiveData();
    const client = api({ liveData: live });
    const el = await mountLunch(client);
    await vi.waitFor(() => expect(client.getMenuStatus).toHaveBeenCalledWith("menu-lunch"));
    await chooseTab(el, "preview");
    await vi.waitFor(() => expect(inPanel(el, "changes")).not.toBeNull());
    const statusReads = client.getMenuStatus.mock.calls.length;
    const previews = client.getMenuPreview.mock.calls.length;
    client.getMenuPreview.mockResolvedValue({
      ...lunchPreview(),
      status: {
        state: "changed",
        clashes: 0,
        version: 3,
        publishedAt: PUBLISHED_AT,
        hash: LUNCH_LIVE_HASH,
      },
    });
    live.invalidate([{ type: "menu_publications" }]);
    await vi.waitFor(() => expect(client.getMenuPreview.mock.calls.length).toBe(previews + 1));
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="menu-status"]'))).toBe(
        `Unpublished changes · Live: version 3 · ${formatIsoMinute(PUBLISHED_AT)}`,
      ),
    );
    expect(text(inPanel(el, "live"))).toBe(`Version 3, published ${formatIsoMinute(PUBLISHED_AT)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.getMenuStatus.mock.calls.length).toBe(statusReads);
    const held = deferred<MenuStatus>();
    client.getMenuStatus.mockReturnValueOnce(held.promise);
    await chooseTab(el, "structure");
    await vi.waitFor(() => expect(client.getMenuStatus.mock.calls.length).toBe(statusReads + 1));
    await el.updateComplete;
    expect(text(q(el, '[data-test="menu-status"]'))).toBe(
      `Unpublished changes · Live: version 3 · ${formatIsoMinute(PUBLISHED_AT)}`,
    );
    held.resolve(statuses()["menu-lunch"]!);
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="menu-status"]'))).toBe(
        `Unpublished changes · Live: version 2 · ${formatIsoMinute(PUBLISHED_AT)}`,
      ),
    );
    live.invalidate([{ type: "menu_publications" }]);
    await vi.waitFor(() => expect(client.getMenuStatus.mock.calls.length).toBe(statusReads + 2));
    expect(client.getMenuPreview.mock.calls.length).toBe(previews + 1);
    cleanupWidgets();

    const opened = api({ liveData: new LiveData() });
    const direct = await mountPreview(opened);
    await vi.waitFor(() =>
      expect(text(q(direct, '[data-test="menu-status"]'))).toBe(
        `Unpublished changes · Live: version 2 · ${formatIsoMinute(PUBLISHED_AT)}`,
      ),
    );
    expect(opened.getMenuStatus).not.toHaveBeenCalled();
  });

  it("publishes the hash it previewed, names the one menu, and says the new version is live", async () => {
    const client = api();
    const el = await mountPreview(client);
    expect(text(inPanel(el, "publish"))).toBe("Publish Lunch Menu");
    const previews = client.getMenuPreview.mock.calls.length;
    client.getMenuPreview.mockResolvedValue({
      ...lunchPreview(),
      changes: [],
      warnings: [],
      status: {
        state: "current",
        clashes: 0,
        version: 3,
        publishedAt: "2026-09-26T11:00:00.000Z",
        hash: LUNCH_HASH,
      },
    });
    await publish(el);
    await vi.waitFor(() =>
      expect(text(inPanel(el, "result"))).toBe(
        "Lunch Menu version 3 is now live. 1 shortcut on Lunch Menu's Device Home Page points at something no longer in this menu. It stays as an empty space until you remove it.",
      ),
    );
    expect(client.publishMenu).toHaveBeenCalledWith("menu-lunch", LUNCH_HASH);
    expect(writeCalls(client)).toEqual(["publishMenu"]);
    await vi.waitFor(() => expect(inPanel(el, "nothing")).not.toBeNull());
    expect(client.getMenuPreview.mock.calls.length).toBeGreaterThan(previews);
    expect(client.getMenuStatus).not.toHaveBeenCalled();
    expect(inPanel(el, "publish")).toBeNull();
    expect(text(q(el, '[data-test="menu-status"]'))).toBe(
      `Published · Version 3 · ${formatIsoMinute("2026-09-26T11:00:00.000Z")}`,
    );
  });

  it("shows the version it published in the header when the preview cannot be read again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    vi.setSystemTime(new Date("2026-09-26T11:00:00.000Z"));
    const client = api();
    const el = await mountPreview(client);
    client.getMenuPreview.mockRejectedValue(new Error("offline"));
    await publish(el);
    await vi.waitFor(() =>
      expect(text(inPanel(el, "result"))).toBe(
        "Lunch Menu version 3 is now live. 1 shortcut on Lunch Menu's Device Home Page points at something no longer in this menu. It stays as an empty space until you remove it.",
      ),
    );
    await vi.waitFor(() => expect(inPanel(el, "preview-error")).not.toBeNull());
    expect(text(q(el, '[data-test="menu-status"]'))).toBe(
      `Published · Version 3 · ${formatIsoMinute("2026-09-26T11:00:00.000Z")}`,
    );
    expect(text(inPanel(el, "live"))).toBe(
      `Version 3, published ${formatIsoMinute("2026-09-26T11:00:00.000Z")}`,
    );
    cleanupWidgets();

    // Answered with the version already live, as when that content was published already: its
    // own publication time stays.
    const again = api({ publishMenu: vi.fn().mockResolvedValue({ versionId: "v2", number: 2 }) });
    const kept = await mountPreview(again);
    again.getMenuPreview.mockRejectedValue(new Error("offline"));
    await publish(kept);
    await vi.waitFor(() => expect(inPanel(kept, "preview-error")).not.toBeNull());
    expect(text(q(kept, '[data-test="menu-status"]'))).toBe(
      `Published · Version 2 · ${formatIsoMinute(PUBLISHED_AT)}`,
    );
  });

  it("sends one publish while one is out", async () => {
    const out = deferred<{ versionId: string; number: number }>();
    const client = api({ publishMenu: vi.fn(() => out.promise) });
    const el = await mountPreview(client);
    await publish(el);
    await publish(el);
    expect(client.publishMenu).toHaveBeenCalledTimes(1);
    out.resolve({ versionId: "v-lunch-3", number: 3 });
    await vi.waitFor(() => expect(inPanel(el, "result")).not.toBeNull());
  });

  it("previews again and says the menu changed when a publish is refused as out of date", async () => {
    const client = api({
      publishMenu: vi.fn().mockRejectedValue({ code: "menu.changed_since_preview", status: 409 }),
    });
    const el = await mountPreview(client);
    const reads = client.getMenuPreview.mock.calls.length;
    client.getMenuPreview.mockResolvedValue({
      ...lunchPreview(),
      hash: "e".repeat(64),
      changes: [
        {
          id: "stale-refresh-burger",
          targets: { before: [], after: [] },
          kind: "price_changed",
          productId: "p-burger",
          name: "Burger",
          from: "12.00",
          to: "13.00",
          source: "shared_product",
          alsoOn: ["Dinner Menu"],
        },
      ],
    });
    await publish(el);
    await vi.waitFor(() =>
      expect(text(inPanel(el, "result"))).toBe(codeMessage("menu.changed_since_preview")),
    );
    await vi.waitFor(() =>
      expect(text(inPanel(el, "changes"))).toBe(
        "Burger price changed from €12.00 to €13.00 — shared product, also on Dinner Menu",
      ),
    );
    expect(client.getMenuPreview.mock.calls.length).toBe(reads + 1);
    await publish(el);
    expect(client.publishMenu).toHaveBeenLastCalledWith("menu-lunch", "e".repeat(64));
  });

  it("says a failed publish left the live version in place and the changes saved", async () => {
    const client = api({
      publishMenu: vi.fn().mockRejectedValue({ code: "server.internal", status: 500 }),
    });
    const el = await mountPreview(client);
    await publish(el);
    await vi.waitFor(() =>
      expect(text(inPanel(el, "result"))).toBe(
        `Lunch Menu was not published: version 2 is still live. Your changes are still saved. ${codeMessage("server.internal")}`,
      ),
    );
    expect(writeCalls(client)).toEqual(["publishMenu"]);
    expect(inPanel(el, "changes")).not.toBeNull();
    expect(text(inPanel(el, "publish"))).toBe("Publish Lunch Menu");
  });

  describe("a publish refused because a scheduled version would go live out of order", () => {
    const OVERTAKEN = {
      code: "menu_publication.overtakes_queued",
      status: 409,
      params: {
        menuId: "menu-lunch",
        overtaken: [{ versionId: "v-lunch-2", number: 2, activatesAt: "2026-10-08T06:00:00.000Z" }],
      },
    };
    const QUEUED = {
      timeZone: "Europe/Madrid",
      live: null,
      editions: [
        {
          versionId: "v-lunch-2",
          number: 2,
          state: "queued" as const,
          activatesAt: "2026-10-08T06:00:00.000Z",
          queuedAt: "2026-10-07T08:00:00.000Z",
          cancelledAt: null,
          contentHash: "2".repeat(64),
          local: { date: "2026-10-08", time: "08:00", offset: "+02:00", repeated: false },
        },
      ],
    };

    /** Lunch with version 1 live, so the scheduled version 2 is the one in the way. */
    function refusedClient(warnings: MenuPreview["warnings"], refusal: unknown = OVERTAKEN) {
      return api({
        getMenuPreview: vi.fn(async () => ({
          ...lunchPreview(),
          warnings,
          status: { ...statuses()["menu-lunch"]!, version: 1 },
        })),
        publishMenu: vi.fn().mockRejectedValue(refusal),
        getMenuPublications: vi.fn().mockResolvedValue(QUEUED),
      });
    }

    function expectPublishOfferedAgain(el: MenusScreen): void {
      const button = inPanel(el, "publish") as HTMLElementTagNameMap["wt-button"];
      expect(text(button)).toBe(t("menu_preview.publish").replace("{menu}", "Lunch Menu"));
      expect(button.disabled).toBe(false);
      expect(button.loading).toBe(false);
    }

    it.each([
      [
        "en",
        "Lunch Menu was not published: version 1 is still live. Your changes are still saved. Version 2, scheduled for 8 Oct 2026, 08:00, must go live first. Cancel it, or publish once it is live.",
      ],
      [
        "es-ES",
        "No se ha publicado Lunch Menu: la versión 1 sigue publicada. Tus cambios siguen guardados. La versión 2, programada para el 8 oct 2026, 08:00, debe publicarse antes. Cancélala o publica cuando ya esté publicada.",
      ],
    ])("names the scheduled version in the way, in %s", async (locale, expected) => {
      const before = currentLocale();
      onTestFinished(() => setLocale(before));
      setLocale(locale);
      const client = refusedClient([]);
      const el = await mountPreview(client);
      await publish(el);
      await vi.waitFor(() => expect(text(inPanel(el, "result"))).toBe(expected));
      expect(client.publishMenu.mock.calls).toEqual([["menu-lunch", LUNCH_HASH]]);
      expect(client.getMenuPublications).toHaveBeenLastCalledWith("menu-lunch");
      expect(writeCalls(client)).toEqual(["publishMenu"]);
      expectPublishOfferedAgain(el);
    });

    it("names it the same way after the warnings are confirmed", async () => {
      const client = refusedClient(lunchPreview().warnings);
      const el = await mountPreview(client);
      inPanel(el, "publish")!.click();
      await panel(el).updateComplete;
      expect(inPanel(el, "publish-confirmation")).not.toBeNull();
      inPanel(el, "publish-confirm")!.click();
      await el.updateComplete;
      await vi.waitFor(() =>
        expect(text(inPanel(el, "result"))).toBe(
          "Lunch Menu was not published: version 1 is still live. Your changes are still saved. Version 2, scheduled for 8 Oct 2026, 08:00, must go live first. Cancel it, or publish once it is live.",
        ),
      );
      expect(inPanel(el, "publish-confirmation")).toBeNull();
      expect(client.publishMenu.mock.calls).toEqual([["menu-lunch", LUNCH_HASH]]);
      expect(writeCalls(client)).toEqual(["publishMenu"]);
      expectPublishOfferedAgain(el);
    });

    it("falls back to the general refusal when the scheduled versions cannot be read", async () => {
      const client = refusedClient([]);
      const el = await mountPreview(client);
      await vi.waitFor(() => expect(client.getMenuPublications).toHaveBeenCalled());
      client.getMenuPublications.mockRejectedValue(new Error("offline"));
      await publish(el);
      await vi.waitFor(() =>
        expect(text(inPanel(el, "result"))).toBe(
          `Lunch Menu was not published: version 1 is still live. Your changes are still saved. ${codeMessage("menu_publication.overtakes_queued")}`,
        ),
      );
      expect(client.publishMenu.mock.calls).toEqual([["menu-lunch", LUNCH_HASH]]);
      expect(writeCalls(client)).toEqual(["publishMenu"]);
    });

    it("gives the general refusal without reading the list when the refusal names no versions", async () => {
      const client = refusedClient([], { ...OVERTAKEN, params: { menuId: "menu-lunch" } });
      const el = await mountPreview(client);
      await vi.waitFor(() => expect(client.getMenuPublications).toHaveBeenCalled());
      const reads = client.getMenuPublications.mock.calls.length;
      await publish(el);
      await vi.waitFor(() =>
        expect(text(inPanel(el, "result"))).toBe(
          `Lunch Menu was not published: version 1 is still live. Your changes are still saved. ${codeMessage("menu_publication.overtakes_queued")}`,
        ),
      );
      expect(client.getMenuPublications.mock.calls.length).toBe(reads);
    });

    it("gives the general failure, and offers Publish again, when the refusal carries nothing", async () => {
      const client = refusedClient([]);
      client.publishMenu.mockRejectedValue(undefined);
      const el = await mountPreview(client);
      await vi.waitFor(() => expect(client.getMenuPublications).toHaveBeenCalled());
      const reads = client.getMenuPublications.mock.calls.length;
      await publish(el);
      await vi.waitFor(() =>
        expect(text(inPanel(el, "result"))).toBe(
          `Lunch Menu was not published: version 1 is still live. Your changes are still saved. ${codeMessage("server.internal")}`,
        ),
      );
      expectPublishOfferedAgain(el);
      expect(client.getMenuPublications.mock.calls.length).toBe(reads);
    });

    it("names the scheduled version beside the list when the refusal lands after the person left", async () => {
      const out = deferred<never>();
      const client = refusedClient([]);
      client.publishMenu.mockImplementation(() => out.promise);
      const el = await mountPreview(client);
      await publish(el);
      await click(el, "back");
      out.reject(OVERTAKEN);
      await vi.waitFor(() =>
        expect(text(q(el, '[data-test="member-error"]'))).toBe(
          "Lunch Menu was not published: version 1 is still live. Your changes are still saved. Version 2, scheduled for 8 Oct 2026, 08:00, must go live first. Cancel it, or publish once it is live.",
        ),
      );
    });
  });

  it("names the menu beside the list when its publish fails after the person has left it", async () => {
    const out = deferred<never>();
    const client = api({ publishMenu: vi.fn(() => out.promise) });
    const el = await mountPreview(client);
    await publish(el);
    await click(el, "back");
    out.reject({ code: "server.internal" });
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="member-error"]'))).toBe(
        `Lunch Menu was not published: version 2 is still live. Your changes are still saved. ${codeMessage("server.internal")}`,
      ),
    );
  });

  it("finishes a publish quietly when the person has left the menu, and names one refused as out of date", async () => {
    const published = deferred<{ versionId: string; number: number }>();
    const client = api({ publishMenu: vi.fn(() => published.promise) });
    const el = await mountPreview(client);
    await publish(el);
    await click(el, "back");
    published.resolve({ versionId: "v-lunch-3", number: 3 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(q(el, '[data-test="member-error"]')).toBeNull();
    cleanupWidgets();

    const stale = deferred<never>();
    const again = api({ publishMenu: vi.fn(() => stale.promise) });
    const other = await mountPreview(again);
    await publish(other);
    await click(other, "back");
    stale.reject({ code: "menu.changed_since_preview" });
    await vi.waitFor(() =>
      expect(text(q(other, '[data-test="member-error"]'))).toBe(
        `Lunch Menu was not published: version 2 is still live. Your changes are still saved. ${codeMessage("menu.changed_since_preview")}`,
      ),
    );
  });

  it("keeps each menu's publish apart: another menu publishes while one's publish is out", async () => {
    const lunchOut = deferred<{ versionId: string; number: number }>();
    const client = api({
      publishMenu: vi.fn((id: string) =>
        id === "menu-lunch" ? lunchOut.promise : Promise.resolve({ versionId: "v-d", number: 6 }),
      ),
    });
    const el = await mountPreview(client);
    await publish(el);
    const button = () => inPanel(el, "publish") as HTMLElementTagNameMap["wt-button"] | null;
    expect(button()!.loading).toBe(true);
    history.pushState(null, "", "/manage/menus/menu/menu-dinner/view/preview");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(text(inPanel(el, "publish"))).toBe("Publish Dinner Menu"));
    expect(button()!.loading).toBe(false);
    await publish(el);
    expect(client.publishMenu).toHaveBeenLastCalledWith("menu-dinner", "c".repeat(64));
    await vi.waitFor(() =>
      expect(text(inPanel(el, "result"))).toBe("Dinner Menu version 6 is now live."),
    );
    history.back();
    await vi.waitFor(() => expect(text(inPanel(el, "publish"))).toBe("Publishing Lunch Menu…"));
    expect(button()!.loading).toBe(true);
    lunchOut.resolve({ versionId: "v-lunch-3", number: 3 });
    await vi.waitFor(() =>
      expect(text(inPanel(el, "result"))).toBe(
        "Lunch Menu version 3 is now live. 1 shortcut on Lunch Menu's Device Home Page points at something no longer in this menu. It stays as an empty space until you remove it.",
      ),
    );
  });

  it("never shows a preview that lands after the person has gone to another menu", async () => {
    const lunchPreviewRead = deferred<MenuPreview>();
    const client = api({
      getMenuPreview: vi.fn((id: string) =>
        id === "menu-lunch" ? lunchPreviewRead.promise : Promise.resolve(dinnerPreview()),
      ),
    });
    const el = await mount(client, PREVIEW_PATH);
    await vi.waitFor(() => expect(inPanel(el, "preview-loading")).not.toBeNull());
    history.pushState(null, "", "/manage/menus/menu/menu-dinner/view/preview");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(inPanel(el, "no-changes")).not.toBeNull());
    lunchPreviewRead.resolve(lunchPreview());
    await new Promise((resolve) => setTimeout(resolve, 50));
    await el.updateComplete;
    expect(inPanel(el, "changes")).toBeNull();
    expect(inPanel(el, "warnings")).toBeNull();
    expect(text(inPanel(el, "publish"))).toBe("Publish Dinner Menu");
  });

  it("says there is nothing to publish when the menu matches its live version", async () => {
    const client = api({
      getMenuPreview: vi.fn().mockResolvedValue({
        clashes: [],
        hash: LUNCH_HASH,
        changes: [],
        warnings: [],
        status: {
          state: "current",
          clashes: 0,
          version: 2,
          publishedAt: PUBLISHED_AT,
          hash: LUNCH_HASH,
        },
        document: lunchDocument(),
      }),
    });
    const el = await mount(client, PREVIEW_PATH);
    await vi.waitFor(() =>
      expect(text(inPanel(el, "nothing"))).toBe("Nothing to publish: version 2 matches this menu."),
    );
    expect(inPanel(el, "publish")).toBeNull();
    expect(text(inPanel(el, "document")?.querySelector("h2") ?? null)).toBe(
      "The menu as it is live",
    );
    expect(await wholeMenu(el)).toEqual([
      "Burger para clientes",
      "Drinks para clientes",
      "Lemonade para clientes",
      "Chips para clientes",
    ]);
  });

  /** The names the Preview tab's whole-menu view shows, with every section opened. */
  async function wholeMenu(el: MenusScreen): Promise<string[]> {
    const tree = inPanel(el, "document")!.querySelector<CustomerMenu>("dashboard-customer-menu")!;
    await tree.updateComplete;
    for (;;) {
      const closed = tree.shadowRoot!.querySelector<HTMLElement>('[aria-expanded="false"]');
      if (closed === null) break;
      closed.click();
      await tree.updateComplete;
    }
    return [
      ...tree.shadowRoot!.querySelectorAll(
        ".product .heading > span[lang], .section > [data-change-target] .heading > button > span:first-of-type",
      ),
    ].map(text);
  }

  it("shows the whole menu as the publish would make it live, read-only, from the preview rather than the working structure", async () => {
    const el = await mountPreview();
    expect(text(inPanel(el, "document")!.querySelector("h2"))).toBe(
      "The menu as it will be published",
    );
    const tree = inPanel(el, "document")!.querySelector<CustomerMenu>("dashboard-customer-menu")!;
    expect(tree.document).toEqual(lunchDocument());
    expect(tree.view).toEqual({ kind: "customer", language: "es" });
    expect(await wholeMenu(el)).toEqual([
      "Burger para clientes",
      "Drinks para clientes",
      "Lemonade para clientes",
      "Chips para clientes",
    ]);
    expect(tree.shadowRoot!.textContent).not.toContain("Lager");
    expect(tree.shadowRoot!.textContent).not.toContain("Favourites");
    expect(tree.shadowRoot!.querySelector("[data-test^='edit-']")).toBeNull();
  });

  it("says the changes could not be worked out, and tries again", async () => {
    const client = api({
      getMenuPreview: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(lunchPreview()),
    });
    const el = await mount(client, PREVIEW_PATH);
    await vi.waitFor(() => expect(inPanel(el, "preview-error")).not.toBeNull());
    expect(inPanel(el, "publish")).toBeNull();
    inPanel(el, "preview-retry")!.click();
    await vi.waitFor(() => expect(inPanel(el, "changes")).not.toBeNull());
    expect(inPanel(el, "preview-error")).toBeNull();
  });
});

describe("the Device Home Page row", () => {
  type Picker = HTMLElement & {
    value: string;
    error: string;
    required: boolean;
    disabled: boolean;
    options: { value: string; label: string }[];
    updateComplete: Promise<unknown>;
  };

  /** Opens Lunch's Structure tab and waits for its Device Home Page row. */
  async function mountRow(client: Api = api()) {
    const el = await mountLunch(client);
    await vi.waitFor(() => expect(rowOf(el, "home")).not.toBeNull());
    await settleStructure(el);
    return el;
  }

  function picker(el: MenusScreen, kind: "product" | "section"): Picker {
    return inModal<Picker>(el, "add-shortcut", `wt-combobox[name="shortcut-${kind}"]`);
  }

  async function openPicker(el: MenusScreen, kind: "product" | "section"): Promise<Picker> {
    await rowAction(el, "home", `add-${kind}-shortcut`);
    await vi.waitFor(() => expect(modal(el, "add-shortcut").open).toBe(true));
    return picker(el, kind);
  }

  const shortcutOrder = (el: MenusScreen) =>
    structure(el).home!.shortcuts.map(({ memberId }) => memberId);

  it("follows the menu's home while the Structure or Home page tab shows, and stops on another tab", async () => {
    const live = new LiveData();
    const client = api({ liveData: live });
    const el = await mountRow(client);
    expect(structure(el).home).toEqual(menuHome());
    expect(client.getMenuHome).toHaveBeenCalledWith("menu-lunch");
    const renamed = menuHome();
    renamed.shortcuts[0]!.name = "Big burger";
    client.getMenuHome.mockResolvedValue(renamed);
    live.invalidate([{ type: "sections" }]);
    await vi.waitFor(() => expect(structure(el).home!.shortcuts[0]!.name).toBe("Big burger"));
    await chooseTab(el, "home");
    const onHome = client.getMenuHome.mock.calls.length;
    live.invalidate([{ type: "section_members" }]);
    await vi.waitFor(() => expect(client.getMenuHome.mock.calls.length).toBe(onHome + 1));
    await chooseTab(el, "prices");
    const reads = client.getMenuHome.mock.calls.length;
    live.invalidate([{ type: "sections" }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.getMenuHome.mock.calls.length).toBe(reads);
  });

  it.each(["en", "es-ES"])(
    "offers as product shortcuts only active products the structure reaches, by their path, and as section shortcuts the sections it reaches, included menus' too, leaving out what is already a shortcut (%s)",
    async (locale) => {
      const before = currentLocale();
      setLocale(locale);
      onTestFinished(() => setLocale(before));
      const el = await mountRow();
      // Burger is already a shortcut, Chips is in no list on Lunch, and Old soup is inactive.
      const products = await openPicker(el, "product");
      expect(modal(el, "add-shortcut").heading).toBe(t("home.add_product"));
      expect(products.required).toBe(true);
      expect(products.options).toEqual([
        { value: "p-lager", label: "Drinks › Lager" },
        { value: "p-lemonade", label: "Drinks › Lemonade" },
      ]);
      inModal(el, "add-shortcut", '[data-test="add-shortcut-cancel"]').click();
      await vi.waitFor(() => expect(modal(el, "add-shortcut").open).toBe(false));
      // Drinks is already a shortcut; Desserts is on no menu.
      const sections = await openPicker(el, "section");
      expect(modal(el, "add-shortcut").heading).toBe(t("home.add_section"));
      expect(sections.required).toBe(true);
      expect(sections.options).toEqual([
        { value: "s-beer", label: "Drinks › Beer" },
        { value: "s-fav", label: "Favourites" },
      ]);

      cleanupWidgets();
      const included = await mountRow(
        api({
          getMenuHome: vi.fn().mockResolvedValue(emptyHome("home-lunch")),
          getMenuStructure: vi.fn().mockResolvedValue(
            lunchWith([
              {
                memberId: "m-drinks",
                ref: { kind: "section", sectionId: "included-drinks" },
                internalName: "Drinks",
                includedMenuId: "menu-drinks",
                children: [
                  {
                    memberId: "m-beer",
                    ref: { kind: "section", sectionId: "included-beer" },
                    internalName: "Beer",
                    children: [productNode("m-lager", "p-lager")],
                  },
                ],
              },
            ]),
          ),
        }),
      );
      expect((await openPicker(included, "section")).options).toEqual([
        { value: "included-drinks", label: locale === "en" ? "Menu: Drinks" : "Carta: Drinks" },
        { value: "included-beer", label: "Drinks › Beer" },
      ]);
      inModal(included, "add-shortcut", '[data-test="add-shortcut-cancel"]').click();
      await vi.waitFor(() => expect(modal(included, "add-shortcut").open).toBe(false));
      expect((await openPicker(included, "product")).options).toEqual([
        { value: "p-lager", label: "Drinks › Beer › Lager" },
      ]);
    },
  );

  it("adds the chosen target at once and closes, reading the home again", async () => {
    const client = api();
    const el = await mountRow(client);
    await chooseOption(await openPicker(el, "product"), "p-lager");
    await vi.waitFor(() => expect(modal(el, "add-shortcut").open).toBe(false));
    expect(client.addHomeShortcut).toHaveBeenCalledExactlyOnceWith("menu-lunch", {
      kind: "product",
      productId: "p-lager",
    });
    await vi.waitFor(() => expect(client.getMenuHome).toHaveBeenCalledTimes(2));
    await chooseOption(await openPicker(el, "section"), "s-fav");
    await vi.waitFor(() => expect(modal(el, "add-shortcut").open).toBe(false));
    expect(client.addHomeShortcut).toHaveBeenLastCalledWith("menu-lunch", {
      kind: "section",
      sectionId: "s-fav",
    });
    await vi.waitFor(() => expect(client.getMenuHome).toHaveBeenCalledTimes(3));
    expect(writeCalls(client)).toEqual(["addHomeShortcut", "addHomeShortcut"]);
  });

  it("opens the Device Home Page row once the first shortcut is added to an empty one", async () => {
    const one = { ...menuHome(), shortcuts: menuHome().shortcuts.slice(0, 1) };
    const client = api({
      getMenuHome: vi.fn().mockResolvedValueOnce(emptyHome("home-lunch")).mockResolvedValue(one),
    });
    const el = await mountRow(client);
    expect(rowOf(el, "home/t-burger")).toBeNull();
    await chooseOption(await openPicker(el, "product"), "p-burger");
    await vi.waitFor(() => expect(rowOf(el, "home/t-burger")).not.toBeNull());
    expect(rowOf(el, "home")!.getAttribute("aria-expanded")).toBe("true");
  });

  it.each([
    { code: "menu.shortcut_unreachable", field: true },
    { code: "menu_section.member_duplicate", field: true },
    { code: "server.internal", field: false },
  ])(
    "puts a refused shortcut ($code) under the picker and asks to fix it at the bottom",
    async ({ code, field }) => {
      const client = api({ addHomeShortcut: vi.fn().mockRejectedValue({ code }) });
      const el = await mountRow(client);
      const choice = await openPicker(el, "product");
      await chooseOption(choice, "p-lager");
      await vi.waitFor(() => expect(structure(el).busy).toBe(false));
      await choice.updateComplete;
      expect(modal(el, "add-shortcut").open).toBe(true);
      expect(choice.value).toBe("p-lager");
      expect(choice.error).toBe(field ? codeMessage(code) : "");
      expect(await bottom(el, "add-shortcut")).toBe(
        field ? t("form.fix_fields") : codeMessage(code),
      );
      expect(q(el, '[data-test="member-error"]')).toBeNull();
      expect(client.getMenuHome).toHaveBeenCalledTimes(1);
    },
  );

  it("closes the picker on Cancel or Esc and sends nothing", async () => {
    const client = api();
    const el = await mountRow(client);
    await openPicker(el, "product");
    inModal(el, "add-shortcut", '[data-test="add-shortcut-cancel"]').click();
    await vi.waitFor(() => expect(modal(el, "add-shortcut").open).toBe(false));
    const choice = await openPicker(el, "section");
    choice.focus();
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(modal(el, "add-shortcut").open).toBe(false));
    expect(writeCalls(client)).toEqual([]);
  });

  it("removes and moves shortcuts through the menu's home routes, never the section member routes", async () => {
    const client = api();
    const el = await mountRow(client);
    await toggleRow(el, "home");
    await rowAction(el, "home/t-chips", "remove");
    await vi.waitFor(() =>
      expect(client.removeHomeShortcut).toHaveBeenCalledWith("menu-lunch", "t-chips"),
    );
    await vi.waitFor(() => expect(client.getMenuHome).toHaveBeenCalledTimes(2));
    emit(structure(el), "wt-shortcut-move", { memberId: "t-chips", to: 0 });
    await vi.waitFor(() => expect(shortcutOrder(el)).toEqual(["t-chips", "t-burger", "t-drinks"]));
    expect(client.moveHomeShortcut).toHaveBeenCalledWith("menu-lunch", "t-chips", 0);
    // The move's answer is shown without reading the home again.
    expect(client.getMenuHome).toHaveBeenCalledTimes(2);
    expect(writeCalls(client)).toEqual(["removeHomeShortcut", "moveHomeShortcut"]);
  });

  it("keeps the tree usable during a move, and disables it during a remove until the home is read again", async () => {
    const reread = deferred<MenuHome>();
    const client = api();
    const el = await mountRow(client);
    client.getMenuHome.mockImplementationOnce(() => reread.promise);
    emit(structure(el), "wt-shortcut-move", { memberId: "t-chips", to: 0 });
    await el.updateComplete;
    expect(structure(el).busy).toBe(false);
    emit(structure(el), "wt-shortcut-remove", { memberId: "t-burger" });
    await el.updateComplete;
    expect(structure(el).busy).toBe(true);
    await vi.waitFor(() => expect(client.removeHomeShortcut).toHaveBeenCalled());
    reread.resolve(menuHome());
    await vi.waitFor(() => expect(structure(el).busy).toBe(false));
  });

  it("explains a refused shortcut beside the tree, and reads the home again after a refused move", async () => {
    const client = api({
      removeHomeShortcut: vi.fn().mockRejectedValue({ code: "menu_section.not_found" }),
      moveHomeShortcut: vi.fn().mockRejectedValue({ code: "menu.shortcut_unreachable" }),
    });
    const el = await mountRow(client);
    emit(structure(el), "wt-shortcut-remove", { memberId: "t-chips" });
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="member-error"]'))).toBe(codeMessage("menu_section.not_found")),
    );
    expect(structure(el).busy).toBe(false);
    const reads = client.getMenuHome.mock.calls.length;
    emit(structure(el), "wt-shortcut-move", { memberId: "t-chips", to: 0 });
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="member-error"]'))).toBe(
        codeMessage("menu.shortcut_unreachable"),
      ),
    );
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
    const el = await mountRow(client);
    emit(structure(el), "wt-shortcut-move", { memberId: "t-burger", to: 1 });
    await vi.waitFor(() => expect(client.getMenuHome).toHaveBeenCalledTimes(2));
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
    const el = await mountRow(client);
    emit(structure(el), "wt-shortcut-move", { memberId: "t-chips", to: 0 });
    emit(structure(el), "wt-shortcut-move", { memberId: "t-drinks", to: 0 });
    first.resolve(await answer("menu-lunch", "t-chips", 0));
    await vi.waitFor(() => expect(client.moveHomeShortcut).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(shortcutOrder(el)).toEqual(["t-drinks", "t-burger", "t-chips"]));
  });

  it("drops a refused move quietly once the person has gone to another menu", async () => {
    const refusal = deferred<SectionMember[]>();
    const client = api({ moveHomeShortcut: vi.fn(() => refusal.promise) });
    const el = await mountRow(client);
    emit(structure(el), "wt-shortcut-move", { memberId: "t-chips", to: 0 });
    history.pushState(null, "", "/manage/menus/menu/menu-dinner/view/structure");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(text(q(el, "h1"))).toBe("Dinner Menu"));
    const lunchReads = () =>
      client.getMenuHome.mock.calls.filter(([id]) => id === "menu-lunch").length;
    const before = lunchReads();
    refusal.reject({ code: "menu_section.not_found" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(q(el, '[data-test="member-error"]')).toBeNull();
    expect(lunchReads()).toBe(before);
  });

  it("drops a refused remove quietly once the person has gone to another menu", async () => {
    const refusal = deferred<void>();
    const client = api({ removeHomeShortcut: vi.fn(() => refusal.promise) });
    const el = await mountRow(client);
    emit(structure(el), "wt-shortcut-remove", { memberId: "t-chips" });
    await vi.waitFor(() => expect(client.removeHomeShortcut).toHaveBeenCalled());
    history.pushState(null, "", "/manage/menus/menu/menu-dinner/view/structure");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(text(q(el, "h1"))).toBe("Dinner Menu"));
    refusal.reject({ code: "menu_section.not_found" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await el.updateComplete;
    expect(q(el, '[data-test="member-error"]')).toBeNull();
  });

  it("marks a shortcut whose target left the menu, offering Remove alone", async () => {
    const el = await mountRow();
    await toggleRow(el, "home");
    const chips = rowOf(el, "home/t-chips")!;
    expect(text(chips.querySelector('[data-test="name"]'))).toBe(
      t("home.missing").replace("{name}", "Chips"),
    );
    expect(text(chips.querySelector('[data-test="kind"]'))).toBe(t("members.missing"));
    expect(
      allInStructure(el, `[data-test="${CSS.escape("actions-home/t-chips")}"] wt-button`).map(
        (button) => button.dataset.test,
      ),
    ).toEqual(["remove-home/t-chips"]);
  });

  it("reads the home again, rather than showing a move's answer, when a newer read changed the order while it was out", async () => {
    const live = new LiveData();
    const moved = deferred<SectionMember[]>();
    const client = api({ liveData: live, moveHomeShortcut: vi.fn(() => moved.promise) });
    const el = await mountRow(client);
    emit(structure(el), "wt-shortcut-move", { memberId: "t-chips", to: 0 });
    await vi.waitFor(() => expect(client.moveHomeShortcut).toHaveBeenCalled());
    // Another change lands first: Drinks, Chips, Burger.
    const newer = menuHome();
    const [burger, drinks, chips] = newer.shortcuts;
    newer.shortcuts = [
      { ...drinks!, position: 0 },
      { ...chips!, position: 1 },
      { ...burger!, position: 2 },
    ];
    client.getMenuHome.mockResolvedValue(newer);
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
    const el = await mountRow(client);
    emit(structure(el), "wt-shortcut-move", { memberId: "t-chips", to: 0 });
    await chooseOption(await openPicker(el, "product"), "p-lager");
    moved.resolve([
      productMember("t-chips", 0, "p-chips"),
      productMember("t-burger", 1, "p-burger"),
      sectionMember("t-drinks", 2, "s-drinks"),
    ]);
    await vi.waitFor(() => expect(client.addHomeShortcut).toHaveBeenCalled());
    // The move was not the home's last write, so its answer is not shown over the add.
    expect(shortcutOrder(el)).toEqual(["t-burger", "t-drinks", "t-chips"]);
    added.resolve(productMember("t-new", 3, "p-lager"));
    await vi.waitFor(() => expect(client.getMenuHome).toHaveBeenCalledTimes(2));
  });

  it("says on the Structure tab when the Device Home Page could not be read, and tries again", async () => {
    const client = api({
      getMenuHome: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(menuHome()),
    });
    const el = await mountLunch(client);
    await vi.waitFor(() => expect(q(el, '[data-test="home-row-error"]')).not.toBeNull());
    expect(text(q(el, '[data-test="home-row-error"]'))).toBe(t("home.error"));
    expect(rowOf(el, "home")).toBeNull();
    await click(el, "home-row-retry");
    await vi.waitFor(() => expect(rowOf(el, "home")).not.toBeNull());
    expect(q(el, '[data-test="home-row-error"]')).toBeNull();
  });

  it("sends one add, and none for an empty choice, when the picker reports another choice while an add is out", async () => {
    const added = deferred<SectionMember>();
    const client = api({ addHomeShortcut: vi.fn(() => added.promise) });
    const el = await mountRow(client);
    const choice = await openPicker(el, "product");
    emit(choice, "wt-change", { value: "" });
    await el.updateComplete;
    expect(client.addHomeShortcut).not.toHaveBeenCalled();
    await chooseOption(choice, "p-lager");
    emit(choice, "wt-change", { value: "p-lemonade" });
    await el.updateComplete;
    added.resolve(productMember("t-new", 3, "p-lager"));
    await vi.waitFor(() => expect(modal(el, "add-shortcut").open).toBe(false));
    await vi.waitFor(() => expect(structure(el).busy).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(client.addHomeShortcut).toHaveBeenCalledExactlyOnceWith("menu-lunch", {
      kind: "product",
      productId: "p-lager",
    });
  });

  it("reads the home no more after a shortcut add once the person has gone to a tab that does not show it", async () => {
    const added = deferred<SectionMember>();
    const client = api({ addHomeShortcut: vi.fn(() => added.promise) });
    const el = await mountRow(client);
    await chooseOption(await openPicker(el, "product"), "p-lager");
    await vi.waitFor(() => expect(client.addHomeShortcut).toHaveBeenCalled());
    await chooseTab(el, "prices");
    const reads = client.getMenuHome.mock.calls.length;
    added.resolve(productMember("t-new", 3, "p-lager"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.getMenuHome.mock.calls.length).toBe(reads);
  });
});

describe("the Home page tab", () => {
  type Slider = HTMLElementTagNameMap["wt-slider"];
  type Preview = HTMLElementTagNameMap["dashboard-device-home-preview"];

  function slider(el: MenusScreen): Slider {
    return q<Slider>(el, 'wt-slider[name="home-columns"]')!;
  }

  function radio(el: MenusScreen, name: string, value: string): HTMLInputElement {
    return q<HTMLInputElement>(el, `input[name="${name}"][value="${value}"]`)!;
  }

  function preview(el: MenusScreen): Preview | null {
    return q<Preview>(el, "dashboard-device-home-preview");
  }

  /** Opens Lunch's Home page tab from its address and waits for its controls. */
  async function mountHome(client: Api = api()) {
    const el = await mount(client, HOME_PATH);
    await vi.waitFor(() => expect(slider(el)).not.toBeNull());
    await slider(el).updateComplete;
    return el;
  }

  /** Moves the slider to `value` the way a person's release does. */
  async function slide(el: MenusScreen, value: number): Promise<void> {
    const input = slider(el).shadowRoot!.querySelector<HTMLInputElement>('input[type="range"]')!;
    input.value = String(value);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await el.updateComplete;
  }

  async function choose(el: MenusScreen, name: string, value: string): Promise<void> {
    radio(el, name, value).click();
    await el.updateComplete;
    await slider(el).updateComplete;
  }

  it("puts the Home page tab between Prices and Preview, keeps it in the address, and reads the home and the preview only while it shows", async () => {
    const live = new LiveData();
    const client = api({ liveData: live });
    const el = await mountPrices(client);
    const tabs = q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!;
    expect(tabs.items.map(({ key }) => key)).toEqual(["structure", "prices", "home", "preview"]);
    expect(tabs.items[2]!.label).toBe(t("menus.tab_home"));
    expect(client.getMenuHome).not.toHaveBeenCalled();
    expect(client.getMenuPreview).not.toHaveBeenCalled();
    await chooseTab(el, "home");
    expect(location.pathname).toBe(HOME_PATH);
    await vi.waitFor(() => expect(slider(el)).not.toBeNull());
    expect(client.getMenuHome).toHaveBeenCalledWith("menu-lunch");
    expect(client.getMenuPreview).toHaveBeenCalledWith("menu-lunch");
    // The tab's state comes with the preview, as on the Preview tab, so no query of its own
    // repeats the read.
    await vi.waitFor(() => expect(preview(el)).not.toBeNull());
    const ownStatus = client.getMenuStatus.mock.calls.length;
    const shownPreviewReads = client.getMenuPreview.mock.calls.length;
    live.invalidate([{ type: "menu_details" }]);
    await vi.waitFor(() =>
      expect(client.getMenuPreview.mock.calls.length).toBe(shownPreviewReads + 1),
    );
    expect(client.getMenuStatus.mock.calls.length).toBe(ownStatus);
    await chooseTab(el, "prices");
    const homeReads = client.getMenuHome.mock.calls.length;
    const previewReads = client.getMenuPreview.mock.calls.length;
    live.invalidate([{ type: "menu_details" }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.getMenuHome.mock.calls.length).toBe(homeReads);
    expect(client.getMenuPreview.mock.calls.length).toBe(previewReads);
    history.back();
    await vi.waitFor(() => expect(tabs.value).toBe("home"));
  });

  it("chooses Handheld or Till, each with its own controls", async () => {
    const home = menuHome();
    home.handheld = { columns: 3, tiles: "thumbnails", order: "home_first" };
    home.till = { columns: 9, tiles: "colours", order: "menu_first" };
    const el = await mountHome(api({ getMenuHome: vi.fn().mockResolvedValue(home) }));
    expect(radio(el, "home-device", "handheld").checked).toBe(true);
    expect(radio(el, "home-device", "till").checked).toBe(false);
    expect([slider(el).min, slider(el).max, slider(el).value]).toEqual([2, 3, 3]);
    expect(slider(el).label).toBe(t("home.columns"));
    expect(radio(el, "home-tiles", "thumbnails").checked).toBe(true);
    expect(radio(el, "home-order", "home_first").checked).toBe(true);
    await vi.waitFor(() => expect(preview(el)).not.toBeNull());
    expect(preview(el)!.device).toBe("handheld");
    await choose(el, "home-device", "till");
    expect([slider(el).min, slider(el).max, slider(el).value]).toEqual([4, 10, 9]);
    expect(radio(el, "home-tiles", "colours").checked).toBe(true);
    expect(radio(el, "home-order", "menu_first").checked).toBe(true);
    expect(preview(el)!.device).toBe("till");
  });

  it.each(["en", "es-ES"])(
    "says under the slider that narrow screens show fewer columns (%s)",
    async (locale) => {
      const before = currentLocale();
      setLocale(locale);
      onTestFinished(() => setLocale(before));
      const home = menuHome();
      home.handheld = { ...home.handheld, columns: 2 };
      const client = api({ getMenuHome: vi.fn().mockResolvedValue(home) });
      const el = await mountHome(client);
      const note = () => slider(el).nextElementSibling as HTMLElement;
      expect(note().dataset.test).toBe("columns-note");
      expect(text(note())).toBe(t("home.columns_note_handheld"));
      await vi.waitFor(() => expect(preview(el)).not.toBeNull());
      await preview(el)!.updateComplete;
      const frame = () => preview(el)!.shadowRoot!.querySelector<HTMLElement>(".frame")!;
      const phone = frame().getBoundingClientRect().width;
      await slide(el, 3);
      await vi.waitFor(() =>
        expect(client.setHomeDisplay).toHaveBeenCalledWith("menu-lunch", "handheld", {
          columns: 3,
        }),
      );
      await preview(el)!.updateComplete;
      expect(frame().getBoundingClientRect().width).toBe(phone);
      await choose(el, "home-device", "till");
      expect(text(note())).toBe(t("home.columns_note_till"));
      expect(note().dataset.test).toBe("columns-note");
    },
  );

  it("saves each control as it changes, for the device shown", async () => {
    const out = deferred<void>();
    const client = api();
    const el = await mountHome(client);
    client.setHomeDisplay.mockImplementationOnce(() => out.promise);
    const saved = menuHome();
    saved.handheld = { ...saved.handheld, columns: 2 };
    client.getMenuHome.mockResolvedValue(saved);
    await slide(el, 2);
    expect(client.setHomeDisplay).toHaveBeenLastCalledWith("menu-lunch", "handheld", {
      columns: 2,
    });
    await slider(el).updateComplete;
    expect(slider(el).disabled).toBe(true);
    for (const [name, value] of [
      ["home-tiles", "thumbnails"],
      ["home-order", "menu_first"],
    ])
      expect(radio(el, name!, value!).disabled, name).toBe(true);
    out.resolve();
    await vi.waitFor(() => expect(slider(el).disabled).toBe(false));
    expect(slider(el).value).toBe(2);
    await choose(el, "home-tiles", "thumbnails");
    await vi.waitFor(() =>
      expect(client.setHomeDisplay).toHaveBeenLastCalledWith("menu-lunch", "handheld", {
        tiles: "thumbnails",
      }),
    );
    await vi.waitFor(() => expect(slider(el).disabled).toBe(false));
    await choose(el, "home-order", "menu_first");
    await vi.waitFor(() =>
      expect(client.setHomeDisplay).toHaveBeenLastCalledWith("menu-lunch", "handheld", {
        order: "menu_first",
      }),
    );
    await vi.waitFor(() => expect(slider(el).disabled).toBe(false));
    await choose(el, "home-device", "till");
    await slide(el, 9);
    await vi.waitFor(() =>
      expect(client.setHomeDisplay).toHaveBeenLastCalledWith("menu-lunch", "till", {
        columns: 9,
      }),
    );
    expect(writeCalls(client)).toEqual([
      "setHomeDisplay",
      "setHomeDisplay",
      "setHomeDisplay",
      "setHomeDisplay",
    ]);
  });

  it("never reads a change from the preview's search as a setting", async () => {
    const client = api();
    const el = await mountHome(client);
    await vi.waitFor(() => expect(preview(el)).not.toBeNull());
    emit(preview(el)!, "wt-change", { value: "5" });
    const search = preview(el)!.shadowRoot!.querySelector('wt-input[name="home-preview-search"]')!;
    type(search, "bur");
    await el.updateComplete;
    expect(client.setHomeDisplay).not.toHaveBeenCalled();
  });

  it("puts a refused setting under its control, and any other refusal above the controls", async () => {
    const client = api();
    const el = await mountHome(client);
    client.setHomeDisplay.mockRejectedValueOnce({
      code: "menu.home_display_invalid",
      params: { device: "handheld", field: "columns" },
    });
    await slide(el, 2);
    await vi.waitFor(() => expect(slider(el).error).toBe(codeMessage("menu.home_display_invalid")));
    expect(q(el, '[data-test="home-error"]')).toBeNull();

    client.setHomeDisplay.mockRejectedValueOnce({
      code: "menu.home_display_invalid",
      params: { device: "handheld", field: "tiles" },
    });
    await choose(el, "home-tiles", "thumbnails");
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="home-tiles-error"]'))).toBe(
        codeMessage("menu.home_display_invalid"),
      ),
    );
    expect(q(el, '[data-test="home-order-error"]')).toBeNull();

    client.setHomeDisplay.mockRejectedValueOnce({ code: "server.internal" });
    await choose(el, "home-order", "menu_first");
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="home-error"]'))).toBe(codeMessage("server.internal")),
    );
    expect(q(el, '[data-test="home-order-error"]')).toBeNull();

    // A refusal naming the other device is not about a control on screen.
    const late = deferred<void>();
    client.setHomeDisplay.mockImplementationOnce(() => late.promise);
    await slide(el, 2);
    await choose(el, "home-device", "till");
    late.reject({
      code: "menu.home_display_invalid",
      params: { device: "handheld", field: "columns" },
    });
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="home-error"]'))).toBe(
        codeMessage("menu.home_display_invalid"),
      ),
    );
    expect(slider(el).error).toBe("");
  });

  it("shows the saved choice again after a refused setting, so the same choice can be sent again", async () => {
    const client = api();
    const el = await mountHome(client);
    client.setHomeDisplay.mockRejectedValueOnce({ code: "server.internal" });
    await choose(el, "home-order", "menu_first");
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="home-error"]'))).toBe(codeMessage("server.internal")),
    );
    await el.updateComplete;
    expect(radio(el, "home-order", "home_first").checked).toBe(true);
    expect(radio(el, "home-order", "menu_first").checked).toBe(false);
    await choose(el, "home-order", "menu_first");
    await vi.waitFor(() => expect(client.setHomeDisplay).toHaveBeenCalledTimes(2));
    expect(client.setHomeDisplay).toHaveBeenLastCalledWith("menu-lunch", "handheld", {
      order: "menu_first",
    });
  });

  it.each([
    ["home-order", "home_first", "menu_first"],
    ["home-tiles", "colours", "thumbnails"],
  ])(
    "shows the %s choice just made while its save is out, and keeps it once saved",
    async (name, saved, chosen) => {
      const out = deferred<void>();
      const client = api();
      const el = await mountHome(client);
      client.setHomeDisplay.mockImplementationOnce(() => out.promise);
      const after = menuHome();
      after.handheld = { ...after.handheld, [name === "home-order" ? "order" : "tiles"]: chosen };
      client.getMenuHome.mockResolvedValue(after);
      await choose(el, name, chosen);
      expect(client.setHomeDisplay).toHaveBeenCalledTimes(1);
      expect(radio(el, name, chosen).checked).toBe(true);
      expect(radio(el, name, saved).checked).toBe(false);
      out.resolve();
      await vi.waitFor(() => expect(radio(el, name, chosen).disabled).toBe(false));
      expect(radio(el, name, chosen).checked).toBe(true);
      expect(radio(el, name, saved).checked).toBe(false);
    },
  );

  it("shows the choice just made while its save is out, and the saved one again once it is refused", async () => {
    const out = deferred<void>();
    const client = api();
    const el = await mountHome(client);
    client.setHomeDisplay.mockImplementationOnce(() => out.promise);
    await choose(el, "home-order", "menu_first");
    expect(radio(el, "home-order", "menu_first").checked).toBe(true);
    out.reject({ code: "server.internal" });
    await vi.waitFor(() => expect(radio(el, "home-order", "menu_first").disabled).toBe(false));
    expect(radio(el, "home-order", "home_first").checked).toBe(true);
    expect(radio(el, "home-order", "menu_first").checked).toBe(false);
  });

  it("shows the column count just chosen while its save is out, and the saved one again once it is refused", async () => {
    const out = deferred<void>();
    const client = api();
    const el = await mountHome(client);
    client.setHomeDisplay.mockImplementationOnce(() => out.promise);
    await slide(el, 2);
    await slider(el).updateComplete;
    const shadow = slider(el).shadowRoot!;
    expect(slider(el).value).toBe(2);
    expect(shadow.querySelector<HTMLInputElement>('input[type="range"]')!.value).toBe("2");
    expect(text(shadow.querySelector('[part="value"]'))).toBe("2");
    out.reject({ code: "server.internal" });
    await vi.waitFor(() => expect(slider(el).disabled).toBe(false));
    await slider(el).updateComplete;
    expect(slider(el).value).toBe(3);
    expect(shadow.querySelector<HTMLInputElement>('input[type="range"]')!.value).toBe("3");
  });

  it("writes a refusal under a group of choices as the slider writes its own", async () => {
    const client = api();
    const el = await mountHome(client);
    for (const field of ["columns", "tiles"])
      client.setHomeDisplay.mockRejectedValueOnce({
        code: "menu.home_display_invalid",
        params: { device: "handheld", field },
      });
    await slide(el, 2);
    await vi.waitFor(() => expect(slider(el).error).not.toBe(""));
    await choose(el, "home-tiles", "thumbnails");
    await vi.waitFor(() => expect(q(el, '[data-test="home-tiles-error"]')).not.toBeNull());
    await slider(el).updateComplete;
    const sliderError = getComputedStyle(slider(el).shadowRoot!.querySelector(".error")!);
    const choiceError = getComputedStyle(q(el, '[data-test="home-tiles-error"]')!);
    for (const property of ["font-size", "font-weight", "color", "margin"] as const)
      expect(choiceError.getPropertyValue(property), property).toBe(
        sliderError.getPropertyValue(property),
      );
  });

  it("shows the saved column count again after a refused change", async () => {
    const client = api();
    const el = await mountHome(client);
    client.setHomeDisplay.mockRejectedValueOnce({
      code: "menu.home_display_invalid",
      params: { device: "handheld", field: "columns" },
    });
    await slide(el, 2);
    await vi.waitFor(() => expect(slider(el).error).toBe(codeMessage("menu.home_display_invalid")));
    await slider(el).updateComplete;
    expect(slider(el).value).toBe(3);
    const shadow = slider(el).shadowRoot!;
    expect(shadow.querySelector<HTMLInputElement>('input[type="range"]')!.value).toBe("3");
    expect(text(shadow.querySelector('[part="value"]'))).toBe("3");
  });

  it("keeps the other device's refusals off the controls once the device is switched", async () => {
    const client = api();
    const el = await mountHome(client);
    client.setHomeDisplay.mockRejectedValueOnce({
      code: "menu.home_display_invalid",
      params: { device: "handheld", field: "tiles" },
    });
    await choose(el, "home-tiles", "thumbnails");
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="home-tiles-error"]'))).toBe(
        codeMessage("menu.home_display_invalid"),
      ),
    );
    await choose(el, "home-device", "till");
    expect(q(el, '[data-test="home-tiles-error"]')).toBeNull();
  });

  it("keeps showing a saved setting when the read after the save fails", async () => {
    const client = api();
    const el = await mountHome(client);
    client.getMenuHome.mockRejectedValueOnce(new Error("offline"));
    await choose(el, "home-order", "menu_first");
    await vi.waitFor(() => expect(q(el, '[data-test="home-load-error"]')).not.toBeNull());
    await choose(el, "home-device", "till");
    await choose(el, "home-device", "handheld");
    expect(radio(el, "home-order", "menu_first").checked).toBe(true);
    expect(radio(el, "home-order", "home_first").checked).toBe(false);
  });

  it("draws the preview from the draft preview's document", async () => {
    const pending = deferred<MenuPreview>();
    const client = api({ getMenuPreview: vi.fn(() => pending.promise) });
    const el = await mountHome(client);
    expect(preview(el)).toBeNull();
    expect(q(el, '[data-test="home-preview-loading"]')).not.toBeNull();
    pending.resolve(lunchPreview());
    await vi.waitFor(() => expect(preview(el)).not.toBeNull());
    expect(preview(el)!.document).toEqual(lunchDocument());
    expect(preview(el)!.device).toBe("handheld");
    expect(q(el, '[data-test="home-preview-loading"]')).toBeNull();
  });

  it("says the preview could not be worked out, and tries again", async () => {
    const client = api({
      getMenuPreview: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(lunchPreview()),
    });
    const el = await mountHome(client);
    await vi.waitFor(() => expect(q(el, '[data-test="home-preview-error"]')).not.toBeNull());
    await click(el, "home-preview-retry");
    await vi.waitFor(() => expect(preview(el)).not.toBeNull());
    expect(q(el, '[data-test="home-preview-error"]')).toBeNull();
  });

  it("says the home page could not be loaded, and tries again", async () => {
    const client = api({
      getMenuHome: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(menuHome()),
    });
    const el = await mount(client, HOME_PATH);
    await vi.waitFor(() => expect(q(el, '[data-test="home-load-error"]')).not.toBeNull());
    expect(text(q(el, '[data-test="home-load-error"]'))).toBe(t("home.error"));
    expect(slider(el)).toBeNull();
    await click(el, "home-retry");
    await vi.waitFor(() => expect(slider(el)).not.toBeNull());
    expect(q(el, '[data-test="home-load-error"]')).toBeNull();
  });

  it("says the home page is loading until it is read", async () => {
    const pending = deferred<MenuHome>();
    const client = api({ getMenuHome: vi.fn(() => pending.promise) });
    const el = await mount(client, HOME_PATH);
    await vi.waitFor(() => expect(q(el, '[data-test="home-loading"]')).not.toBeNull());
    expect(text(q(el, '[data-test="home-loading"]'))).toBe(t("home.loading"));
    expect(slider(el)).toBeNull();
    pending.resolve(menuHome());
    await vi.waitFor(() => expect(slider(el)).not.toBeNull());
  });

  it("never shows another menu's home after the person has gone to it", async () => {
    const lunchRead = deferred<MenuHome>();
    const dinner = emptyHome();
    dinner.handheld = { ...dinner.handheld, columns: 2 };
    const client = api({
      getMenuHome: vi.fn((id: string) =>
        id === "menu-lunch" ? lunchRead.promise : Promise.resolve(dinner),
      ),
    });
    const el = await mount(client, HOME_PATH);
    history.pushState(null, "", "/manage/menus/menu/menu-dinner/view/home");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(client.getMenuHome).toHaveBeenCalledWith("menu-dinner"));
    await vi.waitFor(() => expect(slider(el)?.value).toBe(2));
    lunchRead.resolve(menuHome());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(slider(el).value).toBe(2);
  });

  async function goToDinnerHome(el: MenusScreen, client: Api): Promise<void> {
    history.pushState(null, "", "/manage/menus/menu/menu-dinner/view/home");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(client.getMenuHome).toHaveBeenCalledWith("menu-dinner"));
    await vi.waitFor(() => expect(slider(el)?.value).toBe(2));
  }

  function dinnerAtTwo(lunchColumns = 3): Api {
    const dinner = emptyHome();
    dinner.handheld = { ...dinner.handheld, columns: 2 };
    return api({
      getMenuHome: vi.fn(async (id: string) =>
        id === "menu-lunch"
          ? { ...menuHome(), handheld: { ...menuHome().handheld, columns: lunchColumns } }
          : dinner,
      ),
    });
  }

  it("sends no second setting while one is still being saved, even when a control reports a change", async () => {
    const out = deferred<void>();
    const client = api();
    const el = await mountHome(client);
    client.setHomeDisplay.mockImplementationOnce(() => out.promise);
    await slide(el, 2);
    emit(slider(el), "wt-change", { value: 3 });
    await el.updateComplete;
    out.resolve();
    await vi.waitFor(() => expect(slider(el).disabled).toBe(false));
    expect(client.setHomeDisplay).toHaveBeenCalledExactlyOnceWith("menu-lunch", "handheld", {
      columns: 2,
    });
  });

  it("drops a refused setting quietly once the person has gone to another menu", async () => {
    const out = deferred<void>();
    const client = dinnerAtTwo();
    const el = await mountHome(client);
    client.setHomeDisplay.mockImplementationOnce(() => out.promise);
    await choose(el, "home-order", "menu_first");
    await goToDinnerHome(el, client);
    out.reject({
      code: "menu.home_display_invalid",
      params: { device: "handheld", field: "order" },
    });
    await vi.waitFor(() => expect(slider(el).disabled).toBe(false));
    await el.updateComplete;
    expect(q(el, '[data-test="home-error"]')).toBeNull();
    expect(q(el, '[data-test="home-order-error"]')).toBeNull();
    expect(radio(el, "home-order", "home_first").checked).toBe(true);
  });

  it("keeps a setting saved after the person went to another menu off that menu's controls, and reads only that menu's home", async () => {
    const out = deferred<void>();
    const client = dinnerAtTwo(2);
    const el = await mountHome(client);
    client.setHomeDisplay.mockImplementationOnce(() => out.promise);
    await slide(el, 3);
    await goToDinnerHome(el, client);
    const lunchReads = () =>
      client.getMenuHome.mock.calls.filter(([id]) => id === "menu-lunch").length;
    const before = lunchReads();
    out.resolve();
    await vi.waitFor(() => expect(slider(el).disabled).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await slider(el).updateComplete;
    expect(slider(el).value).toBe(2);
    expect(lunchReads()).toBe(before);
    expect(client.setHomeDisplay).toHaveBeenCalledExactlyOnceWith("menu-lunch", "handheld", {
      columns: 3,
    });
  });

  it("reads the preview no second time when the person goes from the Preview tab to the Home page tab", async () => {
    const client = api();
    const el = await mount(client, PREVIEW_PATH);
    await vi.waitFor(() => expect(client.getMenuPreview).toHaveBeenCalledWith("menu-lunch"));
    await vi.waitFor(() => expect(q(el, "dashboard-menu-preview")).not.toBeNull());
    const reads = client.getMenuPreview.mock.calls.length;
    await chooseTab(el, "home");
    await vi.waitFor(() => expect(preview(el)).not.toBeNull());
    expect(preview(el)!.document).toEqual(lunchDocument());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(client.getMenuPreview.mock.calls.length).toBe(reads);
  });
});

describe("the name forms", () => {
  interface NameForm {
    form: string;
    save: string;
    field: string;
    required: StringKey;
    write: keyof DashboardApi;
    path: string;
    open: (el: MenusScreen) => Promise<void>;
  }
  const forms: NameForm[] = [
    {
      form: "menu-form",
      save: "menu-save",
      field: "name",
      required: "menus.name_required",
      write: "createCatalogue",
      path: "/manage/menus",
      open: (el) => click(el, "add-menu"),
    },
    {
      form: "new-section",
      save: "new-section-save",
      field: "internalName",
      required: "sections.internal_name_required",
      write: "createSectionIn",
      path: LUNCH_PATH,
      open: async (el) => {
        if (currentPlace(el) !== "Lunch Menu › Drinks") await editDrinks(el);
        await rowAction(el, "m-drinks", "new-section");
      },
    },
  ];

  async function opened(form: NameForm, client: Api = api()) {
    const el = await mount(client, form.path);
    if (form.path === LUNCH_PATH) await vi.waitFor(() => expect(structure(el)).not.toBeNull());
    await form.open(el);
    await vi.waitFor(() => expect(modal(el, form.form).open).toBe(true));
    return {
      el,
      name: () =>
        inModal<HTMLElementTagNameMap["wt-input"]>(el, form.form, `wt-input[name="${form.field}"]`),
      save: () =>
        inModal<HTMLElementTagNameMap["wt-button"]>(el, form.form, `[data-test="${form.save}"]`),
    };
  }

  async function rename(el: MenusScreen, input: Element, value: string): Promise<void> {
    type(input, value);
    await el.updateComplete;
  }

  const focusedIn = (input: HTMLElementTagNameMap["wt-input"]) =>
    input.shadowRoot!.activeElement === input.shadowRoot!.querySelector("input");

  it.each(forms)("$form says nothing about errors before the first Save", async (form) => {
    const { el, name, save } = await opened(form);
    await rename(el, name(), " ");
    expect(name().error).toBe("");
    expect(await bottom(el, form.form)).toBe("");
    expect(save().disabled).toBe(false);
  });

  it.each(forms)(
    "$form focuses the name on an invalid Save, holds Save until it is fixed, and re-checks every change",
    async (form) => {
      const client = api();
      const { el, name, save } = await opened(form, client);
      await rename(el, name(), "");
      save().click();
      await el.updateComplete;
      await vi.waitFor(() => expect(focusedIn(name())).toBe(true));
      expect(name().error).toBe(t(form.required));
      expect(await bottom(el, form.form)).toBe(t("form.fix_fields"));
      expect(save().disabled).toBe(true);

      await rename(el, name(), "Terrace");
      expect(name().error).toBe("");
      expect(await bottom(el, form.form)).toBe("");
      expect(save().disabled).toBe(false);

      await rename(el, name(), "  ");
      expect(name().error).toBe(t(form.required));
      expect(save().disabled).toBe(true);
      expect(client[form.write]).not.toHaveBeenCalled();
    },
  );

  it.each(forms)("$form focuses a refused name and leaves Save working", async (form) => {
    const client = api({
      [form.write]: vi
        .fn()
        .mockRejectedValue({ code: "management.request_invalid", params: { field: form.field } }),
    });
    const { el, name, save } = await opened(form, client);
    await rename(el, name(), "Terrace");
    save().click();
    await vi.waitFor(() => expect(name().error).toBe(codeMessage("management.request_invalid")));
    await vi.waitFor(() => expect(focusedIn(name())).toBe(true));
    expect(await bottom(el, form.form)).toBe(t("form.fix_fields"));
    expect(save().disabled).toBe(false);

    await rename(el, name(), "Terrace two");
    expect(name().error).toBe("");
    expect(await bottom(el, form.form)).toBe("");
    expect(save().disabled).toBe(false);
  });

  it.each(forms)(
    "$form leaves Save working after a refusal naming no field, and drops it on the next Save",
    async (form) => {
      const client = api({ [form.write]: vi.fn().mockRejectedValue({ code: "server.internal" }) });
      const { el, name, save } = await opened(form, client);
      await rename(el, name(), "Terrace");
      save().click();
      await vi.waitFor(async () =>
        expect(await bottom(el, form.form)).toBe(codeMessage("server.internal")),
      );
      expect(save().disabled).toBe(false);

      // Re-checked since the first Save: the refusal and the generic sentence show together.
      await rename(el, name(), "");
      expect(await bottom(el, form.form)).toBe(
        `${codeMessage("server.internal")} ${t("form.fix_fields")}`,
      );
      save().click();
      await el.updateComplete;
      expect(await bottom(el, form.form)).toBe(t("form.fix_fields"));
    },
  );

  it.each(forms)("$form starts again when it is reopened", async (form) => {
    const { el, name, save } = await opened(form);
    await rename(el, name(), "");
    save().click();
    await el.updateComplete;
    inModal(el, form.form, `[data-test="${form.form}-cancel"]`).click();
    await el.updateComplete;
    expect(modal(el, form.form).open).toBe(false);
    await form.open(el);
    await vi.waitFor(() => expect(modal(el, form.form).open).toBe(true));
    expect(name().error).toBe("");
    expect(await bottom(el, form.form)).toBe("");
    expect(save().disabled).toBe(false);
  });

  it.each(forms)("$form keeps no message once it is cancelled", async (form) => {
    const { el, name, save } = await opened(form);
    await rename(el, name(), "");
    save().click();
    await el.updateComplete;
    expect(await bottom(el, form.form)).toBe(t("form.fix_fields"));
    inModal(el, form.form, `[data-test="${form.form}-cancel"]`).click();
    await el.updateComplete;
    expect(modal(el, form.form).open).toBe(false);
    expect(await bottom(el, form.form)).toBe("");
  });
});

// At 390 px the list takes its narrow layout, which wraps the name and never scrolls sideways (the
// phone-width case above); from about 480 px the Status column returns and a long name overflows.
describe("the menus list just wider than its narrow layout", () => {
  it.each(["en-GB", "es-ES"])(
    "keeps every menu row's menu on screen and uncovered while the other columns scroll sideways (600 px, %s)",
    async (locale) => {
      const longMenus: CatalogueSummary[] = [
        {
          id: "menu-lunch",
          name: "Menú-del-mediodía-de-lunes-a-viernes-con-postre",
          active: true,
          version: 1,
        },
        menus[1]!,
      ];
      const width = window.innerWidth,
        height = window.innerHeight;
      const before = currentLocale();
      try {
        setLocale(locale);
        await page.viewport(600, 844);
        expect(window.innerWidth).toBe(600);
        const el = await mount(api({ listCatalogues: vi.fn().mockResolvedValue(longMenus) }));
        await vi.waitFor(async () => {
          await table(el).updateComplete;
          expect(table(el).shadowRoot.querySelectorAll("tbody tr")).toHaveLength(2);
          expect(
            [...table(el).shadowRoot.querySelectorAll("thead th")].map((th) => text(th)),
          ).toContain(t("menus.status"));
        });
        expectRowMenusOnScreen(table(el), longMenus.length);
      } finally {
        setLocale(before);
        await page.viewport(width, height);
      }
    },
  );
});

it("creates a section with its customer name, image and colour in one request", async () => {
  const client = api();
  const createSectionIn = vi.fn().mockResolvedValue({
    id: "s-new",
    internalName: "Starters",
    names: {},
    image: null,
    color: null,
    members: [],
  });
  Object.assign(client, { createSectionIn });
  const el = await mountLunch(client);
  await rowAction(el, "root", "new-section");
  const form = el.shadowRoot!.querySelector("dashboard-section-details-form");
  expect(form).not.toBeNull();
  form!.dispatchEvent(
    new CustomEvent("wt-submit", {
      detail: {
        internalName: "Starters",
        names: { en: "To begin", es: "Para empezar" },
        image: null,
        color: "#aa3300",
      },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() =>
    expect(createSectionIn).toHaveBeenCalledExactlyOnceWith("root-lunch", {
      internalName: "Starters",
      names: { en: "To begin", es: "Para empezar" },
      image: null,
      color: "#aa3300",
    }),
  );
  expect(client.addSectionMember).not.toHaveBeenCalled();
});

it("offers only menus that can be included, and includes one as a folder", async () => {
  const client = api({
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
      nodes: [],
      includable: [{ id: "drinks", name: "Drinks", rootSectionId: "drinks-root" }],
      includedBy: [],
    }),
  });
  const el = await mountLunch(client);
  await rowAction(el, "root", "include-menu");
  const picker = el.shadowRoot!.querySelector<
    HTMLElement & {
      required: boolean;
      placeholder: string;
      options: { value: string; label: string }[];
    }
  >('[name="included-menu"]')!;
  expect(picker.required).toBe(true);
  expect(picker.shadowRoot!.querySelector("label")!.textContent).toContain("*");
  expect(picker.placeholder).toBe(t("menus.choose_menu"));
  const field = picker
    .shadowRoot!.querySelector<HTMLElement>('[part="field"]')!
    .getBoundingClientRect();
  const label = picker.shadowRoot!.querySelector("label")!.getBoundingClientRect();
  expect(label.top).toBeGreaterThanOrEqual(field.top);
  expect(label.bottom).toBeLessThanOrEqual(field.bottom);
  expect(picker.options.filter((option) => option.value).map((option) => option.label)).toEqual([
    "Drinks",
  ]);
  await chooseOption(picker, "drinks-root");
  await el.updateComplete;
  await vi.waitFor(() =>
    expect(client.addSectionMember).toHaveBeenCalledWith("root-lunch", {
      kind: "section",
      sectionId: "drinks-root",
    }),
  );
});

describe("the include-a-menu field", () => {
  type Combobox = HTMLElement & {
    options: { value: string; label: string }[];
    value: string;
    label: string;
    name: string;
    placeholder: string;
    search: string;
    required: boolean;
    disabled: boolean;
    error: string;
  };
  const includable = [
    { id: "drinks", name: "Drinks", rootSectionId: "drinks-root" },
    { id: "wine", name: "Wines", rootSectionId: "wine-root" },
  ];
  function includeClient(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}) {
    return api({
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
        nodes: [],
        includable,
        includedBy: [],
      }),
      ...overrides,
    });
  }

  it("includes the chosen menu without a second action", async () => {
    const client = includeClient();
    const el = await mountLunch(client);
    await rowAction(el, "root", "include-menu");
    const picker = inModal<Combobox>(el, "include", 'wt-combobox[name="included-menu"]');
    await chooseOption(picker, "wine-root");
    await vi.waitFor(() =>
      expect(client.addSectionMember).toHaveBeenCalledExactlyOnceWith("root-lunch", {
        kind: "section",
        sectionId: "wine-root",
      }),
    );
    expect(inModal(el, "include", '[data-test="include-save"]')).toBeNull();
  });

  it("picks the menu from a required labelled dropdown, prompting a choice", async () => {
    const adding = deferred<SectionMember>();
    const client = includeClient({ addSectionMember: vi.fn(() => adding.promise) });
    const el = await mountLunch(client);
    await rowAction(el, "root", "include-menu");
    const picker = inModal<Combobox>(el, "include", 'wt-combobox[name="included-menu"]');
    expect(picker).not.toBeNull();
    expect(picker.label).toBe(t("menus.include_menu"));
    expect(picker.required).toBe(true);
    expect(picker.search).toBe("auto");
    expect(picker.placeholder).toBe(t("menus.choose_menu"));
    expect(picker.options).toEqual([
      { value: "drinks-root", label: "Drinks" },
      { value: "wine-root", label: "Wines" },
    ]);
    expect(picker.value).toBe("");

    await chooseOption(picker, "wine-root");
    await el.updateComplete;
    expect(picker.error).toBe("");
    expect(picker.value).toBe("wine-root");
    expect(picker.disabled).toBe(true);
    expect(client.addSectionMember).toHaveBeenCalledExactlyOnceWith("root-lunch", {
      kind: "section",
      sectionId: "wine-root",
    });
  });

  it("closes an open list on Escape and leaves the dialog open", async () => {
    const el = await mountLunch(includeClient());
    await rowAction(el, "root", "include-menu");
    const picker = inModal<Combobox>(el, "include", 'wt-combobox[name="included-menu"]');
    const list = picker.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
    expect(list.matches(":popover-open")).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(list.matches(":popover-open")).toBe(false);
    await el.updateComplete;
    expect(modal(el, "include").open).toBe(true);
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(modal(el, "include").open).toBe(false));
  });
});

it("lists the menus that include this one, with their clashes", async () => {
  setLocale("en-GB");
  const client = api({
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
      nodes: [],
      includable: [],
      includedBy: [
        { id: "evening", name: "Evening" },
        { id: "afternoon", name: "Afternoon" },
      ],
    }),
    getMenuStatuses: vi.fn().mockResolvedValue({
      evening: { state: "unpublished", clashes: 0 },
      afternoon: { state: "unpublished", clashes: 1 },
    }),
  });
  const el = await mountLunch(client);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector('[data-test="included-by"]')).not.toBeNull(),
  );
  const notice = el.shadowRoot!.querySelector('[data-test="included-by"]')!;
  expect(notice.textContent).toContain(t("menus.included_in" as StringKey));
  expect(
    [...notice.querySelectorAll("a")].map((a) => [a.textContent?.trim(), a.getAttribute("href")]),
  ).toEqual([
    ["Evening", "/manage/menus/menu/evening/view/structure"],
    ["Afternoon (1 clash)", "/manage/menus/menu/afternoon/view/structure"],
  ]);
});

describe("review fix: inclusion target and validation", () => {
  function includeApi(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}) {
    const client = api(overrides);
    const read = client.getMenuStructure.getMockImplementation()! as (
      id: string,
    ) => Promise<MenuStructure>;
    client.getMenuStructure.mockImplementation(async (id: string) => ({
      ...(await read(id)),
      includable: [{ id: "wine", name: "Wines", rootSectionId: "wine-root" }],
    }));
    return client;
  }
  async function openInclude(el: MenusScreen, choose = true) {
    await rowAction(el, currentKey(el), "include-menu");
    const picker = inModal<HTMLElement & { error: string; value: string }>(
      el,
      "include",
      '[name="included-menu"]',
    );
    if (choose) {
      await chooseOption(picker, "wine-root");
      await el.updateComplete;
    }
    return picker;
  }
  it("closes Include without a write when its original list disappears before selection", async () => {
    const live = new LiveData();
    const client = includeApi({ liveData: live });
    const el = await mountLunch(client);
    await editDrinks(el);
    await openInclude(el, false);
    await takeDrinksOff(el, client, live);
    expect(modal(el, "include").open).toBe(false);
    expect(client.addSectionMember).not.toHaveBeenCalled();
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      t("menus.list_gone").replace("{name}", "Drinks"),
    );
  });
  it.each(["success", "refusal"] as const)(
    "keeps the original Include destination during list loss and %s",
    async (outcome) => {
      const live = new LiveData();
      const adding = deferred<SectionMember>();
      const client = includeApi({ liveData: live, addSectionMember: vi.fn(() => adding.promise) });
      const el = await mountLunch(client);
      await editDrinks(el);
      await openInclude(el);
      await vi.waitFor(() =>
        expect(client.addSectionMember).toHaveBeenCalledExactlyOnceWith("s-drinks", {
          kind: "section",
          sectionId: "wine-root",
        }),
      );
      await takeDrinksOff(el, client, live);
      expect(modal(el, "include").open).toBe(true);
      if (outcome === "success") {
        adding.resolve(sectionMember("wine", 0, "wine-root"));
        await vi.waitFor(() => expect(modal(el, "include").open).toBe(false));
        await vi.waitFor(() =>
          expect(text(q(el, '[data-test="member-error"]'))).toBe(
            t("menus.list_gone_saved").replace("{name}", "Drinks"),
          ),
        );
      } else {
        adding.reject({ code: "menu_section.not_found" });
        await vi.waitFor(async () =>
          expect(await bottom(el, "include")).toBe(codeMessage("menu_section.not_found")),
        );
        expect(modal(el, "include").open).toBe(true);
        await click(el, "include-cancel");
        expect(modal(el, "include").open).toBe(false);
        expect(client.addSectionMember).toHaveBeenCalledOnce();
      }
    },
  );
  it("closes an idle Include on navigation without retargeting the selection", async () => {
    const client = includeApi();
    const el = await mountLunch(client);
    await editDrinks(el);
    await openInclude(el, false);
    await visit(el, DINNER_PATH, "Dinner Menu");
    expect(modal(el, "include").open).toBe(false);
    expect(client.addSectionMember).not.toHaveBeenCalled();
    expect(q(el, '[data-test="member-error"]')).toBeNull();
  });
  it.each(["success", "refusal"] as const)(
    "keeps a pending Include's destination through navigation and %s",
    async (outcome) => {
      const adding = deferred<SectionMember>();
      const client = includeApi({ addSectionMember: vi.fn(() => adding.promise) });
      const el = await mountLunch(client);
      await editDrinks(el);
      await openInclude(el);
      await vi.waitFor(() => expect(client.addSectionMember).toHaveBeenCalledOnce());
      await visit(el, DINNER_PATH, "Dinner Menu");
      expect(modal(el, "include").open).toBe(true);
      if (outcome === "success") adding.resolve(sectionMember("wine", 0, "wine-root"));
      else adding.reject({ code: "menu_section.not_found" });
      await vi.waitFor(() => expect(modal(el, "include").open).toBe(false));
      expect(client.addSectionMember).toHaveBeenCalledExactlyOnceWith("s-drinks", {
        kind: "section",
        sectionId: "wine-root",
      });
      if (outcome === "refusal")
        expect(text(q(el, '[data-test="member-error"]'))).toBe(
          t("menus.change_not_saved")
            .replace("{name}", "Drinks")
            .replace("{reason}", codeMessage("menu_section.not_found")),
        );
      else expect(q(el, '[data-test="member-error"]')).toBeNull();
    },
  );
  it("closes Include without a write when no menu is chosen, then reopens empty", async () => {
    const client = includeApi();
    const el = await mountLunch(client);
    const picker = await openInclude(el, false);
    expect(picker.value).toBe("");
    expect(picker.error).toBe("");
    await click(el, "include-cancel");
    await openInclude(el, false);
    expect(
      inModal<HTMLElement & { value: string }>(el, "include", '[name="included-menu"]').value,
    ).toBe("");
    expect(await bottom(el, "include")).toBe("");
    expect(client.addSectionMember).not.toHaveBeenCalled();
  });
  it("keeps Include retryable after a request refusal", async () => {
    const client = includeApi({
      addSectionMember: vi
        .fn()
        .mockRejectedValueOnce({ code: "menu_section.member_cycle" })
        .mockResolvedValue(sectionMember("wine", 0, "wine-root")),
    });
    const el = await mountLunch(client);
    await openInclude(el);
    await vi.waitFor(async () =>
      expect(await bottom(el, "include")).toBe(codeMessage("menu_section.member_cycle")),
    );
    const picker = inModal<HTMLElement>(el, "include", '[name="included-menu"]');
    await chooseOption(picker, "wine-root");
    await vi.waitFor(() => expect(modal(el, "include").open).toBe(false));
  });
});

describe("review fix: menu details opening", () => {
  const details = (id: string, name: string): MenuStructure => ({
    rootSectionId: `root-${id}`,
    root: {
      id: `root-${id}`,
      internalName: name,
      names: {},
      image: null,
      color: null,
      members: [],
    },
    nodes: [],
    includable: [],
    includedBy: [],
  });
  async function rename(el: MenusScreen, id: string) {
    await table(el).updateComplete;
    table(el).shadowRoot!.querySelector<HTMLElement>(`[data-test="rename-${id}"]`)!.click();
    await el.updateComplete;
  }
  it("keeps B and its draft when A's earlier rename read answers last", async () => {
    const a = deferred<MenuStructure>();
    const b = deferred<MenuStructure>();
    const client = api({
      getMenuStructure: vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise),
    });
    const el = await mount(client);
    await rename(el, "menu-lunch");
    await rename(el, "menu-dinner");
    b.resolve(details("dinner", "Dinner Menu"));
    await vi.waitFor(() => expect(modal(el, "menu-form").open).toBe(true));
    type(inModal(el, "menu-form", '[name="internalName"]'), "Dinner draft");
    await el.updateComplete;
    a.resolve(details("lunch", "Lunch Menu"));
    await new Promise((resolve) => setTimeout(resolve));
    await el.updateComplete;
    expect(
      inModal<HTMLElementTagNameMap["wt-input"]>(el, "menu-form", '[name="internalName"]').value,
    ).toBe("Dinner draft");
    inModal(el, "menu-form", '[data-test="save"]').click();
    await vi.waitFor(() =>
      expect(client.updateMenuDetails).toHaveBeenCalledWith("menu-dinner", {
        internalName: "Dinner draft",
        names: {},
        image: null,
        color: null,
      }),
    );
  });
  it.each(["answer", "failure"] as const)(
    "ignores an obsolete rename %s after New menu",
    async (outcome) => {
      const pending = deferred<MenuStructure>();
      const client = api({ getMenuStructure: vi.fn(() => pending.promise) });
      const el = await mount(client);
      await rename(el, "menu-lunch");
      await click(el, "add-menu");
      type(inModal(el, "menu-form", '[name="internalName"]'), "Brunch draft");
      await el.updateComplete;
      if (outcome === "answer") pending.resolve(details("lunch", "Lunch Menu"));
      else pending.reject({ code: "server.internal" });
      await new Promise((resolve) => setTimeout(resolve));
      await el.updateComplete;
      expect(
        inModal<HTMLElementTagNameMap["wt-input"]>(el, "menu-form", '[name="internalName"]').value,
      ).toBe("Brunch draft");
      expect(q(el, '[data-test="load-error"]')).toBeNull();
    },
  );
  it("ignores a late rename after cancellation", async () => {
    const a = deferred<MenuStructure>();
    const client = api({
      getMenuStructure: vi
        .fn()
        .mockReturnValueOnce(a.promise)
        .mockResolvedValue(details("dinner", "Dinner Menu")),
    });
    const el = await mount(client);
    await rename(el, "menu-lunch");
    await rename(el, "menu-dinner");
    await vi.waitFor(() => expect(modal(el, "menu-form").open).toBe(true));
    inModal(el, "menu-form", '[data-test="cancel"]').click();
    await el.updateComplete;
    a.resolve(details("lunch", "Lunch Menu"));
    await new Promise((resolve) => setTimeout(resolve));
    await el.updateComplete;
    expect(modal(el, "menu-form").open).toBe(false);
  });
  it.each(["answer", "failure"] as const)(
    "ignores an obsolete rename %s after navigation",
    async (outcome) => {
      const pending = deferred<MenuStructure>();
      const client = api();
      client.getMenuStructure.mockReturnValueOnce(pending.promise);
      const el = await mount(client);
      await rename(el, "menu-lunch");
      await inTable(el, "open-menu-dinner");
      if (outcome === "answer") pending.resolve(details("lunch", "Lunch Menu"));
      else pending.reject({ code: "server.internal" });
      await new Promise((resolve) => setTimeout(resolve));
      await el.updateComplete;
      await click(el, "back");
      expect(modal(el, "menu-form").open).toBe(false);
      expect(q(el, '[data-test="load-error"]')).toBeNull();
    },
  );
});

it.each(["light", "dark"] as const)(
  "review fix: gives includer links theme tokens and full hit targets in %s",
  async (theme) => {
    const client = api();
    const read = client.getMenuStructure.getMockImplementation()! as (
      id: string,
    ) => Promise<MenuStructure>;
    client.getMenuStructure.mockImplementation(async (id: string) => ({
      ...(await read(id)),
      includedBy: [{ id: "evening", name: "Evening" }],
    }));
    history.replaceState(null, "", LUNCH_PATH);
    const { el } = await mountWidget<MenusScreen>("dashboard-menus-screen", { api: client }, theme);
    await vi.waitFor(() => expect(q(el, '[data-test="included-by"] a')).not.toBeNull());
    const link = q<HTMLAnchorElement>(el, '[data-test="included-by"] a')!;
    el.style.setProperty("--wt-color-text", "rgb(17, 93, 201)");
    expect(getComputedStyle(link).color).toBe("rgb(17, 93, 201)");
    expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(link.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    link.focus();
    expect(getComputedStyle(link).outlineStyle).not.toBe("none");
  },
);

it("shows the current clash count from the menus status read", async () => {
  const client = api({
    getMenuStatuses: vi.fn().mockResolvedValue({
      ...statuses(),
      "menu-lunch": { ...statuses()["menu-lunch"], clashes: 2 },
    }),
  });
  const el = await mount(client);
  await table(el).updateComplete;
  await vi.waitFor(() =>
    expect(text(table(el).shadowRoot.querySelector('[data-test="status-menu-lunch"]'))).toContain(
      "2 clashes",
    ),
  );
});
it("passes a product-only resolve through as one product write", async () => {
  const client = api();
  const el = await mountPrices(client);
  emit(prices(el), "wt-price-save", {
    key: "mi-lemonade",
    menuItemId: "mi-lemonade",
    variantId: null,
    name: "Lemonade",
    price: "3.50",
    previous: "2.50",
  });
  await vi.waitFor(() =>
    expect(client.updateMenuItem).toHaveBeenCalledExactlyOnceWith("menu-lunch", "mi-lemonade", {
      grossPrice: "3.50",
    }),
  );
  expect(client.setMenuVariantPrice).not.toHaveBeenCalled();
});

describe("after the server comes back", () => {
  const down = { code: "connection.failed" };

  function failing(client: Api, ...names: (keyof DashboardApi)[]): () => void {
    const reads = names.map(
      (name) => [client[name], client[name].getMockImplementation()] as const,
    );
    for (const [read] of reads) read.mockRejectedValue(down);
    return () => {
      for (const [read, answer] of reads) read.mockImplementation(answer!);
    };
  }

  function rowKeys(el: MenusScreen): (string | null)[] {
    return [...table(el).shadowRoot.querySelectorAll("tbody tr")].map((row) =>
      row.getAttribute("data-row-key"),
    );
  }

  function statusCell(el: MenusScreen, menuId: string): string {
    return text(table(el).shadowRoot.querySelector(`[data-test="status-${menuId}"]`));
  }

  it("replaces the could-not-load message with the menus once the server answers again", async () => {
    const live = new LiveData();
    const client = api({
      liveData: live,
      listCatalogues: vi.fn().mockResolvedValue(menus),
      listLibraryProducts: vi.fn().mockResolvedValue(products),
      listCategories: vi.fn().mockResolvedValue(categories),
    });
    const answer = failing(
      client,
      "listCatalogues",
      "listLibraryProducts",
      "listCategories",
      "getContentLanguages",
      "getMenuStatuses",
    );
    const el = await mount(client);
    expect(q(el, '[data-test="load-error"]')).not.toBeNull();

    answer();
    live.refresh();

    await vi.waitFor(() => expect(q(el, '[data-test="load-error"]')).toBeNull());
    await vi.waitFor(() => expect(table(el)).not.toBeNull());
    await table(el).updateComplete;
    expect(rowKeys(el).sort()).toEqual(["menu-dinner", "menu-lunch"]);
    await vi.waitFor(() => expect(statusCell(el, "menu-lunch")).not.toBe(t("menus.status_error")));
  });

  it("replaces the could-not-load message for the open menu's structure once the server answers again", async () => {
    const live = new LiveData();
    const client = api({ liveData: live });
    const answer = failing(client, "getMenuStructure", "getMenuStatus");
    const el = await mount(client, LUNCH_PATH);
    await vi.waitFor(() => expect(q(el, '[data-test="structure-error"]')).not.toBeNull());
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="menu-status"]'))).toBe(t("menus.status_error")),
    );

    answer();
    live.refresh();

    await vi.waitFor(() => expect(structure(el)).not.toBeNull());
    expect(q(el, '[data-test="structure-error"]')).toBeNull();
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="menu-status"]'))).not.toBe(t("menus.status_error")),
    );
  });

  it("shows the open menu's prices once the server answers again", async () => {
    const live = new LiveData();
    const client = api({ liveData: live });
    const answer = failing(client, "getMenuPrices");
    const el = await mount(client, PRICES_PATH);
    await vi.waitFor(() => expect(prices(el)?.failed).toBe(true));

    answer();
    live.refresh();

    await vi.waitFor(() => expect(prices(el).rows.length).toBe(3));
    expect(prices(el).failed).toBe(false);
  });

  it("shows the open menu's preview and state once the server answers again", async () => {
    const live = new LiveData();
    const client = api({ liveData: live });
    const answer = failing(client, "getMenuPreview");
    const el = await mount(client, PREVIEW_PATH);
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="menu-status"]'))).toBe(t("menus.status_error")),
    );

    answer();
    live.refresh();

    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="menu-status"]'))).not.toBe(t("menus.status_error")),
    );
    const preview = q<HTMLElementTagNameMap["dashboard-menu-preview"]>(
      el,
      "dashboard-menu-preview",
    )!;
    expect(preview.failed).toBe(false);
  });

  it("shows the open menu's home page once the server answers again", async () => {
    const live = new LiveData();
    const client = api({ liveData: live });
    const answer = failing(client, "getMenuHome");
    const el = await mount(client, HOME_PATH);
    await vi.waitFor(() => expect(q(el, '[data-test="home-load-error"]')).not.toBeNull());

    answer();
    live.refresh();

    await vi.waitFor(() => expect(q(el, '[data-test="home-load-error"]')).toBeNull());
    expect(q<HTMLElementTagNameMap["wt-slider"]>(el, 'wt-slider[name="home-columns"]')?.value).toBe(
      3,
    );
  });
});

describe("colour swatches on the Structure tab", () => {
  beforeEach(() => page.viewport(1280, 844));
  it("opens the section's own form from a section's swatch", async () => {
    const el = await mountLunch();
    await settleStructure(el);
    inStructure(el, '[data-test="color-m-drinks"]')!.click();
    await el.updateComplete;
    const form = q<HTMLElementTagNameMap["dashboard-section-details-form"]>(
      el,
      '[data-test="section-form"]',
    )!;
    await vi.waitFor(() => expect(form.open).toBe(true));
    expect(form.value?.id).toBe("s-drinks");
    expect(form.getAttribute("heading")).toBe(t("menus.edit_section"));
  });
});

it.each(["en", "es-ES"])(
  "shows the venue-reset refusal on Preview in %s and offers no publish action",
  async (locale) => {
    setLocale(locale);
    onTestFinished(() => setLocale("en"));
    const el = await mount(
      api({
        getMenuPreview: vi
          .fn()
          .mockRejectedValue({ code: "menu.reset_required", params: { menuId: "menu-lunch" } }),
      }),
      PREVIEW_PATH,
    );
    await vi.waitFor(() =>
      expect(
        text(
          q(el, "dashboard-menu-preview")!.shadowRoot!.querySelector('[data-test="preview-error"]'),
        ),
      ).toContain(codeMessage("menu.reset_required")),
    );
    expect(
      q(el, "dashboard-menu-preview")!.shadowRoot!.querySelector('[data-test="publish"]'),
    ).toBeNull();
  },
);

it.each(["en", "es-ES"])(
  "shows the venue-reset refusal in the Home preview in %s",
  async (locale) => {
    setLocale(locale);
    onTestFinished(() => setLocale("en"));
    const el = await mount(
      api({
        getMenuPreview: vi
          .fn()
          .mockRejectedValue({ code: "menu.reset_required", params: { menuId: "menu-lunch" } }),
      }),
      PREVIEW_PATH,
    );
    await chooseTab(el, "home");
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="home-preview-error"]'))).toContain(
        codeMessage("menu.reset_required"),
      ),
    );
  },
);

it.each(["en", "es-ES"])(
  "shows the venue-reset instruction on the menu list in %s",
  async (locale) => {
    setLocale(locale);
    onTestFinished(() => setLocale("en"));
    const el = await mount(
      api({
        getMenuStatuses: vi
          .fn()
          .mockRejectedValue({ code: "menu.reset_required", params: { menuId: "menu-lunch" } }),
      }),
    );
    const expected =
      locale === "en"
        ? "This venue has a menu in an unsupported format. Reset the venue before using menus."
        : "Este local tiene una carta en un formato no compatible. Restablece el local antes de usar las cartas.";
    await vi.waitFor(() => expect(text(q(el, '[data-test="status-reset-error"]'))).toBe(expected));
    cleanupWidgets();
    const selected = await mount(
      api({
        getMenuStatus: vi
          .fn()
          .mockRejectedValue({ code: "menu.reset_required", params: { menuId: "menu-lunch" } }),
      }),
      LUNCH_PATH,
    );
    await vi.waitFor(() => expect(text(q(selected, '[data-test="menu-status"]'))).toBe(expected));
  },
);

it("replaces a later preview reset refusal with the next successful document", async () => {
  setLocale("en");
  onTestFinished(() => setLocale("en"));
  const live = new LiveData();
  const client = api({ liveData: live });
  const normalRead = client.getMenuPreview.getMockImplementation()!;
  const el = await mount(client, PREVIEW_PATH);
  const panel = q<HTMLElementTagNameMap["dashboard-menu-preview"]>(el, "dashboard-menu-preview")!;
  await vi.waitFor(() => expect(panel.preview).not.toBeNull());
  client.getMenuPreview.mockRejectedValue({
    code: "menu.reset_required",
    params: { menuId: "menu-lunch" },
  });
  live.refresh();
  await vi.waitFor(() =>
    expect(text(panel.shadowRoot!.querySelector('[data-test="preview-error"]'))).toContain(
      "Reset the venue before using menus.",
    ),
  );
  client.getMenuPreview.mockImplementation(normalRead);
  live.refresh();
  await vi.waitFor(() =>
    expect(panel.shadowRoot!.querySelector('[data-test="preview-error"]')).toBeNull(),
  );
  expect(panel.failed).toBe(false);
  expect(panel.preview!.document.menuId).toBe("menu-lunch");
});

describe("one menu read after an edit", () => {
  it.each(
    (["structure", "home"] as const).flatMap((view) =>
      (["before", "after"] as const).map((notification) => ({ view, notification })),
    ),
  )(
    "shares one HTTP menu read after an edit on $view when notified $notification the response",
    async ({ view, notification }) => {
      const fixture = api();
      let home = menuHome();
      let sequence = 0;
      const reads: string[] = [];
      const writes: Array<{ path: string; body: unknown }> = [];
      const client = new DashboardApi("", async (path, init) => {
        if (init.method !== "GET") {
          sequence++;
          writes.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined });
          if (view === "structure")
            home = {
              ...home,
              shortcuts: home.shortcuts.filter(({ memberId }) => memberId !== "t-burger"),
            };
          else home = { ...home, handheld: { ...home.handheld, columns: 2 } };
          if (notification === "before") {
            client.liveData.invalidate([
              { type: view === "structure" ? "section_members" : "menu_details" },
            ]);
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          return new Response(null, {
            status: 204,
            headers: { "x-waitron-menu-revision": JSON.stringify({ epoch: "test", sequence }) },
          });
        }
        reads.push(path);
        const bodies: Record<string, () => unknown | Promise<unknown>> = {
          "/management-api/catalogues": () => menus,
          "/management-api/products": () => products,
          "/management-api/categories": () => categories,
          "/api/content-languages": () => ({ defaultLanguage: "es", languages: ["es", "en"] }),
          "/management-api/catalogues/status": () => statuses(),
          "/management-api/catalogues/menu-lunch/structure": () =>
            fixture.getMenuStructure("menu-lunch"),
          "/management-api/catalogues/menu-lunch/home": () => home,
          "/management-api/catalogues/menu-lunch/status": () => statuses()["menu-lunch"],
          "/management-api/catalogues/menu-lunch/preview": () => lunchPreview(),
        };
        const url = new URL(path, "http://localhost");
        if (url.pathname === "/management-api/catalogues/menu-lunch/read") {
          const entries = await Promise.all(
            url.searchParams.getAll("part").map(async (part) => {
              const read = bodies[`/management-api/catalogues/menu-lunch/${part}`];
              if (!read) throw new Error(`Unexpected menu part: ${part}`);
              return [part, { status: 200, body: await read() }];
            }),
          );
          return Response.json({
            ...Object.fromEntries(entries),
            revision: { epoch: "test", sequence },
          });
        }
        const body = bodies[path];
        if (!body) throw new Error(`Unexpected GET: ${path}`);
        return Response.json(await body());
      });
      const el = await mount(
        client as unknown as Api,
        view === "structure" ? LUNCH_PATH : HOME_PATH,
      );
      await vi.waitFor(() => {
        expect(structure(el)).not.toBeNull();
        if (view === "structure") expect(rowOf(el, "home")).not.toBeNull();
        else expect(q(el, 'wt-slider[name="home-columns"]')).not.toBeNull();
      });
      await structure(el).updateComplete;
      reads.length = 0;
      if (view === "structure") {
        emit(structure(el), "wt-shortcut-remove", { memberId: "t-burger" });
      } else {
        const slider = q<HTMLElementTagNameMap["wt-slider"]>(el, 'wt-slider[name="home-columns"]')!;
        await slider.updateComplete;
        const input = slider.shadowRoot!.querySelector<HTMLInputElement>('input[type="range"]')!;
        input.value = "2";
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      // The stream notifies the screen of the accepted write's changed table.
      if (notification === "after")
        client.liveData.invalidate([
          { type: view === "structure" ? "section_members" : "menu_details" },
        ]);
      await vi.waitFor(() => {
        if (view === "structure") {
          expect(structure(el).home!.shortcuts.map(({ memberId }) => memberId)).toEqual([
            "t-drinks",
            "t-chips",
          ]);
          expect(structure(el).busy).toBe(false);
        } else
          expect(
            q<HTMLElementTagNameMap["wt-slider"]>(el, 'wt-slider[name="home-columns"]')!.value,
          ).toBe(2);
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      const menuReads = reads.filter((path) =>
        path.startsWith("/management-api/catalogues/menu-lunch/"),
      );
      expect(writes[0]).toEqual(
        view === "structure"
          ? {
              path: "/management-api/catalogues/menu-lunch/home/shortcuts/t-burger",
              body: undefined,
            }
          : {
              path: "/management-api/catalogues/menu-lunch/home-display",
              body: { device: "handheld", columns: 2 },
            },
      );
      expect(menuReads, JSON.stringify(menuReads)).toHaveLength(1);
    },
  );
});

it("keeps a reconnected menu's snapshot when the departed initial read answers late", async () => {
  const client = api();
  const oldStructure = await client.getMenuStructure("menu-lunch");
  const old = deferred<MenuStructure>();
  client.getMenuStructure.mockReset();
  client.getMenuStructure
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue({ ...oldStructure, nodes: [] });
  const el = await mount(client, LUNCH_PATH);
  const parent = el.parentElement!;
  el.remove();
  parent.append(el);
  await vi.waitFor(() => expect(structure(el)).not.toBeNull());
  expect(structure(el).nodes).toEqual([]);
  old.resolve(oldStructure);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await el.updateComplete;
  expect(structure(el).nodes).toEqual([]);
});

for (const route of ["cancel", "escape"] as const) {
  it(`W69 Menu Add products ${route} asks before discarding chosen products`, async () => {
    const host = await placementLeaveHost();
    const el = await mountLunch(api());
    await editDrinks(el);
    await rowAction(el, "m-drinks", "open-add-products");
    const picker = inModal<SectionAddProducts>(
      el,
      "add-products",
      "dashboard-section-add-products",
    );
    await picker.updateComplete;
    picker.shadowRoot!.querySelector<HTMLInputElement>('input[value="p-chips"]')!.click();
    await picker.updateComplete;
    if (route === "cancel")
      picker.querySelector<HTMLElement>("[data-test=add-products-cancel]")!.click();
    else await userEvent.keyboard("{Escape}");
    await host.updateComplete;
    const q = host.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await q.updateComplete;
    await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
    expect(q.open).toBe(true);
    expect(modal(el, "add-products").shadowRoot!.querySelector("dialog")!.open).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(
      picker.shadowRoot!.querySelector<HTMLInputElement>('input[value="p-chips"]')!.checked,
    ).toBe(true);
    picker.querySelector<HTMLElement>("[data-test=add-products-cancel]")!.click();
    await host.updateComplete;
    await q.updateComplete;
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => modal(el, "add-products").open).toBe(false);
    expect(host.leave.coordinator.isDirty()).toBe(false);
  });
}
for (const succeeds of [true, false]) {
  it(`W69 Menu Add products ${succeeds ? "commits before close and failed refresh" : "keeps a refused choice dirty"}`, async () => {
    const host = await placementLeaveHost();
    const client = api();
    client.addSectionProducts.mockImplementation(async () => {
      if (!succeeds) throw { code: "menu_section.membership_invalid" };
      client.getMenuStructure.mockRejectedValue({ code: "connection.failed" });
      return { added: 1 };
    });
    const el = await mountLunch(client);
    await editDrinks(el);
    await rowAction(el, "m-drinks", "open-add-products");
    const picker = inModal<SectionAddProducts>(
      el,
      "add-products",
      "dashboard-section-add-products",
    );
    await picker.updateComplete;
    picker.shadowRoot!.querySelector<HTMLInputElement>('input[value="p-chips"]')!.click();
    await picker.updateComplete;
    const saved = picker.commitSaved.bind(picker);
    let atCommit: unknown;
    vi.spyOn(picker, "commitSaved").mockImplementation((ids) => {
      saved(ids);
      atCommit = {
        ids,
        open: modal(el, "add-products").open,
        dirty: host.leave.coordinator.isDirty([picker]),
      };
    });
    picker.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
    await vi.waitFor(() =>
      expect(client.addSectionProducts).toHaveBeenCalledExactlyOnceWith("s-drinks", ["p-chips"]),
    );
    if (succeeds) {
      await expect.poll(() => atCommit).toEqual({ ids: ["p-chips"], open: true, dirty: false });
      await expect.poll(() => modal(el, "add-products").open).toBe(false);
      expect(host.leave.coordinator.isDirty()).toBe(false);
    } else {
      await expect.poll(() => picker.busy).toBe(false);
      expect(atCommit).toBeUndefined();
      picker.querySelector<HTMLElement>("[data-test=add-products-cancel]")!.click();
      await host.updateComplete;
      const q = host.shadowRoot!.querySelector("wt-unsaved-changes")!;
      await q.updateComplete;
      expect(q.open).toBe(true);
    }
  });
}

it.each(["link", "keyboard", "address", "retry"])(
  "A349 opens Clashes from the Preview %s despite remembered All prices",
  async (entry) => {
    const before = currentLocale();
    setLocale("en");
    try {
      const rows = lunchPrices();
      const lager = rows.find((row) => row.productId === "p-lager")!;
      lager.combined = {
        ...lager.combined,
        price: {
          state: "clash",
          candidates: [
            { value: "2.80", place: { kind: "own_sections" }, source: { kind: "product" } },
            {
              value: "3.00",
              place: { kind: "menu", menuId: "drinks", menuName: "Drinks" },
              source: { kind: "own" },
            },
          ],
        } as MenuPriceRow["combined"]["price"],
      };
      const value = lunchPreview();
      value.document = { ...value.document, menuId: "menu-lunch" };
      value.clashes = [
        {
          productId: "p-lager",
          variantId: null,
          field: "price",
          candidates: lager.combined.price.state === "clash" ? lager.combined.price.candidates : [],
        },
      ] as MenuPreview["clashes"];
      const client = api({
        getMenuPrices: vi.fn(async () => rows),
        getMenuPreview: vi.fn(async () => value),
      });
      const el = await mountPrices(client);
      const priceTable = () =>
        prices(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
          "wt-data-table",
        )!;
      await priceTable().updateComplete;
      priceTable().chooseFilter("override", []);
      await priceTable().updateComplete;
      expect(priceTable().filterValues("override")).toEqual([]);
      await chooseTab(el, "preview");
      await vi.waitFor(() =>
        expect(
          q(el, "dashboard-menu-preview")?.shadowRoot?.querySelector('[data-test="clash-prices"]'),
        ).not.toBeNull(),
      );
      const link = q(el, "dashboard-menu-preview")!.shadowRoot!.querySelector<HTMLAnchorElement>(
        '[data-test="clash-prices"]',
      )!;
      expect(link.getAttribute("href")).toBe(`${PRICES_PATH}/filter/clashes`);
      const pending = deferred<MenuPriceRow[]>();
      client.getMenuPrices.mockImplementation(() => pending.promise);
      if (entry !== "address") {
        link.addEventListener("click", (event) => event.preventDefault());
        if (entry === "keyboard") {
          link.focus();
          await userEvent.keyboard("{Enter}");
        } else await userEvent.click(link);
      } else {
        history.pushState(null, "", link.href);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
      await vi.waitFor(() => expect(prices(el).loading).toBe(true));
      if (entry === "retry") {
        pending.reject(new Error("down"));
        await vi.waitFor(() => expect(prices(el).failed).toBe(true));
        client.getMenuPrices.mockResolvedValue(rows);
        await click(el, "prices-retry");
      } else pending.resolve(rows);
      await vi.waitFor(() =>
        expect(
          priceTable().filterValues("override"),
          JSON.stringify({
            url: location.pathname,
            clashesFor: prices(el).clashesFor,
            loading: prices(el).loading,
            failed: prices(el).failed,
            rows: prices(el).rows.length,
          }),
        ).toEqual(["clash"]),
      );
      expect(
        [...priceTable().shadowRoot!.querySelectorAll("tbody tr[data-row-key]")].map((row) =>
          row.getAttribute("data-row-key"),
        ),
      ).toEqual(["mi-lager"]);
      priceTable().chooseFilter("override", []);
      await priceTable().updateComplete;
      history.replaceState(null, "", location.href);
      window.dispatchEvent(new PopStateEvent("popstate"));
      await el.updateComplete;
      expect(priceTable().filterValues("override")).toEqual([]);
      await chooseTab(el, "structure");
      await chooseTab(el, "prices");
      await vi.waitFor(() => expect(prices(el).loading).toBe(false));
      expect(location.pathname).toBe(PRICES_PATH);
      expect(priceTable().filterValues("override")).toEqual([]);
    } finally {
      setLocale(before);
    }
  },
);

it.each([
  ["/manage/menus/filter/clashes", "/manage/menus"],
  ["/manage/menus/menu/menu-lunch/view/structure/filter/clashes", LUNCH_PATH],
  ["/manage/menus/menu/menu-lunch/view/prices/filter/unknown", PRICES_PATH],
])(
  "A349 removes a price-filter request that does not name a Prices destination: %s",
  async (path, wanted) => {
    await mount(api(), path);
    expect(location.pathname).toBe(wanted);
  },
);

it("A349 removes the explicit price-filter destination when returning to the menu list", async () => {
  const el = await mount(api(), `${PRICES_PATH}/filter/clashes`);
  await click(el, "back");
  expect(location.pathname).toBe("/manage/menus");
});
