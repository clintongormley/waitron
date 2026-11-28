import { useLocale } from "../testing/locale-setup.js";
import { LitElement, html } from "lit";
import { LeaveController, NavigationGuard } from "@waitron/ui";
import { combinedFixture, selectPreviewPane } from "../widgets/test-helpers.js";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import {
  LiveData,
  type MenuPeriodUsageProvider,
  type MenuPeriodUsage,
} from "@waitron/dashboard-kit";
import {
  cleanupWidgets,
  computedColour,
  dialogClosed,
  documentProduct,
  documentSection,
  expectNoA11yViolations,
  menuDocument,
  menuReadFixture,
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
  IncludeFolder,
  MenuHome,
  MemberRef,
  MenuPreview,
  MenuPriceRow,
  MenuStatus,
  Product,
  SectionMember,
} from "../api/client.js";
import type { CategorySummary } from "../api/catalog-api.js";
import type {
  MenuSummary,
  MenuReadPart,
  MenuStructure,
  MenuStructureNode,
} from "../api/menu-api.js";
import type { DashboardApp } from "../dashboard-app.js";
import type { MenuDocumentTree } from "../widgets/menu-document-tree.js";
import type { ProductEditor } from "../widgets/product-editor.js";
import type { SectionAddProducts } from "../widgets/section-add-products.js";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { decimal, type MenuStructureSaveInput } from "@waitron/shared";
import type { StringKey } from "../i18n/strings.js";
import { codeMessage } from "../i18n/codes.js";

useLocale("es-ES");

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
beforeEach(() => history.replaceState(null, "", "/menus"));

const LUNCH_PATH = "/menus/menu/menu-lunch/view/structure";
const PRICES_PATH = "/menus/menu/menu-lunch/view/prices";
const PREVIEW_PATH = "/menus/menu/menu-lunch/view/preview";
const HOME_PATH = "/menus/menu/menu-lunch/view/home";

/** The three names read differently (docs/developers/products.md), so a surface showing the
 * customer-facing or kitchen name where the staff name belongs fails. */
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
  product("p-lager", "Lager", { categoryId: "c-beer" }),
  product("p-lemonade", "Lemonade", { categoryId: "c-drinks" }),
  product("p-burger", "Burger", { categoryId: "c-mains" }),
  product("p-chips", "Chips", { categoryId: "c-mains" }),
  product("p-soup", "Old soup", { active: false }),
];

const categories: CategorySummary[] = [
  { id: "c-drinks", name: "Beverages", parentId: null, color: null },
  { id: "c-beer", name: "Beer", parentId: "c-drinks", color: null },
  { id: "c-mains", name: "Mains", parentId: null, color: null },
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

const sectionMember = (id: string, position: number, sectionId: string): SectionMember => ({
  id,
  position,
  ref: { kind: "section", sectionId },
});

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

/** Lunch with Favourites holding Beer twice: on its own, and inside the Drinks it also holds. */
function lunchWithBeerTwiceInFavourites(): MenuStructureNode[] {
  const nodes = lunchNodes();
  const beer = drinksNode("m-unused").children!.find((node) => node.memberId === "m-beer")!;
  nodes
    .find((node) => node.memberId === "m-fav")!
    .children!.push({ ...beer, memberId: "m-fav-beer" });
  return nodes;
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
      available: true,
      variants: [],
    },
    {
      menuItemId: "mi-lemonade",
      combined: combinedFixture(
        "p-lemonade",
        "3.00",
        [
          { variantId: "v-small", price: null },
          { variantId: "v-large", price: "3.75" },
        ],
        null,
        "3.00",
        { "v-large": "3.40" },
      ),
      productId: "p-lemonade",
      name: "Lemonade",
      categoryId: "c-drinks",
      placements: [["s-fav"], ["s-drinks"]],
      override: null,
      effectivePrice: "3.00",
      available: true,
      variants: [
        { variantId: "v-small", price: null, available: true },
        { variantId: "v-large", price: "3.75", available: true },
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
      available: true,
      variants: [],
    },
  ];
}

const WRITES = [
  "createMenu",
  "duplicateMenu",
  "updateMenuDetails",
  "saveMenuStructure",
  "createSectionIn",
  "updateSection",
  "setIncludeFolder",
  "deleteSection",
  "addSectionMember",
  "addSectionProducts",
  "removeSectionMember",
  "removeSectionMembers",
  "deleteSections",
  "moveSectionMember",
  "moveSectionMembersInto",
  "updateMenuItem",
  "publishMenu",
  "saveMenuHome",
  "scheduleMenuPublication",
  "rescheduleMenuPublication",
  "cancelMenuPublication",
] as const;

const PUBLISHED_AT = "2026-09-26T10:15:00.000Z";
/** The screen's clock: Lunch's PUBLISHED_AT is 1 hour 15 minutes before it, Dinner's 20 September
 * publication under six days. The browser runs in UTC (vitest.config.ts). */
const clock = { now: "2026-09-26T11:30:00.000Z" };
const NEXT_PUBLISHED_AT = "2026-09-26T10:35:00.000Z";
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
    setMenuProblems: [],
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
        fields: ["color"],
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
    setMenuProblems: [],
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
    order: "home_first",
  };
}

/** A menu whose Device Home Page holds no shortcuts. */
function emptyHome(homeSectionId = "home-dinner"): MenuHome {
  return { ...menuHome(), homeSectionId, shortcuts: [] };
}

/** A menu's top level the fake keeps, so a move is visible in what the next read answers. */
type ApiOverrides = Partial<Record<keyof DashboardApi, unknown>> & {
  priceRows?: ReturnType<typeof vi.fn<(id: string) => Promise<MenuPriceRow[]>>>;
};

function api(overrides: ApiOverrides = {}, nodes: MenuStructureNode[] = lunchNodes()) {
  let root = nodes;
  const client = {
    listMenus: vi.fn().mockResolvedValue(menus),
    getCustomerMenuCloudStatus: vi.fn().mockResolvedValue({ status: "unavailable" }),
    listLibraryProducts: vi.fn().mockResolvedValue(products),
    listCategories: vi.fn().mockResolvedValue(categories),
    getMenuSettings: vi
      .fn()
      .mockResolvedValue({ defaultProductVatClass: "general", defaultColor: null }),
    getVenueTheme: vi.fn().mockResolvedValue({ hash: "waitron", css: "", logo: null }),
    getLegalAbout: vi.fn().mockResolvedValue({ release: null, build: "test" }),
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
            placeableSetMenus: [],
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
            placeableSetMenus: [],
            includable: [],
            includedBy: [],
            nodes: [],
          },
    ),
    createMenu: vi.fn(async (name: string) => ({
      id: "menu-new",
      name,
      active: true,
      version: 1,
    })),
    duplicateMenu: vi.fn(async (_id: string, name: string) => ({
      id: "menu-copy",
      name,
      active: true,
      version: 1,
    })),
    updateMenuDetails: vi.fn().mockResolvedValue(undefined),
    saveMenuStructure: vi.fn().mockResolvedValue({ dropped: [] }),
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
    removeSectionMembers: vi.fn(async (members: { listId: string; memberId: string }[]) => {
      const gone = members
        .filter(({ listId }) => listId === "root-lunch")
        .map(({ memberId }) => memberId);
      root = root.filter((node) => !gone.includes(node.memberId));
    }),
    /** Deletes the named sections and every section below them, wherever each is shown. */
    deleteSections: vi.fn(async (ids: string[]) => {
      const gone = new Set<string>();
      const collect = (nodes: MenuStructureNode[], inside: boolean) => {
        for (const node of nodes) {
          const deleted =
            node.ref.kind === "section" &&
            !node.includedMenuId &&
            (inside || ids.includes(node.ref.sectionId));
          if (deleted && node.ref.kind === "section") gone.add(node.ref.sectionId);
          collect(node.children ?? [], deleted);
        }
      };
      collect(root, false);
      const strip = (nodes: MenuStructureNode[]): MenuStructureNode[] =>
        nodes.flatMap((node) =>
          node.ref.kind === "section" && gone.has(node.ref.sectionId)
            ? []
            : [node.children ? { ...node, children: strip(node.children) } : node],
        );
      root = strip(root);
    }),
    /** Takes the named members out wherever they sit and appends them, in order, to `listId`. */
    moveSectionMembersInto: vi.fn(
      async (listId: string, members: { listId: string; memberId: string }[]) => {
        const ids = members.map(({ memberId }) => memberId);
        const taken = new Map<string, MenuStructureNode>();
        const strip = (nodes: MenuStructureNode[]): MenuStructureNode[] =>
          nodes.flatMap((node) => {
            if (ids.includes(node.memberId)) {
              if (!taken.has(node.memberId)) taken.set(node.memberId, node);
              return [];
            }
            return [node.children ? { ...node, children: strip(node.children) } : node];
          });
        root = strip(root);
        const moved = ids.flatMap((id) => (taken.has(id) ? [taken.get(id)!] : []));
        const place = (nodes: MenuStructureNode[]): MenuStructureNode[] =>
          nodes.map((node) =>
            node.ref.kind === "section" && node.ref.sectionId === listId
              ? { ...node, children: [...(node.children ?? []), ...structuredClone(moved)] }
              : node.children
                ? { ...node, children: place(node.children) }
                : node,
          );
        root = listId === "root-lunch" ? [...root, ...moved] : place(root);
        return [];
      },
    ),
    moveSectionMember: vi.fn(async (list: string, memberId: string, to: number) => {
      if (list === "root-lunch") {
        const moved = root.find((node) => node.memberId === memberId)!;
        root = root.filter((node) => node !== moved);
        root.splice(to, 0, moved);
      }
      return root.map((node, position) => ({ id: node.memberId, position, ref: node.ref }));
    }),
    priceRows: vi.fn(async (id: string) => (id === "menu-lunch" ? lunchPrices() : [])),
    updateMenuItem: vi.fn().mockResolvedValue(undefined),
    getMenuStatuses: vi.fn(async () => statuses()),
    getMenuStatus: vi.fn(
      async (id: string) => statuses()[id] ?? { state: "unpublished", clashes: 0 },
    ),
    getMenuPreview: vi.fn(async (id: string) =>
      id === "menu-lunch" ? lunchPreview() : dinnerPreview(),
    ),
    publishMenu: vi.fn().mockResolvedValue({
      versionId: "v-lunch-3",
      number: 3,
      publishedAt: NEXT_PUBLISHED_AT,
    }),
    getMenuPublications: vi.fn(async () => ({
      timeZone: "Europe/Madrid",
      live: null,
      editions: [],
    })),
    scheduleMenuPublication: vi.fn(),
    rescheduleMenuPublication: vi.fn(),
    cancelMenuPublication: vi.fn(),
    getMenuHome: vi.fn(async (id: string) => (id === "menu-lunch" ? menuHome() : emptyHome())),
    saveMenuHome: vi.fn(),
    getLiveMenu: vi.fn().mockResolvedValue(null),
    patchLiveMenu: vi.fn(),
    ...overrides,
  };
  Object.assign(client, {
    getMenuRead: vi.fn((id: string, parts: readonly MenuReadPart[]) =>
      menuReadFixture(client as unknown as DashboardApi, id, parts, client.priceRows),
    ),
  });
  return client as unknown as DashboardApi & { priceRows: typeof client.priceRows } & {
    [K in keyof DashboardApi]: ReturnType<typeof vi.fn>;
  };
}

type Api = ReturnType<typeof api>;

function writeCalls(client: Api): string[] {
  return WRITES.flatMap((name) =>
    (client[name] as ReturnType<typeof vi.fn>).mock.calls.map(() => name),
  );
}

async function saveStructure(el: MenusScreen): Promise<void> {
  await click(el, "structure-save");
}

function structureWrite(client: Api): MenuStructureSaveInput {
  expect(client.saveMenuStructure).toHaveBeenCalledOnce();
  const [menuId, input] = client.saveMenuStructure.mock.calls[0]!;
  expect(menuId).toBe("menu-lunch");
  return input as MenuStructureSaveInput;
}

async function mount(client: Api = api(), path = "/menus", theme?: "light" | "dark") {
  history.replaceState(null, "", path);
  const { el } = await mountWidget<MenusScreen>(
    "dashboard-menus-screen",
    { api: client, now: () => new Date(clock.now) },
    theme,
  );
  await vi.waitFor(
    () => {
      if (el.shadowRoot!.querySelector('[data-test="loading"]')) throw new Error("loading");
    },
    { interval: 5 },
  );
  await el.updateComplete;
  return el;
}

it("shows the public address only on eligible menu rows in both layouts", async () => {
  const locale = currentLocale();
  setLocale("en");
  onTestFinished(() => setLocale(locale));
  const previous = [innerWidth, innerHeight] as const;
  const client = api({
    getCustomerMenuCloudStatus: async () => ({
      status: "ready",
      origin: "https://cafe.example.test",
    }),
    listMenus: async () => [
      { ...menus[0]!, onlineAddress: "lunch" },
      menus[1]!,
      { ...menus[0]!, id: "unpublished", name: "Draft", onlineAddress: "draft" },
      { ...menus[0]!, id: "set", name: "Set lunch", kind: "set_menu", onlineAddress: "set" },
    ],
    getMenuStatuses: async () => ({
      ...statuses(),
      unpublished: { state: "unpublished", clashes: 0 },
    }),
  });
  try {
    for (const width of [1280, 390]) {
      await page.viewport(width, 800);
      if (width === 1280) await mount(client);
      const links = page.getByRole("link", { name: /\(opens in a new tab\)$/ });
      await expect.element(links).toHaveLength(1);
      await expect.element(links).toHaveAccessibleName("/lunch (opens in a new tab)");
      await expect.element(links).toHaveAttribute("href", "https://cafe.example.test/lunch");
      await expect.element(links).toHaveAttribute("target", "_blank");
      await expect.element(links).toHaveTextContent("/lunch");
    }
  } finally {
    await page.viewport(...previous);
  }
});

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

/** A node's visible text, without a `wt-tabs` label's hidden bold copy, and with each relative
 * time's words, which its shadow root holds. */
function text(node: Element | null): string {
  const times = [...(node?.querySelectorAll("wt-relative-time") ?? [])];
  const copy = node?.cloneNode(true) as Element | undefined;
  copy?.querySelectorAll('.bold-copy[aria-hidden="true"]').forEach((hidden) => hidden.remove());
  copy
    ?.querySelectorAll("wt-relative-time")
    .forEach((time, index) =>
      time.replaceWith(times[index]!.shadowRoot?.querySelector("time")?.textContent ?? ""),
    );
  return (copy?.textContent ?? "").replace(/\s+/g, " ").trim();
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

async function chooseOrdinaryMenu(el: MenusScreen, add: HTMLElement): Promise<void> {
  add.click();
  await el.updateComplete;
  await vi.waitFor(() => expect(modal(el, "menu-form").open).toBe(true));
}

async function click(el: MenusScreen, testId: string): Promise<void> {
  if (testId === "add-menu") return chooseOrdinaryMenu(el, headerAdd(el));
  (testId === "select" ? modeToggle(el) : q(el, `[data-test="${testId}"]`))!.click();
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

const modeHost = (el: MenusScreen) => q(el, 'wt-icon-button[data-test="select"]')!;
function modeToggle(el: MenusScreen): HTMLButtonElement {
  return modeHost(el).shadowRoot!.querySelector("button")!;
}

async function pressMode(el: MenusScreen): Promise<void> {
  modeToggle(el).click();
  await settleStructure(el);
}

/** Opens or closes a section by its row, as a click on it does. */
async function toggleRow(el: MenusScreen, key: string): Promise<void> {
  rowOf(el, key)!.querySelector<HTMLElement>(".row-activate")!.click();
  await settleStructure(el);
}

/** The root row's ⋮, which holds the adds for the menu's own top level. */
function rootAdds(el: MenusScreen): HTMLElementTagNameMap["wt-row-actions"] | null {
  return inStructure(el, '[data-test="actions-root"]');
}

/** Opens a row's ⋮ — for `""`, the root row's — and chooses `action` in it, focusing the item
 * first as a person's click leaves it. */
async function rowAction(el: MenusScreen, key: string, action: string): Promise<void> {
  await settleStructure(el);
  if (key === "") {
    rootAdds(el)!.show();
    const item = inStructure(el, `[data-test="${CSS.escape(`${action}-top`)}"]`)!;
    item.focus();
    item.click();
    await settleStructure(el);
    return;
  }
  inStructure<HTMLElementTagNameMap["wt-row-actions"]>(
    el,
    `[data-test="${CSS.escape(`actions-${key}`)}"]`,
  )!.show();
  const item = inStructure(el, `[data-test="${CSS.escape(`${action}-${key}`)}"]`)!;
  item.focus();
  item.click();
  await settleStructure(el);
}

/** Chooses `action` among the adds an empty menu's tree draws in its empty box. */
async function emptyAdd(el: MenusScreen, action: string): Promise<void> {
  await settleStructure(el);
  const item = structure(el).shadowRoot!.querySelector<HTMLElement>(
    `[data-test="${CSS.escape(`${action}-empty`)}"]`,
  )!;
  item.focus();
  item.click();
  await settleStructure(el);
}

/** The keys of the rows drawn at the menu's own top level, under the menu's own row, in order. */
function topLevelKeys(el: MenusScreen): string[] {
  return allInStructure(el, 'tbody tr[aria-level="2"]').map((row) => row.dataset.rowKey!);
}

/** The keys of the member rows drawn directly under `key`'s row (`""`: the top level), in order. */
function childKeys(el: MenusScreen, key: string): string[] {
  const depth = key === "" ? 0 : key.split("/").length;
  return allInStructure(el, "tbody tr[data-row-key]")
    .map((row) => row.dataset.rowKey!)
    .filter(
      (shown) =>
        shown !== "root" &&
        shown.split("/").length === depth + 1 &&
        (depth === 0 || shown.startsWith(`${key}/`)),
    );
}

/** The menu's name, then the names down to the row marked current; the menu's name alone when
 * the tree is at the top level, which no row is marked for; "" when a section is current but no
 * row is marked. */
function currentPlace(el: MenusScreen): string {
  const key = inStructure(el, '[aria-current="true"]')?.closest("tr")?.dataset.rowKey;
  if (key === undefined) return structure(el).current.length === 0 ? structure(el).menuName : "";
  const segments = key.split("/");
  return [
    structure(el).menuName,
    ...segments.map((_, index) =>
      text(rowOf(el, segments.slice(0, index + 1).join("/"))!.querySelector('[data-test="name"]')),
    ),
  ].join(" › ");
}

/** The key of the row marked current; `""` at the menu's top level, which no row is marked for. */
function currentKey(el: MenusScreen): string {
  const marked = inStructure(el, '[aria-current="true"]');
  if (marked === null && structure(el).current.length === 0) return "";
  return marked!.closest("tr")!.dataset.rowKey!;
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
    placeableSetMenus: [],
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
  expect(tabs.items.map((item) => item.key)).toEqual([
    "structure",
    "home",
    "preview",
    "customer-menu",
  ]);
  history.back();
  await vi.waitFor(() => expect(location.pathname).toBe("/menus"));
  await vi.waitFor(() => expect(text(q(el, "h1"))).toBe(t("menus.title")));
});

it("lists the menus by name, and reverses that order when the name heading is pressed", async () => {
  // Listed against name order, with ids that sort WITH that listing, so a list kept in the order
  // it came in, or sorted by id, fails.
  const el = await mount(
    api({
      listMenus: vi.fn().mockResolvedValue([
        { id: "menu-a", name: "Terrace Menu", active: true },
        { id: "menu-b", name: "Brunch Menu", active: true },
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

it("draws the menu's own colour on its Structure root row, and the colour its settings then save once it is opened again", async () => {
  let color: string | null = "#aa3300";
  const client = api();
  const read = client.getMenuStructure.getMockImplementation() as (
    id: string,
  ) => Promise<MenuStructure>;
  client.getMenuStructure.mockImplementation(async (id: string) => {
    const value = await read(id);
    return id === "menu-lunch" ? { ...value, root: { ...value.root, color } } : value;
  });
  client.updateMenuDetails.mockImplementation(async (_id: string, input: { color: string }) => {
    color = input.color;
  });
  const el = await mountLunch(client);
  const chip = () => rowOf(el, "root")!.querySelector<HTMLElement>('[part~="color-swatch"]')!;
  await settleStructure(el);
  expect(getComputedStyle(chip()).backgroundColor).toBe("rgb(170, 51, 0)");
  await click(el, "back");
  await inTable(el, "rename-menu-lunch");
  const swatch = inModal(el, "menu-form", 'button[data-color]:not([data-color=""])');
  const picked = swatch.dataset.color!;
  expect(picked).not.toBe("#aa3300");
  swatch.click();
  await el.updateComplete;
  inModal(el, "menu-form", '[data-test="menu-save"]').click();
  await vi.waitFor(() => expect(modal(el, "menu-form").open).toBe(false));
  expect(client.updateMenuDetails).toHaveBeenCalledWith(
    "menu-lunch",
    expect.objectContaining({ color: picked }),
  );
  await inTable(el, "edit-menu-lunch");
  await vi.waitFor(() => expect(structure(el)).not.toBeNull());
  await settleStructure(el);
  const probe = document.createElement("span");
  probe.style.backgroundColor = picked;
  document.body.append(probe);
  onTestFinished(() => probe.remove());
  expect(getComputedStyle(chip()).backgroundColor).toBe(getComputedStyle(probe).backgroundColor);
});

it("opens the menu and tab the address names, and leaves the list by the Back control", async () => {
  const client = api();
  const el = await mountLunch(client);
  expect(text(q(el, "h1"))).toBe("Lunch Menu");
  expect(client.getMenuStructure).toHaveBeenCalledWith("menu-lunch");
  await click(el, "back");
  expect(location.pathname).toBe("/menus");
  expect(table(el)).not.toBeNull();
});

it("replaces an address naming an unknown menu or tab rather than adding a history entry", async () => {
  const push = vi.spyOn(history, "pushState");
  onTestFinished(() => push.mockRestore());
  const el = await mount(api(), "/menus/menu/menu-gone/view/structure");
  await vi.waitFor(() => expect(location.pathname).toBe("/menus"));
  expect(table(el)).not.toBeNull();
  cleanupWidgets();
  await mount(api(), "/menus/menu/menu-lunch/view/bogus");
  await vi.waitFor(() => expect(location.pathname).toBe(LUNCH_PATH));
  expect(push).not.toHaveBeenCalled();
});

it("puts Add menu under the empty menu table's sentence, opening the same form", async () => {
  const el = await mount(api({ listMenus: vi.fn().mockResolvedValue([]) }));
  const button = table(el).querySelector<HTMLElement>(":scope > [slot=empty-action]")!;
  expect(button.assignedSlot).not.toBeNull();
  expect(button.textContent!.trim()).toBe(t("menus.add"));
  await chooseOrdinaryMenu(el, button);
  expect(modal(el, "menu-form").open).toBe(true);
});

/** Opens the menu form from the empty table's Add menu, focused as a person's click leaves it. */
async function openFromEmptyTable(el: MenusScreen): Promise<HTMLElement> {
  const button = table(el).querySelector<HTMLElement>(":scope > [slot=empty-action]")!;
  button.focus();
  await chooseOrdinaryMenu(el, button);
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
    api({ listMenus: vi.fn().mockResolvedValueOnce([]).mockResolvedValue(menus) }),
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
  const el = await mount(api({ listMenus: vi.fn().mockResolvedValue([]) }));
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

  it("offers one Add menu while there are no menus, under the empty table's sentence", async () => {
    for (const [locale, sentence] of [
      ["en-GB", "No menus yet."],
      ["es-ES", "Todavía no hay cartas."],
    ] as const)
      await at([1280, 900], locale, async () => {
        const el = await mount(api({ listMenus: vi.fn().mockResolvedValue([]) }));
        expect(table(el).querySelector(":scope > [slot=empty-action]")).not.toBeNull();
        expect(headerAdd(el)).toBeNull();
        expect(el.shadowRoot!.querySelectorAll('[data-test="add-menu"]')).toHaveLength(1);
        await table(el).updateComplete;
        expect(table(el).shadowRoot.textContent).toContain(sentence);
        cleanupWidgets();
      });
  });

  it("keeps the heading's Add menu when a search leaves no menu showing", async () => {
    const el = await mount();
    const list = table(el);
    await list.updateComplete;
    await userEvent.fill(
      list.shadowRoot.querySelector<HTMLInputElement>('input[name="search"]')!,
      "Burger",
    );
    await vi.waitFor(() =>
      expect(list.shadowRoot.querySelectorAll('tbody [data-test^="open-menu-"]')).toHaveLength(0),
    );
    await el.updateComplete;
    expect(headerAdd(el)).not.toBeNull();
  });

  it("returns focus to the heading's Add menu after a menu is made from it, and after Cancel", async () => {
    const el = await mount(
      api({ listMenus: vi.fn().mockResolvedValueOnce(menus).mockResolvedValue(menus) }),
    );
    headerAdd(el).focus();
    await chooseOrdinaryMenu(el, headerAdd(el));
    inModal(el, "menu-form", '[data-test="cancel"]').click();
    await vi.waitFor(() => expect(modal(el, "menu-form").open).toBe(false));
    await afterDialogCloses(el);
    expect(el.shadowRoot!.activeElement).toBe(headerAdd(el));
    await chooseOrdinaryMenu(el, headerAdd(el));
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

  it("opens nothing from a click on its Status cell, which can hold the changes link, while its name still opens it", async () => {
    await at([1280, 900], "en-GB", async () => {
      const opens = countOpens();
      const el = await mount();
      const live = await liveRow(el);
      expect(live.querySelectorAll("td")).toHaveLength(3);
      const state = live.querySelector<HTMLElement>('[data-test="status-menu-dinner"]')!;
      expect(state.closest("td")!.dataset.rowActivate).toBe("false");
      await userEvent.click(state, { position: { x: 2, y: 2 } });
      await el.updateComplete;
      expect(location.pathname).toBe("/menus");
      expect(opens()).toHaveLength(0);
      await userEvent.click(live.querySelector<HTMLElement>('[data-test="open-menu-dinner"]')!);
      await vi.waitFor(() =>
        expect(location.pathname).toBe("/menus/menu/menu-dinner/view/structure"),
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
    expect(location.pathname).toBe("/menus");
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
    const activator = live.querySelector<HTMLButtonElement>(".row-activate")!;
    activator.focus();
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}{Tab}");
    expect(table(el).shadowRoot.activeElement).toBe(activator);
    expect(activator.matches(":focus-visible")).toBe(true);
    for (const cell of cells) expect(getComputedStyle(cell).backgroundColor).toBe(highlight);
    expect(cells).toHaveLength(3);
  }
});

it.each([
  [1280, 900, "en-GB", "Search menus"],
  [390, 844, "es-ES", "Buscar cartas"],
] as const)(
  "searches menu names with the list controls (%i px)",
  async (width, height, locale, label) => {
    await at([width, height], locale, async () => {
      const el = await mount();
      const list = table(el);
      await list.updateComplete;
      const search = list.shadowRoot.querySelector<HTMLInputElement>('input[name="search"]');
      expect(search).not.toBeNull();
      expect(search!.getAttribute("aria-label")).toBe(label);
      const names = () =>
        [...list.shadowRoot.querySelectorAll('tbody [data-test^="open-menu-"]')].map((row) =>
          row.textContent!.trim(),
        );
      await userEvent.fill(search!, "lunch");
      await vi.waitFor(() => expect(names()).toEqual(["Lunch Menu"]));
      await userEvent.fill(search!, "Dinner");
      await vi.waitFor(() => expect(names()).toEqual(["Dinner Menu"]));
      await userEvent.fill(search!, "Burger");
      await vi.waitFor(() => expect(names()).toEqual([]));
      await userEvent.fill(search!, "");
      await vi.waitFor(() => expect(names()).toEqual(["Dinner Menu", "Lunch Menu"]));
      // No column of the list can be hidden, so it offers no chooser.
      expect(list.shadowRoot.querySelector(".columns-trigger")).toBeNull();
    });
  },
);

describe("the menus list's columns", () => {
  it.each([
    [1280, 900],
    [390, 844],
  ] as const)(
    "offers no Customise columns, where no column can be hidden (%i px)",
    async (width, height) => {
      await at([width, height], "en-GB", async () => {
        const el = await mount();
        await vi.waitFor(async () => {
          await table(el).updateComplete;
          expect(table(el).shadowRoot.querySelectorAll("tbody tr")).toHaveLength(2);
        });
        expect(table(el).shadowRoot.querySelector(".columns-trigger")).toBeNull();
        expect(table(el).shadowRoot.querySelector(".table-toolbar")).not.toBeNull();
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
    await at([390, 844], "en-GB", async () => {
      await vi.waitFor(async () => {
        await table(el).updateComplete;
        expect(heads()).not.toContain(t("menus.status"));
      });
      await vi.waitFor(() =>
        expect(text(table(el).shadowRoot.querySelector('tr[data-row-key="menu-lunch"] td'))).toBe(
          `Lunch Menu Published · 1 hour ago Unpublished changes`,
        ),
      );
      expect(table(el).shadowRoot.querySelector(".columns-trigger")).toBeNull();
    });
    expect(JSON.parse(localStorage.getItem("waitron.menus.table:columns")!)).toEqual({
      status: false,
    });
  }
});

describe("the menus list's Status column and its changes link", () => {
  const PREVIEW = (id: string) => `/menus/menu/${id}/view/preview`;
  const BRUNCH: MenuSummary = {
    id: "menu-brunch",
    name: "Brunch Menu",
    active: true,
    kind: "menu",
    setPrice: null,
  };

  /** Lunch has changes on its live version 2, Dinner is current, Brunch was never published. */
  function mixed(overrides: ApiOverrides = {}): Api {
    return api({
      listMenus: vi.fn().mockResolvedValue([...menus, BRUNCH]),
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

  /** The cell under the Status heading. */
  function statusColumnCell(el: MenusScreen, id: string): HTMLTableCellElement {
    const index = heads(el).indexOf(t("menus.status"));
    expect(index).toBeGreaterThan(0);
    return row(el, id).querySelectorAll("td")[index]!;
  }

  function link(el: MenusScreen, id: string): HTMLAnchorElement | null {
    return row(el, id).querySelector<HTMLAnchorElement>("a");
  }

  function mark(el: MenusScreen, id: string): HTMLElement | null {
    return row(el, id).querySelector<HTMLElement>('[part="changes-mark"]');
  }

  function statusOf(el: MenusScreen, id: string): string {
    return text(table(el).shadowRoot.querySelector(`[data-test="status-${id}"]`));
  }

  async function listed(client: Api): Promise<MenusScreen> {
    const el = await mount(client);
    await vi.waitFor(async () => {
      await table(el).updateComplete;
      // The publication time's words are drawn a moment after the state's label.
      expect(statusOf(el, "menu-dinner")).toMatch(new RegExp(`^${t("menu_status.current")} · \\S`));
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

  it("says in Status when each menu was published, and links a changed menu's unpublished changes under it, with no Changes column", async () => {
    await at([1280, 900], "en-GB", async () => {
      const el = await listed(mixed());
      expect(heads(el)).toHaveLength(3);
      expect(heads(el)[1]).toBe(t("menus.status"));
      expect(heads(el)).not.toContain("Changes");
      expect(statusOf(el, "menu-lunch")).toBe("Published · 1 hour ago");
      const changes = link(el, "menu-lunch")!;
      const cell = statusColumnCell(el, "menu-lunch");
      expect(changes.closest("td")).toBe(cell);
      expect(text(cell)).toBe("Published · 1 hour ago Unpublished changes");
      expect(text(changes)).toBe("Unpublished changes");
      expect(new URL(changes.href).pathname).toBe(PREVIEW("menu-lunch"));
      expect(changes.getAttribute("aria-label")).toBe("Unpublished changes: Lunch Menu");
      const state = cell.querySelector('[data-test="status-menu-lunch"]')!;
      expect(state.contains(changes)).toBe(false);
      expect(changes.getBoundingClientRect().top, "under the state").toBeGreaterThanOrEqual(
        state.getBoundingClientRect().bottom - 1,
      );
      expect(statusOf(el, "menu-dinner")).toBe("Published · Sunday, 18:00");
      expect(statusOf(el, "menu-brunch")).toBe("Unpublished");
      for (const id of ["menu-dinner", "menu-brunch"]) {
        expect(link(el, id), id).toBeNull();
        expect(mark(el, id), id).toBeNull();
      }
    });
  });

  it("puts the publication time on the state's line after a dot, muted at the state's size, with the exact time on hand", async () => {
    await at([1280, 900], "en-GB", async () => {
      const el = await listed(mixed());
      const state = table(el).shadowRoot.querySelector<HTMLElement>(
        '[data-test="status-menu-lunch"]',
      )!;
      const time = state.querySelector<HTMLElement>('[part~="time"]')!;
      expect(getComputedStyle(time).display).toBe("inline");
      expect(text(time)).toBe("· 1 hour ago");
      expect(getComputedStyle(time).fontSize).toBe(getComputedStyle(state).fontSize);
      expect(getComputedStyle(time).color).toBe(
        computedColour(el.shadowRoot!, "var(--wt-color-text-muted)"),
      );
      expect(getComputedStyle(state).color).toBe(
        computedColour(el.shadowRoot!, "var(--wt-color-text)"),
      );
      expect(time.getBoundingClientRect().top).toBeCloseTo(firstLine(state).top, 0);
      expect(getComputedStyle(state).whiteSpace).not.toBe("nowrap");
      const relative = time.querySelector("wt-relative-time")!;
      const tip = relative.shadowRoot!.querySelector("[popover]")!;
      expect(tip.textContent!.trim()).toBe("26 September 2026 at 10:15");
    });
  });

  it.each(["en-GB", "es-ES"])(
    "keeps the dot and the time on the state's line at phone width (%s)",
    async (locale) => {
      await at([390, 844], locale, async () => {
        const el = await mount(mixed());
        await vi.waitFor(async () => {
          await table(el).updateComplete;
          expect(statusOf(el, "menu-lunch")).toMatch(/ · \S/);
        });
        const state = table(el).shadowRoot.querySelector<HTMLElement>(
          '[data-test="status-menu-lunch"]',
        )!;
        const time = state.querySelector<HTMLElement>('[part~="time"]')!;
        const line = firstLine(state);
        for (const box of time.getClientRects()) {
          expect(box.top).toBeLessThan(line.bottom);
          expect(box.bottom).toBeGreaterThan(line.top);
        }
      });
    },
  );

  it("names a publication six days or more ago by its date, and adds the year when it is not this one", async () => {
    for (const [locale, march, december] of [
      ["en-GB", "Published · 4 Mar", "Published · 1 Dec 2025"],
      ["es-ES", "Publicada · 4 mar", "Publicada · 1 dic 2025"],
    ] as const)
      await at([1280, 900], locale, async () => {
        const el = await mount(
          mixed({
            getMenuStatuses: vi.fn().mockResolvedValue({
              ...statuses(),
              "menu-dinner": {
                ...statuses()["menu-dinner"],
                publishedAt: "2026-03-04T09:00:00.000Z",
              },
              "menu-brunch": {
                ...statuses()["menu-dinner"],
                publishedAt: "2025-12-01T09:00:00.000Z",
              },
            }),
          }),
        );
        await vi.waitFor(async () => {
          await table(el).updateComplete;
          expect(statusOf(el, "menu-dinner")).toBe(march);
          expect(statusOf(el, "menu-brunch")).toBe(december);
        });
        cleanupWidgets();
      });
  });

  it("marks only a changed menu's link with a round warning dot that a screen reader skips", async () => {
    await at([1280, 900], "en-GB", async () => {
      const el = await listed(mixed());
      const dot = mark(el, "menu-lunch")!;
      expect(dot.getAttribute("aria-hidden")).toBe("true");
      expect(dot.textContent).toBe("");
      const style = getComputedStyle(dot);
      expect(style.backgroundColor).toBe(computedColour(el.shadowRoot!, "var(--wt-color-warning)"));
      const box = dot.getBoundingClientRect();
      expect(box.width).toBeGreaterThan(0);
      expect(box.width).toBe(box.height);
      expect(style.borderRadius).not.toBe("0px");
      const anchor = link(el, "menu-lunch")!.getBoundingClientRect();
      expect(box.right, "before the link").toBeLessThanOrEqual(anchor.left);
      expect(box.top + box.height / 2).toBeGreaterThan(anchor.top);
      expect(box.top + box.height / 2).toBeLessThan(anchor.bottom);
    });
  });

  it("names the link in Spanish, with no Changes column", async () => {
    await at([1280, 900], "es-ES", async () => {
      const el = await mount(mixed());
      await vi.waitFor(async () => {
        await table(el).updateComplete;
        expect(text(link(el, "menu-lunch"))).toBe("Cambios sin publicar");
      });
      expect(heads(el)).not.toContain("Cambios");
      expect(link(el, "menu-lunch")!.getAttribute("aria-label")).toBe(
        "Cambios sin publicar: Lunch Menu",
      );
      expect(statusOf(el, "menu-lunch")).toBe("Publicada · hace 1 hora");
    });
  });

  it("claims no changes while the states are read, or once their read fails", async () => {
    await at([1280, 900], "en-GB", async () => {
      const held = deferred<Record<string, MenuStatus>>();
      const loading = await mount(api({ getMenuStatuses: vi.fn().mockReturnValue(held.promise) }));
      await vi.waitFor(async () => {
        await table(loading).updateComplete;
        expect(statusOf(loading, "menu-lunch")).toBe("Checking…");
      });
      expect(link(loading, "menu-lunch")).toBeNull();
      expect(mark(loading, "menu-lunch")).toBeNull();
      expect(text(statusColumnCell(loading, "menu-lunch"))).toBe("Checking…");
      cleanupWidgets();

      const failed = await mount(
        api({ getMenuStatuses: vi.fn().mockRejectedValue(new Error("offline")) }),
      );
      await vi.waitFor(async () => {
        await table(failed).updateComplete;
        expect(statusOf(failed, "menu-lunch")).toBe("Could not be checked");
      });
      expect(link(failed, "menu-lunch")).toBeNull();
      expect(mark(failed, "menu-lunch")).toBeNull();
      expect(text(statusColumnCell(failed, "menu-lunch"))).toBe("Could not be checked");
    });
  });

  /** Lunch is changed with 2 clashing prices and Dinner is current with 1. */
  function clashing(): Api {
    return api({
      getMenuStatuses: vi.fn().mockResolvedValue({
        ...statuses(),
        "menu-lunch": { ...statuses()["menu-lunch"], clashes: 2 },
        "menu-dinner": { ...statuses()["menu-dinner"], clashes: 1 },
      }),
    });
  }

  function clashLink(el: MenusScreen, id: string): HTMLAnchorElement | null {
    return row(el, id).querySelector<HTMLAnchorElement>(`[data-test="clashes-${id}"]`);
  }

  const CLASHES = (id: string) => `/menus/menu/${id}/view/structure/filter/clashes`;

  it("puts a menu's price clashes on a line of their own under its changes link, linking to them", async () => {
    await at([1280, 900], "en-GB", async () => {
      const el = await listed(clashing());
      expect(statusOf(el, "menu-lunch")).toBe("Published · 1 hour ago");
      const lunch = clashLink(el, "menu-lunch")!;
      expect(text(lunch)).toBe("2 price clashes");
      expect(lunch.getAttribute("href")).toBe(CLASHES("menu-lunch"));
      expect(lunch.getAttribute("aria-label")).toBe("2 price clashes: Lunch Menu");
      expect(text(clashLink(el, "menu-dinner"))).toBe("1 price clash");
      expect(clashLink(el, "menu-dinner")!.getAttribute("aria-label")).toBe(
        "1 price clash: Dinner Menu",
      );
      const changes = link(el, "menu-lunch")!.getBoundingClientRect();
      const box = lunch.getBoundingClientRect();
      expect(box.top).toBeGreaterThanOrEqual(changes.bottom - 1);
      expect(box.height).toBeCloseTo(changes.height, 0);
      expect(getComputedStyle(lunch).color).toBe(
        computedColour(el.shadowRoot!, "var(--wt-color-danger)"),
      );
      expect(clashLink(el, "menu-dinner")!.closest("td")).toBe(statusColumnCell(el, "menu-dinner"));
    });
  });

  it("marks the clash line with a danger dot, so its words start where the changes link's do", async () => {
    await at([1280, 900], "en-GB", async () => {
      const el = await listed(clashing());
      const dot = row(el, "menu-lunch").querySelector<HTMLElement>('[part="clashes-mark"]')!;
      expect(dot.getAttribute("aria-hidden")).toBe("true");
      expect(getComputedStyle(dot).backgroundColor).toBe(
        computedColour(el.shadowRoot!, "var(--wt-color-danger)"),
      );
      expect(clashLink(el, "menu-lunch")!.getBoundingClientRect().left).toBeCloseTo(
        link(el, "menu-lunch")!.getBoundingClientRect().left,
        0,
      );
    });
  });

  it("words the clash link in Spanish", async () => {
    await at([1280, 900], "es-ES", async () => {
      const el = await mount(clashing());
      await vi.waitFor(async () => {
        await table(el).updateComplete;
        expect(text(clashLink(el, "menu-lunch"))).toBe("2 conflictos de precio");
      });
      expect(text(clashLink(el, "menu-dinner"))).toBe("1 conflicto de precio");
      expect(clashLink(el, "menu-lunch")!.getAttribute("aria-label")).toBe(
        "2 conflictos de precio: Lunch Menu",
      );
    });
  });

  it("opens the menu's Structure tab filtered to its clashes from the clash link", async () => {
    await at([1280, 900], "en-GB", async () => {
      const opens = opened();
      const el = await listed(clashing());
      await userEvent.click(clashLink(el, "menu-lunch")!);
      await vi.waitFor(() => expect(location.pathname).toBe(CLASHES("menu-lunch")));
      const tree = () => structure(el)?.shadowRoot?.querySelector("wt-data-table");
      await vi.waitFor(() => expect(tree()?.filterValues("price")).toEqual(["clashes"]));
      expect(opens()).toEqual([CLASHES("menu-lunch")]);
    });
  });

  it("leaves a click on the clash link with a modifier key to the browser", async () => {
    const opens = opened();
    const el = await listed(clashing());
    const seen: boolean[] = [];
    const watch = (event: Event) => {
      seen.push(event.defaultPrevented);
      event.preventDefault();
    };
    window.addEventListener("click", watch);
    onTestFinished(() => window.removeEventListener("click", watch));
    clashLink(el, "menu-lunch")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, metaKey: true }),
    );
    await el.updateComplete;
    expect(seen).toEqual([false]);
    expect(location.pathname).toBe("/menus");
    expect(opens()).toEqual([]);
  });

  it("says above the list why the states could not be read, and reads them again on Try again", async () => {
    await at([1280, 900], "en-GB", async () => {
      const client = mixed({
        getMenuStatuses: vi
          .fn()
          .mockRejectedValueOnce({ code: "server.internal" })
          .mockResolvedValue(statuses()),
      });
      const el = await mount(client);
      const message = () => q(el, '[data-test="statuses-error"]');
      await vi.waitFor(() =>
        expect(text(message())).toBe(
          `Could not check which menus are published. ${codeMessage("server.internal")}`,
        ),
      );
      expect(message()!.getAttribute("role")).toBe("alert");
      await vi.waitFor(async () => {
        await table(el).updateComplete;
        expect(statusOf(el, "menu-lunch")).toBe("Could not be checked");
      });
      const retry = q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="statuses-retry"]')!;
      expect(text(retry)).toBe("Try again");
      expect(retry.variant).toBe("secondary");
      retry.click();
      await vi.waitFor(() => expect(message()).toBeNull());
      await vi.waitFor(async () => {
        await table(el).updateComplete;
        expect(statusOf(el, "menu-lunch")).toBe("Published · 1 hour ago");
      });
      expect(client.getMenuStatuses).toHaveBeenCalledTimes(2);
    });
  });

  it("says only that the states could not be read when the failure names no reason, in Spanish too", async () => {
    await at([1280, 900], "es-ES", async () => {
      const el = await mount(
        mixed({ getMenuStatuses: vi.fn().mockRejectedValue(new Error("offline")) }),
      );
      await vi.waitFor(() =>
        expect(text(q(el, '[data-test="statuses-error"]'))).toBe(
          "No se pudo comprobar qué cartas están publicadas.",
        ),
      );
      expect(text(q(el, '[data-test="statuses-retry"]'))).toBe("Reintentar");
    });
  });

  it("offers one Try again when neither the list nor the states could be read, and that one reads both", async () => {
    await at([1280, 900], "en-GB", async () => {
      const client = mixed({
        listMenus: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(menus),
        getMenuStatuses: vi
          .fn()
          .mockRejectedValueOnce({ code: "server.internal" })
          .mockResolvedValue(statuses()),
      });
      const el = await mount(client);
      await vi.waitFor(() => {
        expect(q(el, '[data-test="load-error"]')).not.toBeNull();
        expect(client.getMenuStatuses).toHaveBeenCalledOnce();
      });
      await (client.getMenuStatuses.mock.results[0]!.value as Promise<unknown>).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve));
      await el.updateComplete;
      const retries = () =>
        [...el.shadowRoot!.querySelectorAll("wt-button")].filter(
          (button) => text(button) === "Try again",
        );
      expect(retries()).toHaveLength(1);
      expect(q(el, '[data-test="statuses-error"]')).toBeNull();
      retries()[0]!.click();
      await vi.waitFor(async () => {
        await table(el).updateComplete;
        expect(statusOf(el, "menu-lunch")).toBe("Published · 1 hour ago");
      });
      expect(q(el, '[data-test="load-error"]')).toBeNull();
      expect(q(el, '[data-test="statuses-error"]')).toBeNull();
      expect(client.getMenuStatuses).toHaveBeenCalledTimes(2);
    });
  });

  it("says every menu could not be checked, with no links, when a live refresh of the states fails, and brings them back on Try again", async () => {
    await at([1280, 900], "en-GB", async () => {
      const live = new LiveData();
      const read = {
        ...statuses(),
        "menu-lunch": { ...statuses()["menu-lunch"], clashes: 2 },
        "menu-brunch": { state: "unpublished", clashes: 0 },
      };
      const client = mixed({
        liveData: live,
        getMenuStatuses: vi
          .fn()
          .mockResolvedValueOnce(read)
          .mockRejectedValueOnce({ code: "server.internal" })
          .mockResolvedValue(read),
      });
      const el = await listed(client);
      expect(text(link(el, "menu-lunch"))).toBe("Unpublished changes");
      expect(text(clashLink(el, "menu-lunch"))).toBe("2 price clashes");
      live.invalidate([{ type: "menu_versions" }]);
      await vi.waitFor(() => expect(q(el, '[data-test="statuses-error"]')).not.toBeNull());
      await table(el).updateComplete;
      for (const id of ["menu-lunch", "menu-dinner", "menu-brunch"]) {
        expect(statusOf(el, id), id).toBe("Could not be checked");
        expect(row(el, id).querySelector("a"), id).toBeNull();
      }
      q<HTMLElement>(el, '[data-test="statuses-retry"]')!.click();
      await vi.waitFor(() => expect(q(el, '[data-test="statuses-error"]')).toBeNull());
      await vi.waitFor(async () => {
        await table(el).updateComplete;
        expect(statusOf(el, "menu-lunch")).toBe("Published · 1 hour ago");
      });
      expect(text(link(el, "menu-lunch"))).toBe("Unpublished changes");
      expect(text(clashLink(el, "menu-lunch"))).toBe("2 price clashes");
      expect(client.getMenuStatuses).toHaveBeenCalledTimes(3);
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
      expect(client.priceRows).not.toHaveBeenCalled();
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
    expect(location.pathname).toBe("/menus");
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
    "starts %s's name, state and row menu at the row's top, on one line",
    async (id) => {
      await at([1280, 900], "en-GB", async () => {
        const el = await listed(mixed());
        expect(table(el).hasAttribute("top-aligned")).toBe(true);
        const cells = [...row(el, id).querySelectorAll("td")];
        expect(cells).toHaveLength(3);
        for (const cell of cells) expect(getComputedStyle(cell).verticalAlign).toBe("top");
        const name = firstLine(row(el, id).querySelector('[part="name-text"]')!);
        const status = firstLine(table(el).shadowRoot.querySelector(`[data-test="status-${id}"]`)!);
        expect(Math.abs(status.bottom - name.bottom), "state against name").toBeLessThanOrEqual(2);
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

  it.each([
    [1280, 900],
    [390, 844],
  ] as const)(
    "starts each menu's name, and on a phone its state, under the Name heading's text (%i px)",
    async (width, height) => {
      await at([width, height], "en-GB", async () => {
        const el = await listed(mixed());
        const heading = firstLine(table(el).shadowRoot.querySelector("thead th")!);
        // The Name heading also carries its sort arrow.
        expect(text(table(el).shadowRoot.querySelector("thead th"))).toMatch(/^Name\b/);
        for (const id of ["menu-lunch", "menu-dinner", "menu-brunch"]) {
          const button = row(el, id).querySelector<HTMLElement>('[part~="name"]')!;
          const name = firstLine(row(el, id).querySelector('[part="name-text"]')!);
          expect(Math.abs(name.left - heading.left), id).toBeLessThanOrEqual(1);
          expect(
            button.getBoundingClientRect().height,
            `${id}'s tap height`,
          ).toBeGreaterThanOrEqual(44);
          const edge = table(el).shadowRoot.querySelector(".scroll")!.getBoundingClientRect().left;
          expect(
            button.getBoundingClientRect().left,
            `${id}'s button box inside the table`,
          ).toBeGreaterThanOrEqual(edge + 1);
          const inner = button.shadowRoot!.querySelector("button")!;
          await userEvent.keyboard("{Shift}");
          inner.focus();
          expect(inner.matches(":focus-visible"), `${id} focused as from the keyboard`).toBe(true);
          const ring = getComputedStyle(inner);
          expect(ring.outlineStyle).not.toBe("none");
          expect(
            inner.getBoundingClientRect().left -
              parseFloat(ring.outlineOffset) -
              parseFloat(ring.outlineWidth),
            `${id}'s focus ring inside the table`,
          ).toBeGreaterThanOrEqual(edge + 1);
          inner.blur();
          if (width === 390) {
            const state = firstLine(
              table(el).shadowRoot.querySelector(`[data-test="status-${id}"]`)!,
            );
            expect(Math.abs(state.left - heading.left), `${id}'s state`).toBeLessThanOrEqual(1);
          }
        }
      });
    },
  );

  it("stacks the state and the changes link under the name at phone width, with no column chooser", async () => {
    await at([390, 844], "en-GB", async () => {
      const opens = opened();
      const el = await listed(mixed());
      await vi.waitFor(() => expect(heads(el)).not.toContain(t("menus.status")));
      const first = row(el, "menu-lunch").querySelector("td")!;
      expect(text(first)).toBe("Lunch Menu Published · 1 hour ago Unpublished changes");
      expect(link(el, "menu-lunch")!.closest("td")).toBe(first);
      expect(mark(el, "menu-lunch")!.closest("td")).toBe(first);
      expect(text(row(el, "menu-dinner").querySelector("td"))).toBe(
        "Dinner Menu Published · Sunday, 18:00",
      );
      expect(link(el, "menu-dinner")).toBeNull();
      expect(mark(el, "menu-dinner")).toBeNull();
      expect(table(el).shadowRoot.querySelector(".columns-trigger")).toBeNull();
      const scroll = table(el).shadowRoot.querySelector<HTMLElement>(".scroll")!;
      expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
      await userEvent.click(link(el, "menu-lunch")!);
      await vi.waitFor(() => expect(location.pathname).toBe(PREVIEW("menu-lunch")));
      expect(opens()).toEqual([PREVIEW("menu-lunch")]);
    });
  });

  it("offers no column chooser on a desktop list, where no column can be hidden", async () => {
    await at([1280, 900], "en-GB", async () => {
      const el = await listed(mixed());
      expect(table(el).shadowRoot.querySelector(".columns-trigger")).toBeNull();
    });
  });

  it("keeps Status shown when it is saved hidden under the list's own key, and stacks it on a phone", async () => {
    localStorage.setItem(`${LIST_KEY}:columns`, JSON.stringify({ status: false }));
    await at([1280, 900], "en-GB", async () => {
      const el = await mount(mixed());
      await vi.waitFor(async () => {
        await table(el).updateComplete;
        expect(text(link(el, "menu-lunch"))).toBe("Unpublished changes");
      });
      expect(heads(el)[1]).toBe(t("menus.status"));
      expect(link(el, "menu-lunch")!.closest("td")).toBe(statusColumnCell(el, "menu-lunch"));
      await at([390, 844], "en-GB", async () => {
        await vi.waitFor(() => expect(heads(el)).not.toContain(t("menus.status")));
        expect(text(row(el, "menu-lunch").querySelector("td"))).toBe(
          "Lunch Menu Published · 1 hour ago Unpublished changes",
        );
      });
    });
  });

  it("keeps Status and its links shown when a saved choice hides Status", async () => {
    localStorage.setItem(`${LIST_KEY}:columns`, JSON.stringify({ status: false, changes: true }));
    localStorage.setItem(`${LIST_KEY}:column-order`, JSON.stringify(["changes", "status"]));
    const set: MenuSummary = {
      id: "set-daily",
      name: "Daily menu",
      active: true,
      kind: "set_menu",
      setPrice: "14.00",
    };
    await at([1280, 900], "en-GB", async () => {
      const el = await listed(
        mixed({
          listMenus: vi.fn().mockResolvedValue([...menus, BRUNCH, set]),
          getMenuStatuses: vi.fn().mockResolvedValue({
            ...statuses(),
            "menu-lunch": { ...statuses()["menu-lunch"], clashes: 2 },
            "menu-brunch": { state: "unpublished", clashes: 0 },
          }),
        }),
      );
      expect(heads(el).slice(1)).toEqual([t("menus.status"), t("menus.actions")]);
      const cell = statusColumnCell(el, "menu-lunch");
      expect(text(cell.querySelector('[data-test="changes-menu-lunch"]'))).toBe(
        "Unpublished changes",
      );
      expect(text(cell.querySelector('[data-test="clashes-menu-lunch"]'))).toBe("2 price clashes");
      expect(table(el).shadowRoot.querySelector(".columns-trigger")).toBeNull();
    });
  });

  const HYPHENATED = "Weekday-lunch-menu-with-starters-main-and-cakes";
  const SPACED = "Weekday lunch from Monday to Friday, with cakes and drinks included";
  const UNBROKEN = "Weekdaylunchmenuwithstartersmainscakesanddrinksincluded";

  /** The mixed list, with Lunch, the menu that has changes, under a long name. */
  function named(name: string): Api {
    return mixed({
      listMenus: vi.fn().mockResolvedValue([{ ...menus[0]!, name }, menus[1]!, BRUNCH]),
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
      expect(heads(el)[1]).toBe(t("menus.status"));
      expect(link(el, "menu-lunch")?.closest("td")).toBe(
        row(el, "menu-lunch").querySelectorAll("td")[1],
      );
    });
  }

  describe.each([
    [600, "en-GB"],
    [600, "es-ES"],
    [700, "en-GB"],
    [700, "es-ES"],
    [790, "en-GB"],
    [790, "es-ES"],
    [816, "en-GB"],
    [816, "es-ES"],
    [1280, "en-GB"],
    [1280, "es-ES"],
  ] as const)("wider than a phone (%i px, %s)", (width, locale) => {
    it.each([HYPHENATED, SPACED, UNBROKEN])(
      "puts the link under the state in Status, on screen without scrolling, beside %s",
      async (name) => {
        await at([width, 900], locale, async () => {
          const el = await listed(named(name));
          await threeColumns(el);
          expect(table(el).shadowRoot.querySelector(".columns-trigger")).toBeNull();
          const scroll = scrollBox(el);
          expect(scroll.scrollWidth, "no sideways scrolling").toBeLessThanOrEqual(
            scroll.clientWidth,
          );
          const cell = row(el, "menu-lunch").querySelectorAll("td")[1]!;
          const anchor = link(el, "menu-lunch")!;
          expect(anchor.closest("td")).toBe(cell);
          expect(text(anchor)).toBe(t("menus.changes_link"));
          const state = cell.querySelector('[data-test="status-menu-lunch"]')!;
          expect(state.contains(anchor)).toBe(false);
          const under = state.getBoundingClientRect();
          const at = anchor.getBoundingClientRect();
          expect(at.top, "under the state").toBeGreaterThanOrEqual(under.bottom - 1);
          expect(
            mark(el, "menu-lunch")!.getBoundingClientRect().left,
            "lined up with the state",
          ).toBeGreaterThanOrEqual(under.left - 1);
          expect(mark(el, "menu-lunch")!.getBoundingClientRect().left).toBeLessThanOrEqual(
            under.left + 1,
          );
          expectLinkOnScreen(el, "menu-lunch");
          for (const id of ["menu-dinner", "menu-brunch"]) expect(link(el, id), id).toBeNull();
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

  it.each([
    ["wide Status", [1280, 900], 1],
    ["Status", [700, 900], 1],
    ["phone-width Name", [390, 844], 0],
  ] as const)(
    "opens nothing from a click on the %s cell's blank space beside its link",
    async (_, size, column) => {
      await at([...size], "en-GB", async () => {
        const opens = opened();
        const el = await listed(mixed());
        if (column === 1) await threeColumns(el);
        else await vi.waitFor(() => expect(heads(el)).not.toContain(t("menus.status")));
        const cell = row(el, "menu-lunch").querySelectorAll("td")[column]!;
        const box = cell.getBoundingClientRect();
        const anchor = link(el, "menu-lunch")!;
        expect(anchor.closest("td")).toBe(cell);
        const at = anchor.getBoundingClientRect();
        expect(at.right).toBeLessThan(box.right - 4);
        // The cell's padding corner, and the padding past the link's end on its line.
        const points = [
          { x: 2, y: 2 },
          { x: (at.right + box.right) / 2 - box.x, y: at.top + at.height / 2 - box.y },
        ];
        for (const position of points) {
          const label = JSON.stringify(position);
          const hit = table(el).shadowRoot.elementFromPoint(box.x + position.x, box.y + position.y);
          expect(cell.contains(hit), label).toBe(true);
          expect(anchor.contains(hit), label).toBe(false);
          expect(hit?.closest("wt-button"), label).toBeNull();
          // Forced, so a row activator lying over the point takes the click rather than stalling it.
          await userEvent.click(cell, { position, force: true });
          await el.updateComplete;
          expect(location.pathname, label).toBe("/menus");
        }
        expect(opens()).toEqual([]);
      });
    },
  );

  it("keeps the focus on a row's open button when the list narrows to the phone layout", async () => {
    await at([700, 900], "en-GB", async () => {
      const opens = opened();
      const el = await listed(mixed());
      await threeColumns(el);
      const before = row(el, "menu-lunch").querySelector<HTMLButtonElement>(".row-activate")!;
      expect(before.getAttribute("aria-label")).toContain("Lunch Menu");
      expect(before.closest("td")).toBe(row(el, "menu-lunch").querySelectorAll("td")[0]);
      before.focus();
      await page.viewport(390, 844);
      await vi.waitFor(() => expect(heads(el)).not.toContain(t("menus.status")));
      await table(el).updateComplete;
      const after = row(el, "menu-lunch").querySelector<HTMLButtonElement>(".row-activate")!;
      expect(after).not.toBe(before);
      expect(table(el).shadowRoot.activeElement).toBe(after);
      await userEvent.keyboard("{Enter}");
      const structure = "/menus/menu/menu-lunch/view/structure";
      await vi.waitFor(() => expect(location.pathname).toBe(structure));
      expect(opens()).toEqual([structure]);
    });
  });

  it("opens the menu once from a real click on the phone-width Actions cell's blank space", async () => {
    await at([390, 844], "en-GB", async () => {
      const opens = opened();
      const el = await listed(mixed());
      await vi.waitFor(() => expect(heads(el)).not.toContain(t("menus.status")));
      const cell = row(el, "menu-lunch").querySelector<HTMLElement>("td[data-pinned]")!;
      const activator = cell.querySelector<HTMLButtonElement>(".row-activate")!;
      expect(activator.getAttribute("aria-label")).toContain("Lunch Menu");
      const box = cell.getBoundingClientRect();
      const menu = cell
        .querySelector("wt-row-actions")!
        .shadowRoot!.querySelector("button")!
        .getBoundingClientRect();
      // Below the row menu's button, in the cell's bottom padding.
      const position = { x: box.width / 2, y: box.height - 3 };
      expect(box.y + position.y).toBeGreaterThan(menu.bottom + 4);
      expect(table(el).shadowRoot.elementFromPoint(box.x + position.x, box.y + position.y)).toBe(
        activator,
      );
      await userEvent.click(cell, { position });
      const structure = "/menus/menu/menu-lunch/view/structure";
      await vi.waitFor(() => expect(location.pathname).toBe(structure));
      expect(opens()).toEqual([structure]);
    });
  });

  it.each([
    ["Status hidden", { columns: { status: false } }],
    ["the old Changes column hidden", { columns: { changes: false } }],
    ["the old Changes column moved before Status", { "column-order": ["changes", "status"] }],
  ] as const)(
    "draws Name and Status, with the link under the state, at every width with %s saved",
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
          expect(text(row(el, "menu-lunch"))).toContain("Unpublished changes");
        });
        await threeColumns(el);
        const wide = heads(el);
        expect(wide[0]).toMatch(/^Name\b/);
        expectLinkOnScreen(el, "menu-lunch");
        await at([700, 900], "en-GB", async () => {
          await threeColumns(el);
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
  const customerName = inModal(el, "menu-form", 'wt-input[name="names-es"]');
  type(customerName, "Brunch");
  await el.updateComplete;
  inModal(el, "menu-form", '[data-test="menu-save"]').click();
  await el.updateComplete;
  expect(name.error).toBe(t("menus.name_required"));
  expect(await bottom(el, "menu-form")).toBe(t("form.fix_fields"));
  expect(client.createMenu).not.toHaveBeenCalled();

  type(name, "  Brunch  ");
  type(customerName, "");
  await el.updateComplete;
  expect(name.error).toBe("");
  inModal(el, "menu-form", '[data-test="menu-save"]').click();
  await vi.waitFor(() => expect(modal(el, "menu-form").open).toBe(false));
  expect(client.createMenu).toHaveBeenCalledExactlyOnceWith("Brunch", {
    names: {},
    image: null,
    color: null,
  });
  expect(client.listMenus).toHaveBeenCalledTimes(2);
  // Only the menus can have changed.
  for (const read of [
    client.listLibraryProducts,
    client.listCategories,
    client.getContentLanguages,
  ])
    expect(read).toHaveBeenCalledOnce();
});

describe("unique menu names on Create and Rename", () => {
  it.each(
    [390, 1280].flatMap((width) =>
      ["en", "es"].flatMap((locale) =>
        ["light", "dark"].flatMap((theme) =>
          ["create", "rename"].map((mode) => ({
            width,
            locale,
            theme: theme as "light" | "dark",
            mode,
          })),
        ),
      ),
    ),
  )(
    "shows the name refusal on $mode at $width $locale $theme",
    async ({ width, locale, theme, mode }) => {
      const previous = currentLocale();
      const viewport = [window.innerWidth, window.innerHeight] as const;
      try {
        setLocale(locale);
        await page.viewport(width, 844);
        const client = api();
        const el = await mount(client, "/menus", theme);
        if (mode === "create") await click(el, "add-menu");
        else await inTable(el, "rename-menu-lunch");
        const name = inModal<HTMLElementTagNameMap["wt-input"]>(
          el,
          "menu-form",
          'wt-input[name="name"]',
        );
        type(name, "  DINNER MENU  ");
        await el.updateComplete;
        inModal(el, "menu-form", '[data-test="menu-save"]').click();
        await vi.waitFor(() => expect(name.error).toBe(t("menus.name_taken")));
        expect(await bottom(el, "menu-form")).toBe(t("form.fix_fields"));
        await name.updateComplete;
        const native = name.shadowRoot!.querySelector("input")!;
        expect(native.getAttribute("aria-invalid")).toBe("true");
        const dialog = modal(el, "menu-form").shadowRoot!.querySelector("dialog")!;
        const box = dialog.getBoundingClientRect();
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
        await expectNoA11yViolations(el.parentElement!);
        await page.screenshot({
          path: `__screenshots__/a1172-unique/${mode}-${locale}-${theme}-${width}.png`,
        });
        expect(client.createMenu).not.toHaveBeenCalled();
        expect(client.updateMenuDetails).not.toHaveBeenCalled();
      } finally {
        setLocale(previous);
        await page.viewport(...viewport);
      }
    },
  );

  it.each(["create", "rename"] as const)(
    "refuses a held name locally on %s, then accepts a correction",
    async (mode) => {
      const client = api();
      const el = await mount(client);
      if (mode === "create") await click(el, "add-menu");
      else await inTable(el, "rename-menu-lunch");
      const name = inModal<HTMLElementTagNameMap["wt-input"]>(
        el,
        "menu-form",
        'wt-input[name="name"]',
      );
      type(name, "  DINNER MENU  ");
      await el.updateComplete;
      expect(name.error).toBe("");
      inModal(el, "menu-form", '[data-test="menu-save"]').click();
      await vi.waitFor(() => expect(name.error).toBe(t("menus.name_taken")));
      expect(await bottom(el, "menu-form")).toBe(t("form.fix_fields"));
      expect(
        inModal<HTMLElementTagNameMap["wt-button"]>(el, "menu-form", '[data-test="menu-save"]')
          .disabled,
      ).toBe(true);
      expect(client.createMenu).not.toHaveBeenCalled();
      expect(client.updateMenuDetails).not.toHaveBeenCalled();
      type(name, "Brunch");
      await el.updateComplete;
      await vi.waitFor(() => expect(name.error).toBe(""));
      inModal(el, "menu-form", '[data-test="menu-save"]').click();
      await vi.waitFor(() => expect(modal(el, "menu-form").open).toBe(false));
      if (mode === "create")
        expect(client.createMenu).toHaveBeenCalledExactlyOnceWith("Brunch", {
          names: {},
          image: null,
          color: null,
        });
      else
        expect(client.updateMenuDetails).toHaveBeenCalledExactlyOnceWith("menu-lunch", {
          internalName: "Brunch",
          names: {},
          image: null,
          color: null,
        });
    },
  );

  it.each(["create", "rename"] as const)(
    "puts a late server conflict under the name on %s and permits retry",
    async (mode) => {
      const client = api();
      const save = mode === "create" ? client.createMenu : client.updateMenuDetails;
      save.mockRejectedValueOnce({ code: "menu.name_taken", params: { field: "name" } });
      const el = await mount(client);
      if (mode === "create") await click(el, "add-menu");
      else await inTable(el, "rename-menu-lunch");
      const name = inModal<HTMLElementTagNameMap["wt-input"]>(
        el,
        "menu-form",
        'wt-input[name="name"]',
      );
      type(name, "Brunch");
      await el.updateComplete;
      inModal(el, "menu-form", '[data-test="menu-save"]').click();
      await vi.waitFor(() => expect(name.error).toBe(t("menus.name_taken")));
      expect(await bottom(el, "menu-form")).toBe(t("form.fix_fields"));
      expect(modal(el, "menu-form").open).toBe(true);
      expect(name.value).toBe("Brunch");
      expect(
        inModal<HTMLElementTagNameMap["wt-button"]>(el, "menu-form", '[data-test="menu-save"]')
          .disabled,
      ).toBe(false);
      inModal(el, "menu-form", '[data-test="menu-save"]').click();
      await vi.waitFor(() => expect(modal(el, "menu-form").open).toBe(false));
      expect(save).toHaveBeenCalledTimes(2);
    },
  );

  it("allows presentation edits when the menu name already has a duplicate", async () => {
    const client = api({
      listMenus: vi.fn().mockResolvedValue(menus.map((menu) => ({ ...menu, name: "Lunch Menu" }))),
    });
    const el = await mount(client);
    await inTable(el, "rename-menu-lunch");
    type(inModal(el, "menu-form", 'wt-input[name="names-en"]'), "Midday");
    await el.updateComplete;
    inModal(el, "menu-form", '[data-test="menu-save"]').click();
    await vi.waitFor(() => expect(modal(el, "menu-form").open).toBe(false));
    expect(client.updateMenuDetails).toHaveBeenCalledExactlyOnceWith("menu-lunch", {
      internalName: "Lunch Menu",
      names: { en: "Midday" },
      image: null,
      color: null,
    });
  });
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
    expect(client.createMenu).toHaveBeenCalledExactlyOnceWith("Brunch", {
      names: {},
      image: null,
      color: null,
    }),
  );
});

it("keeps the form and the name when the server refuses a new menu, and says why", async () => {
  const client = api({
    createMenu: vi.fn().mockRejectedValue({ code: "management.request_invalid" }),
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
    listMenus: vi.fn().mockResolvedValueOnce(menus).mockRejectedValue(new Error("down")),
  });
  const el = await mount(client);
  await click(el, "add-menu");
  type(inModal(el, "menu-form", 'wt-input[name="name"]'), "Brunch");
  await el.updateComplete;
  inModal(el, "menu-form", '[data-test="menu-save"]').click();
  await vi.waitFor(() => expect(q(el, '[data-test="load-error"]')).not.toBeNull());
  expect(modal(el, "menu-form").open).toBe(false);
  expect(client.createMenu).toHaveBeenCalledOnce();
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
  expect(client.createMenu).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(client.listMenus).toHaveBeenCalledTimes(2));
  expect(client.getMenuStructure).toHaveBeenCalled();
});

describe("copying a menu from the list", () => {
  const copy: MenuSummary = {
    id: "menu-copy",
    name: "Weekday lunch",
    active: true,
    kind: "menu",
    setPrice: null,
  };
  const form = (el: MenusScreen) =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["dashboard-menu-copy-dialog"]>(
      "dashboard-menu-copy-dialog",
    )!;
  const field = (el: MenusScreen) =>
    form(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input")!;
  const action = (el: MenusScreen) =>
    form(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=copy]")!;
  async function name(el: MenusScreen, value: string) {
    await field(el).updateComplete;
    await userEvent.fill(page.elementLocator(field(el).shadowRoot!.querySelector("input")!), value);
    await form(el).updateComplete;
  }
  async function open(el: MenusScreen) {
    await inTable(el, "duplicate-menu-lunch");
    await form(el).updateComplete;
  }
  it("opens Copy with an empty required name and stores nothing before confirmation", async () => {
    const client = api();
    const el = await mount(client);
    await inTable(el, "duplicate-menu-lunch");
    expect(client.duplicateMenu).not.toHaveBeenCalled();
    expect(form(el).open).toBe(true);
    await form(el).updateComplete;
    expect(field(el).value).toBe("");
    expect(field(el).required).toBe(true);
    expect(action(el).disabled).toBe(true);
    expect(table(el).shadowRoot.textContent).toContain(t("menus.copy"));
    const menu = table(el).shadowRoot.querySelector(
      'tr[data-row-key="menu-lunch"] wt-row-actions',
    )!;
    const items = [...menu.querySelectorAll("wt-button")];
    expect(items.map((item) => item.dataset.test)).toEqual([
      "edit-menu-lunch",
      "rename-menu-lunch",
      "duplicate-menu-lunch",
      "patch-menu-lunch",
      "delete-menu-lunch",
    ]);
    expect(items.map((item) => text(item))).toEqual(
      currentLocale().split("-")[0] === "en"
        ? ["Open", "Rename…", "Copy…", "Patch live menu…", "Delete…"]
        : ["Abrir", "Cambiar nombre…", "Copiar…", "Corregir la carta publicada…", "Eliminar…"],
    );
    expect(text(items[2]!)).toBe(t("menus.copy"));
    expect(items[2]!.variant).toBe("secondary");
  });
  it("copies under the trimmed chosen name, stays on the list and lists the copy", async () => {
    const client = api({
      listMenus: vi
        .fn()
        .mockResolvedValueOnce(menus)
        .mockResolvedValue([...menus, copy]),
    });
    const el = await mount(client);
    await open(el);
    await name(el, " Weekday lunch ");
    action(el).click();
    await vi.waitFor(() =>
      expect(table(el).shadowRoot.querySelector('tr[data-row-key="menu-copy"]')).not.toBeNull(),
    );
    expect(client.duplicateMenu).toHaveBeenCalledExactlyOnceWith("menu-lunch", "Weekday lunch");
    expect(form(el).open).toBe(false);
    expect(location.pathname).toBe("/menus");
    expect(q(el, '[data-test="member-error"]')).toBeNull();
    expect(writeCalls(client)).toEqual(["duplicateMenu"]);
  });
  it("refuses taken and blank names inline, then enables Copy when corrected", async () => {
    const client = api();
    const el = await mount(client);
    await open(el);
    await name(el, "  dINNER mENU  ");
    action(el).click();
    await form(el).updateComplete;
    expect(field(el).error).toBe(t("menus.name_taken"));
    expect(action(el).disabled).toBe(true);
    expect(form(el).shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
    expect(client.duplicateMenu).not.toHaveBeenCalled();
    await name(el, "");
    expect(field(el).error).toBe(t("menus.name_required"));
    await name(el, "Weekday lunch");
    expect(field(el).error).toBe("");
    expect(action(el).disabled).toBe(false);
  });
  it("Cancel on an untouched copy creates nothing", async () => {
    const client = api();
    const el = await mount(client);
    await open(el);
    form(el).shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!.click();
    await expect.poll(() => form(el).open).toBe(false);
    expect(writeCalls(client)).toEqual([]);
  });
  it("keeps Copy busy and prevents a repeated request until the answer", async () => {
    let finish!: (value: MenuSummary) => void;
    const client = api({
      duplicateMenu: vi.fn(
        () =>
          new Promise<MenuSummary>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const el = await mount(client);
    await open(el);
    await name(el, "Weekday lunch");
    action(el).click();
    action(el).click();
    await form(el).updateComplete;
    expect(action(el).disabled).toBe(true);
    expect(action(el).loading).toBe(true);
    expect(field(el).disabled).toBe(true);
    expect(client.duplicateMenu).toHaveBeenCalledOnce();
    expect(
      table(el).shadowRoot.querySelector<HTMLElementTagNameMap["wt-button"]>(
        '[data-test="duplicate-menu-lunch"]',
      )!.disabled,
    ).toBe(true);
    expect(
      table(el).shadowRoot.querySelector<HTMLElementTagNameMap["wt-button"]>(
        '[data-test="duplicate-menu-dinner"]',
      )!.disabled,
    ).toBe(false);
    finish(copy);
    await expect.poll(() => form(el).open).toBe(false);
    await expect
      .poll(
        () =>
          table(el).shadowRoot.querySelector<HTMLElementTagNameMap["wt-button"]>(
            '[data-test="duplicate-menu-lunch"]',
          )!.disabled,
      )
      .toBe(false);
  });
  it("closes the row menu on a real Copy click without sending a write", async () => {
    const client = api();
    const el = await mount(client);
    await table(el).updateComplete;
    const menu = table(el).shadowRoot.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
      'tr[data-row-key="menu-lunch"] wt-row-actions',
    )!;
    await userEvent.click(menu.shadowRoot!.querySelector("button")!);
    expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
    await userEvent.click(menu.querySelector('[data-test="duplicate-menu-lunch"]')!);
    expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
    expect(client.duplicateMenu).not.toHaveBeenCalled();
  });
  it("places a server name conflict inline, permits retry, and clears it on an edit", async () => {
    const client = api({
      duplicateMenu: vi
        .fn()
        .mockRejectedValue({ code: "menu.name_taken", params: { field: "name" } }),
    });
    const el = await mount(client);
    await open(el);
    await name(el, "Weekday lunch");
    action(el).click();
    await expect.poll(() => field(el).error).toBe(t("menus.name_taken"));
    expect(form(el).open).toBe(true);
    expect(field(el).value).toBe("Weekday lunch");
    expect(action(el).disabled).toBe(false);
    await name(el, "Weekend lunch");
    expect(field(el).error).toBe("");
  });
  it("retains the name and reports a non-field refusal at the bottom, then retries", async () => {
    const client = api({
      duplicateMenu: vi
        .fn()
        .mockRejectedValueOnce({ code: "menu.not_found" })
        .mockResolvedValue(copy),
    });
    const el = await mount(client);
    await open(el);
    await name(el, "Weekday lunch");
    action(el).click();
    await expect
      .poll(() => form(el).shadowRoot!.querySelector("wt-form-actions")!.error)
      .toBe(codeMessage("menu.not_found"));
    expect(field(el).error).toBe("");
    expect(action(el).disabled).toBe(false);
    expect(
      [...table(el).shadowRoot.querySelectorAll("tr[data-row-key]")].map((row) =>
        row.getAttribute("data-row-key"),
      ),
    ).toEqual(["menu-dinner", "menu-lunch"]);
    expect(client.listMenus).toHaveBeenCalledOnce();
    action(el).click();
    await expect.poll(() => form(el).open).toBe(false);
    expect(client.duplicateMenu).toHaveBeenCalledTimes(2);
  });
  it("Spanish Copy uses the chosen name without adding a suffix", async () => {
    const client = api();
    const el = await mount(client);
    await at([390, 844], "es", async () => {
      await open(el);
      await name(el, "Weekend lunch");
      expect(action(el).textContent!.trim()).toBe(t("menus.copy_action"));
      action(el).click();
      await expect.poll(() => form(el).open).toBe(false);
      expect(client.duplicateMenu).toHaveBeenCalledExactlyOnceWith("menu-lunch", "Weekend lunch");
    });
  });
  it("reports a failed reload after a copy as a load failure and closes the dialog", async () => {
    const client = api({
      listMenus: vi.fn().mockResolvedValueOnce(menus).mockRejectedValue(new Error("down")),
    });
    const el = await mount(client);
    await open(el);
    await name(el, "Weekday lunch");
    action(el).click();
    await vi.waitFor(() => expect(q(el, '[data-test="load-error"]')).not.toBeNull());
    expect(form(el).open).toBe(false);
    expect(q(el, '[data-test="member-error"]')).toBeNull();
    expect(client.duplicateMenu).toHaveBeenCalledOnce();
  });
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
    listMenus: vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(menus),
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
  await vi.waitFor(() => expect(rowOf(el, "m-burger")).not.toBeNull());
  const names = () => allInStructure(el, '[data-test="name"]').map((name) => text(name));
  expect(names()).toEqual(["Burger", "Drinks", "Favourites"]);
  await toggleRow(el, "m-drinks");
  expect(names()).toEqual(["Burger", "Drinks", "Lager", "Beer", "Lemonade", "Favourites"]);
  // Staff names only.
  const shown = text(inStructure(el, "tbody"));
  for (const wrong of ["Bebidas", "Something to drink", "for guests", "KITCHEN"])
    expect(shown).not.toContain(wrong);
});

it("edits the menu's own top level first, with no sharing to report and nothing to duplicate", async () => {
  const el = await mountLunch();
  expect(currentPlace(el)).toBe("Lunch Menu");
  expect(childKeys(el, "")).toEqual(["m-burger", "m-drinks", "m-fav"]);
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

it("keeps the current list's Add actions in its own row's ⋮ and the top level's in the root row's ⋮, not beside the Structure tab", async () => {
  const el = await mountLunch(api());
  await editDrinks(el);
  const tabs = q(el, 'wt-tabs[data-test="menu-tabs"]')!;
  for (const action of ["new-section", "include-menu", "open-add-products"]) {
    expect(
      inStructure(el, `[data-test="actions-m-drinks"] [data-test="${action}-m-drinks"]`),
      `${action}-m-drinks`,
    ).not.toBeNull();
    expect(
      rootAdds(el)!.querySelector(`[data-test="${action}-top"]`),
      `${action}-top`,
    ).not.toBeNull();
  }
  expect(tabs.querySelector('[slot="actions"]')).toBeNull();
});

it("creates a section at the menu's top level from the root row's ⋮, and gives focus back to it", async () => {
  const client = api();
  const el = await mountLunch(client);
  await rowAction(el, "", "new-section");
  expect(modal(el, "new-section").heading).toBe(
    t("menus.new_section_heading").replace("{list}", "Lunch Menu"),
  );
  expect(modal(el, "new-section").heading).toBe("Añadir sección a Lunch Menu");
  type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Ciders");
  await el.updateComplete;
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(() => expect(modal(el, "new-section").open).toBe(false));
  expect(client.createSectionIn).not.toHaveBeenCalled();
  expect(structure(el).nodes.at(-1)?.internalName).toBe("Ciders");
  await afterDialogCloses(el);
  await settleStructure(el);
  expect(structureRows(el).shadowRoot.activeElement).toBe(rootAdds(el));
});

/** A section of the menu's own, at whichever level it is placed. */
const ownSectionNode = (n: number): MenuStructureNode => ({
  memberId: `m-own-${n}`,
  ref: { kind: "section", sectionId: `s-own-${n}` },
  internalName: `Own ${n}`,
  names: {},
  image: null,
  color: null,
  ownerMenuId: "menu-lunch",
  children: [],
});

const includedWineNode: MenuStructureNode = {
  memberId: "included-wine",
  ref: { kind: "section", sectionId: "wine-root" },
  internalName: "Wine menu",
  includedMenuId: "wine",
  ownerMenuId: "wine",
  folder: { showAsFolder: true, overrides: {} },
  children: [],
};

/** The colour the open section form has chosen; "" for none. */
function chosenColor(el: MenusScreen): string {
  return inModal(el, "new-section", 'button[role="radio"][aria-checked="true"]').dataset.color!;
}

async function createAt(el: MenusScreen, key: string, name: string): Promise<void> {
  await rowAction(el, key, "new-section");
  type(inModal(el, "new-section", 'wt-input[name="internalName"]'), name);
  await el.updateComplete;
}

it.each([
  ["no sections of its own", [productNode("m-burger", "p-burger")], "#edabab"],
  [
    "two sections of its own beside a product and an included menu",
    [ownSectionNode(0), productNode("m-burger", "p-burger"), includedWineNode, ownSectionNode(1)],
    "#ededab",
  ],
  ["eight sections of its own", [0, 1, 2, 3, 4, 5, 6, 7].map(ownSectionNode), "#edabab"],
])(
  "starts a new top-level section in a menu with %s with the next pale colour and stages it",
  async (_label, nodes, expected) => {
    const client = api({ getMenuStructure: vi.fn(async () => lunchWith(nodes)) });
    const el = await mountLunch(client);
    await createAt(el, "", "Ciders");
    expect(chosenColor(el)).toBe(expected);
    inModal(el, "new-section", '[data-test="new-section-save"]').click();
    await vi.waitFor(() => expect(modal(el, "new-section").open).toBe(false));
    expect(writeCalls(client)).toEqual([]);
    expect(structure(el).nodes.at(-1)).toMatchObject({ internalName: "Ciders", color: expected });
  },
);

it("starts and stages a new nested section with no colour", async () => {
  const client = api();
  const el = await mountLunch(client);
  await createAt(el, "m-drinks", "Ciders");
  expect(chosenColor(el)).toBe("");
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(() => expect(modal(el, "new-section").open).toBe(false));
  expect(writeCalls(client)).toEqual([]);
  expect(
    structure(el)
      .nodes.find(({ memberId }) => memberId === "m-drinks")
      ?.children?.at(-1),
  ).toMatchObject({ internalName: "Ciders", color: null });
});

it("stages no colour when the starting colour of a new top-level section is cleared", async () => {
  const client = api({ getMenuStructure: vi.fn(async () => lunchWith([])) });
  const el = await mountLunch(client);
  await emptyAdd(el, "new-section");
  type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Ciders");
  await el.updateComplete;
  expect(chosenColor(el)).toBe("#edabab");
  inModal(el, "new-section", 'button[data-color=""]').click();
  await el.updateComplete;
  expect(chosenColor(el)).toBe("");
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(() => expect(modal(el, "new-section").open).toBe(false));
  expect(writeCalls(client)).toEqual([]);
  expect(structure(el).nodes?.at(-1)).toMatchObject({ internalName: "Ciders", color: null });
});

it("edits a top-level section with no colour as having none, Save quiet, while a new one would start pale", async () => {
  const el = await mountLunch(api());
  await rowAction(el, "m-drinks", "edit");
  await vi.waitFor(() => expect(modal(el, "new-section").open).toBe(true));
  const form = q<HTMLElementTagNameMap["dashboard-section-details-form"]>(
    el,
    '[data-test="section-form"]',
  )!;
  await vi.waitFor(() => expect(form.value?.id).toBe("s-drinks"));
  await form.updateComplete;
  expect(chosenColor(el)).toBe("");
  const save = inModal<HTMLElementTagNameMap["wt-button"]>(
    el,
    "new-section",
    '[data-test="new-section-save"]',
  );
  await save.updateComplete;
  expect(save.disabled).toBe(true);
});

it("turns Select off and puts focus on the empty box's first add when removing its last member", async () => {
  const client = api({}, [productNode("m-burger", "p-burger")]);
  const el = await mountLunch(client);
  await vi.waitFor(() => expect(rowOf(el, "m-burger")).not.toBeNull());
  await pressMode(el);
  expect(modeToggle(el).getAttribute("aria-pressed")).toBe("true");
  await rowAction(el, "m-burger", "remove");
  await settleStructure(el);
  const add = structure(el).shadowRoot!.querySelector('[data-test="new-section-empty"]');
  expect(add).not.toBeNull();
  expect(structure(el).shadowRoot!.activeElement).toBe(add);
  expect(structure(el).selecting).toBe(false);
  expect(q(el, '[data-test="selection-done"]')).toBeNull();
  expect(writeCalls(client)).toEqual([]);
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
  const customerName = inModal(el, "new-section", 'wt-input[name="names-es"]');
  type(customerName, "Sidras");
  await el.updateComplete;
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await el.updateComplete;
  expect(name.error).toBe(t("sections.internal_name_required"));
  expect(await bottom(el, "new-section")).toBe(t("form.fix_fields"));
  expect(writeCalls(client)).toEqual([]);

  type(name, "Ciders");
  type(customerName, "");
  await el.updateComplete;
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await vi.waitFor(() => expect(modal(el, "new-section").open).toBe(false));
  expect(writeCalls(client)).toEqual([]);
  expect(
    structure(el)
      .nodes.find(({ memberId }) => memberId === "m-drinks")
      ?.children?.at(-1),
  ).toMatchObject({ internalName: "Ciders", names: {}, image: null, color: null });
  expect(currentPlace(el)).toBe("Lunch Menu › Drinks");
});

it("corrects the address without asking to leave when an open section form loses its list", async () => {
  const host = await placementLeaveHost();
  const live = new LiveData();
  const client = api({ liveData: live });
  const el = await mountLunch(client);
  const request = vi.fn((proceed: () => void | Promise<void>, signal: AbortSignal) =>
    host.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed, signal }),
  );
  const guard = new NavigationGuard(window, {
    isDirty: () => host.leave.coordinator.isDirty(),
    request,
  });
  onTestFinished(() => guard.dispose());
  await editDrinks(el);
  expect(location.pathname).toBe(LUNCH_PATH + "/section/m-drinks");
  await rowAction(el, "m-drinks", "new-section");
  type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Ciders");
  await el.updateComplete;
  await vi.waitFor(() => expect(host.leave.coordinator.isDirty()).toBe(true));
  await takeDrinksOff(el, client, live);
  expect(request).not.toHaveBeenCalled();
  expect(location.pathname).toBe(LUNCH_PATH);
  inModal(el, "new-section", '[data-test="new-section-save"]').click();
  await new Promise((resolve) => setTimeout(resolve));
  expect(client.addSectionMember.mock.calls).toEqual([]);
  expect(writeCalls(client)).toEqual([]);
  expect(modal(el, "new-section").open).toBe(false);
  expect(text(q(el, '[data-test="member-error"]'))).toBe(
    t("menus.list_gone").replace("{name}", "Drinks"),
  );
});

it("removes just the chosen placement and offers editing and removal for a section", async () => {
  const client = api();
  const el = await mountLunch(client);
  expect(text(inStructure(el, '[data-test="remove-m-burger"]'))).toBe(
    t("menus.remove_selected_confirm"),
  );
  await editDrinks(el);
  expect(text(inStructure(el, '[data-test="remove-m-drinks/m-lemonade"]'))).toBe(
    t("menus.remove_selected_confirm"),
  );
  const actions = inStructure(el, '[data-test="actions-m-drinks/m-beer"]')!;
  expect(actions.querySelector('[data-test="edit-m-drinks/m-beer"]')).not.toBeNull();
  expect(text(actions.querySelector('[data-test="delete-m-drinks/m-beer"]'))).toBe(
    t("menus.remove_selected_confirm"),
  );
  await rowAction(el, "m-drinks/m-lemonade", "remove");
  expect(rowOf(el, "m-drinks/m-lemonade")).toBeNull();
  expect(modal(el, "delete-section").open).toBe(false);
  expect(writeCalls(client)).toEqual([]);
  await toggleRow(el, "m-fav");
  expect(rowOf(el, "m-fav/m-fav-lemonade")).not.toBeNull();
});

it("stages removing an empty section without asking to remove its contents", async () => {
  const nodes = lunchNodes();
  const client = api(
    {},
    nodes.map((row) => (row.memberId === "m-fav" ? { ...row, children: [] } : row)),
  );
  const el = await mountLunch(client);
  expect(topLevelKeys(el)).toContain("m-fav");

  await rowAction(el, "m-fav", "delete");

  expect(topLevelKeys(el)).toEqual(["m-burger", "m-drinks"]);
  expect(modal(el, "delete-section").open).toBe(false);
  expect(writeCalls(client)).toEqual([]);
});

it("stages section details and confirms removing the nonempty section", async () => {
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
    placeableSetMenus: [],
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
  await vi.waitFor(() => expect(form.open).toBe(false));
  expect(client.updateSection).not.toHaveBeenCalled();
  expect(structure(el).nodes.find(({ memberId }) => memberId === "m-drinks")).toMatchObject({
    internalName: "Drinks list",
    names: { en: "Refreshments", es: "Bebidas" },
    image: null,
    color: "#aa3300",
  });
  await rowAction(el, "m-drinks", "delete");
  expect(modal(el, "delete-section").textContent).toContain(
    t("menus.remove_section_contents").replace("{name}", "Drinks list"),
  );
  inModal(el, "delete-section", '[data-test="delete-section-save"]').click();
  await vi.waitFor(() => expect(topLevelKeys(el)).not.toContain("m-drinks"));
  expect(client.deleteSection).not.toHaveBeenCalled();
  expect(client.removeSectionMember).not.toHaveBeenCalled();
});

it("removes the owned descendants wherever they are shown after confirming their parent", async () => {
  const client = api({}, lunchWithBeerTwiceInFavourites());
  const el = await mountLunch(client);
  await rowAction(el, "m-fav", "delete");
  expect(text(modal(el, "delete-section").querySelector("p"))).toBe(
    t("menus.remove_section_contents").replace("{name}", "Favourites"),
  );
  inModal(el, "delete-section", '[data-test="delete-section-save"]').click();
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-burger"]));
  expect(writeCalls(client)).toEqual([]);
  await saveStructure(el);
  expect(structureWrite(client)).toEqual({
    rootMembers: [{ id: "m-burger", ref: { kind: "product", productId: "p-burger" } }],
    sections: [],
    prices: [],
  });
});

it("ArrowUp and ArrowDown reorder the list being edited, and focus stays on the moved row", async () => {
  const client = api();
  const el = await mountLunch(client);
  const list = structureRows(el);
  const handle = () =>
    list.shadowRoot.querySelector<HTMLButtonElement>('[data-test="drag-m-burger"]')!;
  const order = () =>
    [...list.shadowRoot.querySelectorAll('tbody tr[aria-level="2"]')].map((row) =>
      row.getAttribute("data-row-key"),
    );
  handle().focus();
  expect(list.shadowRoot.activeElement).toBe(handle());
  handle().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  expect(client.moveSectionMember).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-drinks", "m-burger", "m-fav"]));
  await el.updateComplete;
  await list.updateComplete;
  expect(order()).toEqual(["m-drinks", "m-burger", "m-fav"]);
  expect(list.shadowRoot!.activeElement).toBe(handle());

  handle().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  expect(client.moveSectionMember).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-burger", "m-drinks", "m-fav"]));
  await el.updateComplete;
  await list.updateComplete;
  expect(order()).toEqual(["m-burger", "m-drinks", "m-fav"]);
  expect(list.shadowRoot!.activeElement).toBe(handle());
  expect(client.getMenuStructure).toHaveBeenCalledOnce();
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
  expect(writeCalls(client)).toEqual([]);
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

it("moves a member into another section from the tree's drag, opening the section so the moved row is drawn", async () => {
  const client = api();
  const el = await mountLunch(client);
  emit(structure(el), "wt-member-move-into", {
    from: [],
    memberId: "m-burger",
    to: ["m-fav"],
    position: 1,
  });
  await vi.waitFor(() => expect(rowOf(el, "m-fav/m-burger")).not.toBeNull());
  expect(childKeys(el, "m-fav")).toEqual([
    "m-fav/m-fav-lemonade",
    "m-fav/m-burger",
    "m-fav/m-fav-drinks",
  ]);
  expect(writeCalls(client)).toEqual([]);
  expect(client.getMenuStructure).toHaveBeenCalledOnce();
  expect(currentPlace(el)).toBe("Lunch Menu › Favourites");
  expect(topLevelKeys(el)).toEqual(["m-drinks", "m-fav"]);
});

it("moves a member out of a section to the menu's top level by the menu's own list", async () => {
  const client = api();
  const el = await mountLunch(client);
  await editDrinks(el);
  emit(structure(el), "wt-member-move-into", {
    from: ["m-drinks"],
    memberId: "m-lager",
    to: [],
    position: 0,
  });
  await vi.waitFor(() => expect(topLevelKeys(el)).toContain("m-lager"));
  expect(topLevelKeys(el)).toEqual(["m-lager", "m-burger", "m-drinks", "m-fav"]);
  expect(writeCalls(client)).toEqual([]);
  expect(client.getMenuStructure).toHaveBeenCalledOnce();
  expect(currentPlace(el)).toBe("Lunch Menu");
});

it("explains a drag that would add a second copy to the destination", async () => {
  const client = api();
  const el = await mountLunch(client);
  await editDrinks(el);
  await toggleRow(el, "m-drinks/m-beer");
  emit(structure(el), "wt-member-move-into", {
    from: ["m-drinks"],
    memberId: "m-lager",
    to: ["m-drinks", "m-beer"],
  });
  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="structure-write-error"]'))).toBe(
      codeMessage("menu_section.member_duplicate"),
    ),
  );
  expect(childKeys(el, "m-drinks")).toContain("m-drinks/m-lager");
  expect(childKeys(el, "m-drinks/m-beer")).toEqual(["m-drinks/m-beer/m-lager-2"]);
  expect(writeCalls(client)).toEqual([]);
});

it("moves a member into a closed section with no position, and puts it last in the draft", async () => {
  const client = api();
  const el = await mountLunch(client);
  emit(structure(el), "wt-member-move-into", { from: [], memberId: "m-burger", to: ["m-fav"] });
  await vi.waitFor(() => expect(rowOf(el, "m-fav/m-burger")).not.toBeNull());
  expect(childKeys(el, "m-fav").at(-1)).toBe("m-fav/m-burger");
  expect(writeCalls(client)).toEqual([]);
});

it("moves a product into the section above it with ArrowRight on its grip, and focus follows it", async () => {
  const client = api();
  const el = await mountLunch(client);
  await editDrinks(el);
  const list = structureRows(el);
  const grip = (key: string) =>
    list.shadowRoot.querySelector<HTMLButtonElement>(`[data-test="drag-${CSS.escape(key)}"]`);
  grip("m-drinks/m-lemonade")!.focus();
  grip("m-drinks/m-lemonade")!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() =>
    expect(list.shadowRoot.activeElement).toBe(grip("m-drinks/m-beer/m-lemonade")),
  );
  expect(grip("m-drinks/m-beer/m-lemonade")).not.toBeNull();
  expect(currentPlace(el)).toBe("Lunch Menu › Drinks › Beer");
  expect(writeCalls(client)).toEqual([]);
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
  expect(client.addSectionProducts).not.toHaveBeenCalled();
  expect(
    structure(el)
      .nodes.find(({ memberId }) => memberId === "m-drinks")
      ?.children?.slice(-2)
      .map(({ ref }) => ref),
  ).toEqual([
    { kind: "product", productId: "p-chips" },
    { kind: "product", productId: "p-burger" },
  ]);
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

async function visit(el: MenusScreen, path: string, heading: string): Promise<void> {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  await vi.waitFor(() => expect(text(q(el, "h1"))).toBe(heading));
  await vi.waitFor(() => expect(structure(el)).not.toBeNull());
  await el.updateComplete;
}

const DINNER_PATH = "/menus/menu/menu-dinner/view/structure";

it("closes an open window without a message when the person goes to another menu", async () => {
  const el = await mountLunch();
  await rowAction(el, "", "new-section");
  expect(modal(el, "new-section").heading).toBe(
    t("menus.new_section_heading").replace("{list}", "Lunch Menu"),
  );
  await visit(el, DINNER_PATH, "Dinner Menu");
  expect(modal(el, "new-section").open).toBe(false);
  expect(q(el, '[data-test="member-error"]')).toBeNull();

  await emptyAdd(el, "open-add-products");
  await visit(el, LUNCH_PATH, "Lunch Menu");
  await editDrinks(el);
  expect(modal(el, "add-products").open).toBe(false);
  expect(q(el, '[data-test="member-error"]')).toBeNull();
});

it("closes a row's Remove section confirmation when another menu is opened", async () => {
  const client = api();
  const el = await mountLunch(client);
  await rowAction(el, "m-drinks", "delete");
  expect(modal(el, "delete-section").open).toBe(true);
  await visit(el, DINNER_PATH, "Dinner Menu");
  expect(modal(el, "delete-section").open).toBe(false);
  expect(writeCalls(client)).toEqual([]);
});

it("closes a row's Edit section form when another menu is opened, saving nothing", async () => {
  const client = api();
  const el = await mountLunch(client);
  await rowAction(el, "m-drinks", "edit");
  expect(modal(el, "new-section").open).toBe(true);
  await visit(el, DINNER_PATH, "Dinner Menu");
  expect(modal(el, "new-section").open).toBe(false);
  emit(q(el, '[data-test="section-form"]')!, "wt-submit", {
    internalName: "Ciders",
    names: {},
    image: null,
    color: null,
  });
  await el.updateComplete;
  expect(writeCalls(client)).toEqual([]);
});

it("puts an unaddressed Structure refusal in the Save bar and keeps the draft ready to retry", async () => {
  const client = api({
    saveMenuStructure: vi
      .fn()
      .mockRejectedValueOnce({ code: "menu_section.not_found" })
      .mockResolvedValue({ dropped: [] }),
  });
  const el = await mountLunch(client);
  await rowAction(el, "m-burger", "remove");
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-drinks", "m-fav"]));
  expect(writeCalls(client)).toEqual([]);
  await saveStructure(el);
  const save = q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="structure-save"]')!;
  const bar = save.closest("wt-form-actions")!;
  await vi.waitFor(() => expect(bar.error).toBe(codeMessage("menu_section.not_found")));
  expect(save.disabled).toBe(false);
  expect(topLevelKeys(el)).toEqual(["m-drinks", "m-fav"]);
  expect(client.getMenuStructure).toHaveBeenCalledOnce();
  await saveStructure(el);
  await vi.waitFor(() => expect(client.saveMenuStructure).toHaveBeenCalledTimes(2));
  expect(client.saveMenuStructure.mock.calls[1]).toEqual(client.saveMenuStructure.mock.calls[0]);
  expect(bar.error).toBe("");
});

it("names the product when its price can no longer be saved", async () => {
  const client = api({
    saveMenuStructure: vi.fn().mockResolvedValue({
      dropped: [{ productId: "p-burger", reason: "deleted" }],
    }),
  });
  const el = await mountLunch(client);
  emit(structure(el), "wt-structure-price", { productId: "p-burger", value: "12.50" });
  await el.updateComplete;
  await saveStructure(el);

  await vi.waitFor(() =>
    expect(text(q(el, '[data-test="structure-dropped"]'))).toBe(
      t("menus.structure_dropped").replace("{names}", "Burger"),
    ),
  );
  expect(structureWrite(client).prices).toContainEqual({
    productId: "p-burger",
    price: "12.50",
  });
});

it("reports a failed Structure refresh after an accepted Save as a load failure", async () => {
  const client = api();
  const el = await mountLunch(client);
  client.getMenuStructure.mockRejectedValue(new Error("down"));
  emit(structure(el), "wt-member-remove", { path: [], memberId: "m-burger" });
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-drinks", "m-fav"]));
  expect(writeCalls(client)).toEqual([]);
  await saveStructure(el);
  await vi.waitFor(() => expect(q(el, '[data-test="structure-error"]')).not.toBeNull());
  expect(q(el, '[data-test="member-error"]')).toBeNull();
  expect(client.saveMenuStructure).toHaveBeenCalledOnce();
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

it("waits for both arrangement and prices before offering Structure edits", async () => {
  const client = api();
  client.priceRows.mockRejectedValueOnce(new Error("prices unavailable"));
  const el = await mount(client, LUNCH_PATH);
  await vi.waitFor(() => expect(q(el, '[data-test="structure-error"]')).not.toBeNull());
  expect(q(el, "dashboard-menu-structure-table")).toBeNull();
  expect(q(el, '[data-test="structure-save"]')).toBeNull();

  await click(el, "structure-retry");
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-burger", "m-drinks", "m-fav"]));
  expect(q(el, 'wt-button[data-test="structure-save"][disabled]')).not.toBeNull();
  expect(q(el, '[data-test="structure-error"]')).toBeNull();
});

/** The staff name, the included menu's own customer names and the folder's fixed name all read
 * differently, so a dialog showing the wrong one fails. */
const WINE_NAMES = { en: "Wine list", es: "Carta de vinos" };

/** Lunch and the Wines menu it includes. */
function winesClient(folder: IncludeFolder, overrides: ApiOverrides = {}) {
  const live = new LiveData();
  let names: Record<string, string> = WINE_NAMES;
  const client = api({
    liveData: live,
    ...overrides,
  });
  const read = client.getMenuStructure.getMockImplementation()! as (
    id: string,
  ) => Promise<MenuStructure>;
  client.getMenuStructure.mockImplementation(async (id: string) => {
    const answer = await read(id);
    if (id === "wine") {
      return {
        ...answer,
        rootSectionId: "wine-root",
        root: { ...answer.root, id: "wine-root", internalName: "Wines", names, color: "#112233" },
        nodes: [productNode("wine-chips", "p-chips")],
      };
    }
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
      folder: structuredClone(folder),
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
  it.each([
    ["m-fav%2Fm-fav-drinks", "m-fav/m-fav-drinks", "m-fav%2Fm-fav-drinks"],
    ["m-fav%2Fmissing", "m-fav", "m-fav"],
  ])("opens a section from %s after the structure arrives", async (address, key, canonical) => {
    const path = LUNCH_PATH + "/section/" + address;
    const fixture = api();
    const answer = deferred<MenuStructure>();
    const el = await mount(api({ getMenuStructure: vi.fn(() => answer.promise) }), path);
    expect(q(el, '[data-test="structure-loading"]')).not.toBeNull();
    expect(location.pathname).toBe(path);
    answer.resolve(await fixture.getMenuStructure("menu-lunch"));
    await vi.waitFor(() => expect(currentKey(el)).toBe(key));
    expect(location.pathname).toBe(LUNCH_PATH + "/section/" + canonical);
  });

  it("remembers a selected section across tabs and replaces the Structure address", async () => {
    const el = await mountLunch();
    const replace = vi.spyOn(history, "replaceState");
    const push = vi.spyOn(history, "pushState");
    onTestFinished(() => {
      replace.mockRestore();
      push.mockRestore();
    });
    const address = LUNCH_PATH + "/section/m-drinks";
    await editDrinks(el);
    expect(location.pathname).toBe(address);
    expect(push).not.toHaveBeenCalled();

    await chooseTab(el, "home");
    expect(location.pathname).toBe(HOME_PATH);
    await chooseTab(el, "structure");
    expect(location.pathname).toBe(address);
    expect(currentKey(el)).toBe("m-drinks");
    const [, , last] = replace.mock.lastCall!;
    expect(new URL(String(last), location.origin).pathname).toBe(address);

    await visit(el, DINNER_PATH, "Dinner Menu");
    expect(currentKey(el)).toBe("");
    expect(location.pathname).toBe(DINNER_PATH);
  });

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
  function includeClient(overrides: ApiOverrides = {}) {
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

  const membersAt = (el: MenusScreen, key: string): MenuStructureNode[] =>
    key === ""
      ? structure(el).nodes
      : key
          .split("/")
          .reduce(
            (nodes, memberId) => nodes.find((node) => node.memberId === memberId)?.children ?? [],
            structure(el).nodes,
          );

  const NEW_SECTION = { internalName: "Ciders", names: {}, image: null, color: null };

  /** The Drinks shown inside Favourites is the same list as the Drinks at the top level. */
  const places = [
    { key: "m-fav/m-fav-drinks", open: ["m-fav"], list: "s-drinks", name: "Drinks" },
    { key: "m-fav", open: [], list: "s-fav", name: "Favourites" },
    { key: "", open: [], list: "root-lunch", name: "Lunch Menu" },
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
        expect(membersAt(el, row.key).map(({ ref }) => ref)).toContainEqual({
          kind: "product",
          productId: "p-chips",
        }),
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
        expect(membersAt(el, row.key)).toContainEqual(expect.objectContaining(NEW_SECTION)),
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
      expect(membersAt(el, row.key)).toContainEqual(
        expect.objectContaining({
          includedMenuId: "wine",
          ref: { kind: "section", sectionId: "wine-root" },
        }),
      ),
    );
  });

  it("makes the row an add is chosen from current", async () => {
    const el = await mountLunch();
    expect(currentPlace(el)).toBe("Lunch Menu");
    await rowAction(el, "m-fav", "open-add-products");
    expect(currentPlace(el)).toBe("Lunch Menu › Favourites");
  });

  it("stages the same reorder in both places Drinks appears without reading again", async () => {
    const client = api();
    const el = await mountLunch(client);
    await toggleRow(el, "m-drinks");
    await toggleRow(el, "m-fav");
    await toggleRow(el, "m-fav/m-fav-drinks");
    const grip = inStructure<HTMLButtonElement>(el, '[data-test="drag-m-drinks/m-lager"]')!;
    grip.focus();
    grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await vi.waitFor(() =>
      expect(childKeys(el, "m-drinks")).toEqual([
        "m-drinks/m-beer",
        "m-drinks/m-lager",
        "m-drinks/m-lemonade",
      ]),
    );
    expect(childKeys(el, "m-fav/m-fav-drinks")).toEqual([
      "m-fav/m-fav-drinks/m-beer",
      "m-fav/m-fav-drinks/m-lager",
      "m-fav/m-fav-drinks/m-lemonade",
    ]);
    expect(client.moveSectionMember).not.toHaveBeenCalled();
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
      expect(inStructure(el, '[data-row-key="m-drinks/m-lemonade"]')).toBeNull(),
    );
    expect(client.removeSectionMember).not.toHaveBeenCalled();
  });

  describe("combined Select and reorder mode", () => {
    beforeEach(() => {
      const before = currentLocale();
      setLocale("en");
      onTestFinished(() => setLocale(before));
    });

    const grips = (el: MenusScreen) => allInStructure(el, '[data-test^="drag-"]');

    it("starts with grips and the Select toggle not pressed", async () => {
      const el = await mountLunch();
      await toggleRow(el, "m-drinks");
      expect(grips(el).length).toBeGreaterThan(0);
      expect(modeToggle(el).getAttribute("aria-pressed")).toBe("false");
      expect(q(el, '[data-test="selection-done"]')).toBeNull();
    });

    it("offers Select as an icon button with a tooltip; pressed, every owned row has a grip, and an arrow on one moves it", async () => {
      const viewport = [window.innerWidth, window.innerHeight] as const;
      await page.viewport(1280, 844);
      onTestFinished(() => page.viewport(...viewport));
      const client = api();
      const el = await mountLunch(client);
      expect(el.shadowRoot!.querySelector('wt-icon-button[data-test="select"]')).not.toBeNull();
      await toggleRow(el, "m-drinks");
      const toggle = modeToggle(el);
      expect(toggle.localName).toBe("button");
      expect(toggle.getAttribute("type")).toBe("button");
      expect(modeHost(el).getAttribute("slot")).toBe("toolbar-start");
      expect(toggle.getAttribute("aria-label")).toBe("Select");
      const tooltip = toggle.querySelector<HTMLElement>(".icon-tooltip")!;
      expect(tooltip.textContent!.trim()).toBe("Select");
      expect(tooltip.getAttribute("aria-hidden")).toBe("true");
      // The shared icon-button look, so the styles reached this screen: a native button's border
      // is 2px outset, and an unstyled tooltip is always shown.
      expect(getComputedStyle(toggle).borderTopStyle).toBe("solid");
      expect(getComputedStyle(toggle).borderTopWidth).toBe("1px");
      expect(getComputedStyle(tooltip).display).toBe("none");
      expect(modeHost(el).assignedSlot).not.toBeNull();
      expect(toggle.getBoundingClientRect().width).toBeGreaterThan(0);

      await pressMode(el);
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
      await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-drinks", "m-burger", "m-fav"]));
      expect(client.moveSectionMember).not.toHaveBeenCalled();
      await settleStructure(el);
      expect(structureRows(el).shadowRoot.activeElement).toBe(
        inStructure(el, '[data-test="drag-m-burger"]'),
      );
    });

    it("names Select in Spanish", async () => {
      setLocale("es");
      const el = await mountLunch();
      expect(modeToggle(el).getAttribute("aria-label")).toBe("Seleccionar");
      expect(modeToggle(el).querySelector(".icon-tooltip")!.textContent!.trim()).toBe(
        "Seleccionar",
      );
      await pressMode(el);
      expect(text(q(el, '[data-test="selection-done"]'))).toBe("Listo");
    });

    it("leaves the mode by Done, handing focus back to the toggle, and by a second press", async () => {
      const el = await mountLunch();
      await pressMode(el);
      const done = q(el, '[data-test="selection-done"]')!;
      expect(done.localName).toBe("wt-button");
      expect(done.closest('[data-test="selection-bar"]')!.getAttribute("slot")).toBe(
        "toolbar-bottom",
      );
      expect(done.closest('[data-test="selection-bar"]')!.assignedSlot).not.toBeNull();
      expect(done.getBoundingClientRect().width).toBeGreaterThan(0);
      expect(text(done)).toBe("Done");
      expect(grips(el).length).toBeGreaterThan(0);
      done.focus();
      await userEvent.keyboard("{Enter}");
      await settleStructure(el);
      expect(grips(el).length).toBeGreaterThan(0);
      expect(q(el, '[data-test="selection-done"]')).toBeNull();
      expect(modeToggle(el).getAttribute("aria-pressed")).toBe("false");
      expect(el.shadowRoot!.activeElement).toBe(modeHost(el));
      expect(modeHost(el).shadowRoot!.activeElement).toBe(modeToggle(el));

      await pressMode(el);
      expect(grips(el).length).toBeGreaterThan(0);
      await pressMode(el);
      expect(grips(el).length).toBeGreaterThan(0);
      expect(q(el, '[data-test="selection-done"]')).toBeNull();
    });

    it("turns the mode off when another menu is opened", async () => {
      const el = await mountLunch();
      await pressMode(el);
      expect(structure(el).selecting).toBe(true);
      history.pushState(null, "", DINNER_PATH);
      window.dispatchEvent(new PopStateEvent("popstate"));
      await vi.waitFor(() => expect(text(q(el, "h1"))).toBe("Dinner Menu"));
      await vi.waitFor(() => expect(structure(el)).not.toBeNull());
      await settleStructure(el);
      expect(structure(el).selecting).toBe(false);
      expect(modeToggle(el).getAttribute("aria-pressed")).toBe("false");
      expect(q(el, '[data-test="selection-done"]')).toBeNull();
    });
  });

  describe("the search box", () => {
    beforeEach(() => {
      const before = currentLocale();
      setLocale("en");
      onTestFinished(() => setLocale(before));
    });

    type Input = HTMLElementTagNameMap["wt-input"];
    const searchBox = (el: MenusScreen) => q<Input>(el, 'wt-input[name="structure-search"]')!;
    const shownKeys = (el: MenusScreen) =>
      allInStructure(el, "tbody tr[data-row-key]").map((tr) => tr.dataset.rowKey!);

    async function typeSearch(el: MenusScreen, value: string): Promise<void> {
      emit(searchBox(el), "wt-change", { value });
      await settleStructure(el);
    }

    it("is a labelled search field in the tree's toolbar, and finds a product inside a closed section", async () => {
      const el = await mountLunch();
      const box = searchBox(el);
      expect(box.getAttribute("type")).toBe("search");
      expect(box.getAttribute("label")).toBe("Search this menu");
      expect(box.getAttribute("slot")).toBe("toolbar-search");
      expect(box.assignedSlot).not.toBeNull();
      expect(box.getBoundingClientRect().width).toBeGreaterThan(0);
      expect(shownKeys(el)).toEqual(["root", "m-burger", "m-drinks", "m-fav"]);

      await typeSearch(el, "Lemonade");
      expect(structure(el).search).toBe("Lemonade");
      expect(box.value).toBe("Lemonade");
      expect(shownKeys(el)).toEqual([
        "m-drinks/m-lemonade",
        "m-fav/m-fav-lemonade",
        "m-fav/m-fav-drinks/m-lemonade",
      ]);
    });

    it("names the search box in Spanish", async () => {
      setLocale("es");
      const el = await mountLunch();
      expect(searchBox(el).getAttribute("label")).toBe("Buscar en esta carta");
    });

    it.each(["en-GB", "es-ES"])(
      "fits Search, Filters and Select on the same line at phone width in %s",
      async (locale) => {
        await at([390, 844], locale, async () => {
          const el = await mountLunch();
          const table = q<HTMLElement>(el, "dashboard-menu-structure-table")!;
          const search = searchBox(el).getBoundingClientRect();
          const chooser = table
            .shadowRoot!.querySelector("wt-data-table")!
            .shadowRoot!.querySelector<HTMLButtonElement>(".filters-trigger")!;
          const box = chooser.getBoundingClientRect();
          const select = modeToggle(el).getBoundingClientRect();
          expect(search.width).toBeGreaterThan(box.width + select.width);
          expect(box.top).toBeLessThan(search.bottom);
          expect(box.bottom).toBeGreaterThan(search.top);
          expect(select.top).toBeLessThan(search.bottom);
          expect(select.bottom).toBeGreaterThan(search.top);
        });
      },
    );

    it("keeps the search through a staged removal and through Done on Select", async () => {
      const client = api();
      const el = await mountLunch(client);
      await typeSearch(el, "Lemonade");
      await rowAction(el, "m-drinks/m-lemonade", "remove");
      await settleStructure(el);
      expect(shownKeys(el)).toEqual(["m-fav/m-fav-lemonade"]);
      expect(client.removeSectionMember).not.toHaveBeenCalled();
      expect(searchBox(el).value).toBe("Lemonade");

      await pressMode(el);
      q(el, '[data-test="selection-done"]')!.click();
      await settleStructure(el);
      expect(structure(el).selecting).toBe(false);
      expect(searchBox(el).value).toBe("Lemonade");
      expect(structure(el).search).toBe("Lemonade");
    });

    it("clears the search when another menu is opened", async () => {
      const el = await mountLunch();
      await typeSearch(el, "Lemonade");
      await visit(el, DINNER_PATH, "Dinner Menu");
      await settleStructure(el);
      expect(structure(el).search).toBe("");
      expect(searchBox(el)?.value ?? "").toBe("");
    });
  });

  describe("Select mode", () => {
    beforeEach(() => {
      const before = currentLocale();
      setLocale("en");
      onTestFinished(() => setLocale(before));
    });

    const selectToggle = modeToggle;
    const bar = (el: MenusScreen) => q(el, '[data-test="selection-bar"]');
    const removeButton = (el: MenusScreen) =>
      q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="selection-remove"]')!;
    const rowBoxes = (el: MenusScreen) =>
      allInStructure<HTMLInputElement>(el, 'input[type="checkbox"][data-test^="select-"]').filter(
        (box) => box.dataset.test !== "select-all",
      );

    async function pressSelect(el: MenusScreen): Promise<void> {
      selectToggle(el).click();
      await settleStructure(el);
    }

    async function tick(el: MenusScreen, key: string): Promise<void> {
      inStructure<HTMLInputElement>(el, `[data-test="${CSS.escape(`select-${key}`)}"]`)!.click();
      await settleStructure(el);
    }

    async function openRemove(el: MenusScreen): Promise<void> {
      removeButton(el).click();
      await vi.waitFor(() => expect(modal(el, "remove-selected").open).toBe(true));
      await el.updateComplete;
    }

    it("holds Select and its Move, Remove and Done actions until Structure Save finishes", async () => {
      const pending = deferred<{ dropped: [] }>();
      const client = api({ saveMenuStructure: vi.fn(() => pending.promise) });
      const el = await mountLunch(client);
      await rowAction(el, "m-burger", "remove");
      await pressSelect(el);
      await tick(el, "m-drinks");
      const move = q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="selection-move"]')!;
      const done = q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="selection-done"]')!;
      expect(move.disabled).toBe(false);
      expect(removeButton(el).disabled).toBe(false);
      client.getMenuStructure.mockResolvedValue(lunchWith(lunchNodes().slice(1)));

      await saveStructure(el);
      try {
        expect(client.saveMenuStructure).toHaveBeenCalledOnce();
        expect(move.disabled).toBe(true);
        expect(removeButton(el).disabled).toBe(true);
        expect(removeButton(el).variant).toBe("secondary");
        expect(done.disabled).toBe(true);
        expect(selectToggle(el).disabled).toBe(true);
      } finally {
        pending.resolve({ dropped: [] });
      }

      await vi.waitFor(() => expect(move.disabled).toBe(false));
      expect(removeButton(el).disabled).toBe(false);
      expect(done.disabled).toBe(false);
      expect(selectToggle(el).disabled).toBe(false);
    });

    it.each([
      ["en-GB", "Move…"],
      ["es-ES", "Mover…"],
    ])(
      "fits the count and all three actions on one phone Select line in %s",
      async (locale, moveLabel) => {
        await at([390, 844], locale, async () => {
          const el = await mountLunch();
          await pressSelect(el);
          await tick(el, "m-burger");
          const move = q(el, '[data-test="selection-move"]')!;
          const visibleLabel = [...move.children].find((label) => label.getClientRects().length);
          expect(visibleLabel?.textContent ?? text(move)).toBe(moveLabel);
          const count = q(el, '[data-test="selected-count"]')!.getBoundingClientRect();
          for (const action of [move, removeButton(el), q(el, '[data-test="selection-done"]')!]) {
            const rect = action.getBoundingClientRect();
            expect(rect.top).toBeLessThan(count.bottom);
            expect(rect.bottom).toBeGreaterThan(count.top);
          }
        });
      },
    );

    it("offers Select as the only mode icon button; pressed, rows carry boxes and the bar shows", async () => {
      const el = await mountLunch();
      const toggle = selectToggle(el);
      expect(toggle.localName).toBe("button");
      expect(toggle.getAttribute("type")).toBe("button");
      expect(modeHost(el).getAttribute("slot")).toBe("toolbar-start");
      expect(toggle.classList.contains("icon-button")).toBe(true);
      expect(toggle.querySelector("wt-icon")!.getAttribute("name")).toBe("select-rows");
      expect(toggle.getAttribute("aria-label")).toBe("Select");
      expect(toggle.querySelector(".icon-tooltip")!.textContent!.trim()).toBe("Select");
      expect(toggle.getAttribute("aria-pressed")).toBe("false");
      expect(q(el, '[data-test="reorder"]')).toBeNull();
      expect(modeHost(el).assignedSlot).not.toBeNull();
      expect(toggle.getBoundingClientRect().width).toBeGreaterThan(0);
      expect(rowBoxes(el)).toEqual([]);
      expect(bar(el)).toBeNull();

      await pressSelect(el);
      expect(toggle.getAttribute("aria-pressed")).toBe("true");
      expect(structure(el).selecting).toBe(true);
      expect(rowBoxes(el).map((box) => box.dataset.test)).toEqual([
        "select-m-burger",
        "select-m-drinks",
        "select-m-fav",
      ]);
      expect(bar(el)!.getAttribute("slot")).toBe("toolbar-bottom");
      expect(bar(el)!.getBoundingClientRect().width).toBeGreaterThan(0);
      expect(text(q(el, '[data-test="selected-count"]'))).toBe("0 selected");
      expect(q(el, '[data-test="selected-count"]')!.getAttribute("aria-live")).toBe("polite");
      expect(removeButton(el).disabled).toBe(true);
      expect(removeButton(el).variant).toBe("secondary");

      await tick(el, "m-burger");
      expect(text(q(el, '[data-test="selected-count"]'))).toBe("1 selected");
      expect(removeButton(el).disabled).toBe(false);
      expect(removeButton(el).variant).toBe("secondary");
      expect(allInStructure(el, '[data-test^="drag-"]').map((grip) => grip.dataset.test)).toEqual([
        "drag-m-burger",
        "drag-m-drinks",
        "drag-m-fav",
      ]);

      await pressSelect(el);
      expect(rowBoxes(el)).toEqual([]);
      expect(bar(el)).toBeNull();
      expect(structure(el).selected).toEqual([]);
    });

    it("names Select, the count and the bar's actions in Spanish", async () => {
      setLocale("es");
      const el = await mountLunch();
      expect(selectToggle(el).getAttribute("aria-label")).toBe("Seleccionar");
      await pressSelect(el);
      await tick(el, "m-burger");
      expect(text(q(el, '[data-test="selected-count"]'))).toBe("1 seleccionado");
      await tick(el, "m-fav");
      expect(text(q(el, '[data-test="selected-count"]'))).toBe("2 seleccionados");
      expect(text(removeButton(el))).toBe("Quitar");
      expect(text(q(el, '[data-test="selection-done"]'))).toBe("Listo");
    });

    it("removes a dish and a nonempty section together after one confirmation", async () => {
      const client = api();
      const el = await mountLunch(client);
      await pressSelect(el);
      await tick(el, "m-burger");
      await tick(el, "m-drinks");
      expect(removeButton(el).disabled).toBe(false);
      removeButton(el).click();
      await vi.waitFor(() => expect(modal(el, "remove-selected").open).toBe(true));
      expect(topLevelKeys(el)).toContain("m-drinks");
      inModal(el, "remove-selected", '[data-test="remove-selected-save"]').click();
      await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-fav"]));
      expect(client.removeSectionMembers).not.toHaveBeenCalled();
      expect(client.deleteSections).not.toHaveBeenCalled();
    });

    it("counts one owned section once in Remove when both placements are ticked", async () => {
      const client = api();
      const el = await mountLunch(client);
      await toggleRow(el, "m-fav");
      await pressSelect(el);
      await tick(el, "m-drinks");
      await tick(el, "m-fav/m-fav-drinks");
      await openRemove(el);
      const dialog = modal(el, "remove-selected");
      expect(dialog.heading).toBe("Remove 1 item?");
      expect(
        [...dialog.querySelectorAll('[data-test="remove-selected-items"] li')].map(text),
      ).toEqual(["Drinks, from Lunch Menu"]);
      inModal(el, "remove-selected", '[data-test="remove-selected-save"]').click();
      await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-burger", "m-fav"]));
      expect(rowOf(el, "m-fav/m-fav-drinks")).toBeNull();
      expect(writeCalls(client)).toEqual([]);
    });

    it("drops a tick when a live refresh removes the row, keeping the other tick", async () => {
      const live = new LiveData();
      const client = api({ liveData: live });
      const el = await mountLunch(client);
      await pressSelect(el);
      await tick(el, "m-burger");
      await tick(el, "m-fav");
      client.getMenuStructure.mockResolvedValue(lunchWith(lunchNodes().slice(1)));
      live.invalidate([{ type: "section_members" }]);
      await vi.waitFor(() => expect(rowOf(el, "m-burger")).toBeNull());
      expect(structure(el).selected).toEqual(["m-fav"]);
      expect(text(q(el, '[data-test="selected-count"]'))).toBe("1 selected");
    });

    it("stages removal of selected dishes without a confirmation or write", async () => {
      const client = api();
      const el = await mountLunch(client);
      await toggleRow(el, "m-drinks");
      await pressSelect(el);
      await tick(el, "m-burger");
      await tick(el, "m-drinks/m-lemonade");
      removeButton(el).click();
      await vi.waitFor(() => expect(topLevelKeys(el)).not.toContain("m-burger"));
      expect(rowOf(el, "m-drinks/m-lemonade")).toBeNull();
      expect(modal(el, "remove-selected").open).toBe(false);
      expect(writeCalls(client)).toEqual([]);
      expect(structure(el).selected).toEqual([]);
      expect(text(q(el, '[data-test="selected-count"]'))).toBe("0 selected");
    });

    it("names one item in the singular", async () => {
      const el = await mountLunch();
      await pressSelect(el);
      await tick(el, "m-drinks");
      await openRemove(el);
      expect(modal(el, "remove-selected").getAttribute("heading")).toBe("Remove 1 item?");
      setLocale("es");
      el.requestUpdate();
      await el.updateComplete;
      expect(modal(el, "remove-selected").getAttribute("heading")).toBe("¿Quitar 1 elemento?");
    });

    it("names an item holding a replacement pattern and the list's placeholder as written", async () => {
      const client = api({
        listLibraryProducts: vi
          .fn()
          .mockResolvedValue(
            products.map((item) =>
              item.id === "p-burger" ? { ...item, name: "Burger $& {list}" } : item,
            ),
          ),
      });
      const el = await mountLunch(client);
      await pressSelect(el);
      await tick(el, "m-burger");
      await tick(el, "m-drinks");
      await openRemove(el);
      expect(
        [
          ...modal(el, "remove-selected").querySelectorAll(
            '[data-test="remove-selected-items"] li',
          ),
        ].map(text),
      ).toEqual(["Burger $& {list}, from Lunch Menu", "Drinks, from Lunch Menu"]);
    });

    it("names an included menu holding a replacement pattern as written", async () => {
      const el = await mountLunch(
        includeClient({
          getMenuStructure: vi
            .fn()
            .mockResolvedValue(
              lunchWith([...lunchNodes(), { ...wines(), internalName: "Wines $&" }]),
            ),
        }),
      );
      await pressSelect(el);
      await tick(el, "included-wine");
      await tick(el, "m-drinks");
      await openRemove(el);
      expect(
        [
          ...modal(el, "remove-selected").querySelectorAll(
            '[data-test="remove-selected-items"] li',
          ),
        ].map(text),
      ).toEqual(["Menu: Wines $&, from Lunch Menu", "Drinks, from Lunch Menu"]);
    });

    it("asks in Spanish how many items to remove", async () => {
      setLocale("es");
      const el = await mountLunch();
      await toggleRow(el, "m-drinks");
      await pressSelect(el);
      await tick(el, "m-burger");
      await tick(el, "m-drinks");
      await openRemove(el);
      expect(modal(el, "remove-selected").getAttribute("heading")).toBe("¿Quitar 2 elementos?");
    });

    it("leaves the mode by Done, clearing the selection and handing focus back to Select", async () => {
      const el = await mountLunch();
      await pressSelect(el);
      await tick(el, "m-burger");
      const done = q(el, '[data-test="selection-done"]')!;
      expect(text(done)).toBe("Done");
      done.focus();
      await userEvent.keyboard("{Enter}");
      await settleStructure(el);
      expect(bar(el)).toBeNull();
      expect(structure(el).selecting).toBe(false);
      expect(structure(el).selected).toEqual([]);
      expect(selectToggle(el).getAttribute("aria-pressed")).toBe("false");
      expect(el.shadowRoot!.activeElement).toBe(modeHost(el));
      expect(modeHost(el).shadowRoot!.activeElement).toBe(selectToggle(el));
      await pressSelect(el);
      expect(rowBoxes(el).filter((box) => box.checked)).toEqual([]);
    });

    function a461Section(
      memberId: string,
      sectionId: string,
      name: string,
      children: MenuStructureNode[],
    ): MenuStructureNode {
      return {
        memberId,
        ref: { kind: "section", sectionId },
        internalName: name,
        names: {},
        image: null,
        color: null,
        ownerMenuId: "menu-lunch",
        children,
      };
    }
    const a461Nodes = () => [
      a461Section("m-coffee", "s-coffee", "Coffee", [productNode("m-iced", "iced")]),
      a461Section("m-desserts", "s-desserts", "Desserts", [productNode("m-cake", "cake")]),
      a461Section("m-storage", "s-storage", "Storage", []),
    ];
    async function a461Gather(client: Api) {
      client.getMenuStructure.mockResolvedValue(lunchWith(a461Nodes()));
      client.listLibraryProducts.mockResolvedValue([
        product("iced", "Iced coffee"),
        product("cake", "Coffee cake"),
      ]);
      const el = await mountLunch(client);
      await pressSelect(el);
      type(q(el, 'wt-input[name="structure-search"]')!, "Iced");
      await settleStructure(el);
      await tick(el, "m-coffee/m-iced");
      type(q(el, 'wt-input[name="structure-search"]')!, "cake");
      await settleStructure(el);
      await tick(el, "m-desserts/m-cake");
      expect(allInStructure(el, '[part~="drag-grip"]').length).toBeGreaterThan(0);
      type(q(el, 'wt-input[name="structure-search"]')!, "");
      await settleStructure(el);
      structure(el).shadowRoot!.querySelector("wt-data-table")!.setExpanded("m-desserts", true);
      await settleStructure(el);
      expect(rowOf(el, "m-coffee/m-iced")).toBeNull();
      return el;
    }
    async function a461PointerDrop(
      el: MenusScreen,
      key = "m-desserts/m-cake",
      target = "m-storage",
    ) {
      const from = inStructure<HTMLButtonElement>(el, `[data-test="drag-${CSS.escape(key)}"]`);
      expect(from).not.toBeNull();
      const to = rowOf(el, target)!.querySelector<HTMLElement>('[data-test="name"]')!;
      await userEvent.dragAndDrop(from!, to);
    }
    it("A461 Structure drag sends visible ticks and leaves hidden ticks selected", async () => {
      const client = api();
      const viewport = [window.innerWidth, window.innerHeight] as const;
      await page.viewport(1280, 844);
      onTestFinished(() => page.viewport(...viewport));
      const el = await a461Gather(client);
      const drops: unknown[] = [];
      structure(el).addEventListener("wt-members-drop", (event) =>
        drops.push((event as CustomEvent).detail),
      );
      await a461PointerDrop(el);
      expect(drops).toEqual([{ keys: ["m-desserts/m-cake"], to: ["m-storage"] }]);
      await vi.waitFor(() =>
        expect(membersAt(el, "m-storage").map(({ memberId }) => memberId)).toEqual(["m-cake"]),
      );
      expect(membersAt(el, "m-desserts")).toEqual([]);
      expect(client.moveSectionMembersInto).not.toHaveBeenCalled();
      expect(client.moveSectionMember).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(structure(el).selected).toEqual(["m-coffee/m-iced"]));
    });
    it("A461 search drag ignores a hidden selected parent before grouping the visible child", async () => {
      const client = api();
      client.getMenuStructure.mockResolvedValue(
        lunchWith([
          ...a461Nodes().slice(0, 2),
          a461Section("m-storage", "s-storage", "Iced storage", []),
        ]),
      );
      client.listLibraryProducts.mockResolvedValue([
        product("iced", "Iced coffee"),
        product("cake", "Coffee cake"),
      ]);
      const viewport = [window.innerWidth, window.innerHeight] as const;
      await page.viewport(1280, 844);
      onTestFinished(() => page.viewport(...viewport));
      const el = await mountLunch(client);
      await pressSelect(el);
      type(q(el, 'wt-input[name="structure-search"]')!, "coffee");
      await settleStructure(el);
      await tick(el, "m-coffee");
      type(q(el, 'wt-input[name="structure-search"]')!, "iced");
      await settleStructure(el);
      await tick(el, "m-coffee/m-iced");
      expect(rowOf(el, "m-coffee")).toBeNull();
      await a461PointerDrop(el, "m-coffee/m-iced");
      await vi.waitFor(() =>
        expect(membersAt(el, "m-storage").map(({ memberId }) => memberId)).toEqual(["m-iced"]),
      );
      expect(membersAt(el, "m-coffee")).toEqual([]);
      expect(client.moveSectionMembersInto).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(structure(el).selected).toEqual(["m-coffee"]));
    });

    it("A461 batch drop clears ticks carried within a selected section", async () => {
      const client = api();
      client.getMenuStructure.mockResolvedValue(
        lunchWith([...lunchNodes(), a461Section("m-storage", "s-storage", "Storage", [])]),
      );
      const el = await mountLunch(client);
      await pressSelect(el);
      emit(structure(el), "wt-selection-change", {
        selected: ["m-drinks", "m-drinks/m-lager", "m-fav/m-fav-drinks/m-lager"],
      });
      await settleStructure(el);
      emit(structure(el), "wt-members-drop", { keys: ["m-drinks"], to: ["m-storage"] });
      await vi.waitFor(() =>
        expect(membersAt(el, "m-storage").map(({ memberId }) => memberId)).toEqual(["m-drinks"]),
      );
      await vi.waitFor(() => expect(structure(el).busy).toBe(false));
      expect(structure(el).selected).toEqual([]);
    });
    it("A461 batch drop moves a repeated placement once", async () => {
      const client = api();
      client.getMenuStructure.mockResolvedValue(
        lunchWith([...lunchNodes(), a461Section("m-storage", "s-storage", "Storage", [])]),
      );
      const el = await mountLunch(client);
      await pressSelect(el);
      emit(structure(el), "wt-members-drop", {
        keys: ["m-drinks/m-lager", "m-fav/m-fav-drinks/m-lager"],
        to: ["m-storage"],
      });
      await vi.waitFor(() =>
        expect(membersAt(el, "m-storage").map(({ memberId }) => memberId)).toEqual(["m-lager"]),
      );
      expect(membersAt(el, "m-drinks").map(({ memberId }) => memberId)).toEqual([
        "m-beer",
        "m-lemonade",
      ]);
      expect(writeCalls(client)).toEqual([]);
    });

    it("A461 batch drop canonicalizes repeated placements and carried descendants", async () => {
      const client = api();
      client.getMenuStructure.mockResolvedValue(
        lunchWith([...lunchNodes(), a461Section("m-storage", "s-storage", "Storage", [])]),
      );
      const el = await mountLunch(client);
      await pressSelect(el);
      emit(structure(el), "wt-members-drop", {
        keys: ["m-drinks/m-lager", "m-fav/m-fav-drinks/m-lager", "m-drinks"],
        to: ["m-storage"],
      });
      await vi.waitFor(() =>
        expect(membersAt(el, "m-storage").map(({ memberId }) => memberId)).toEqual(["m-drinks"]),
      );
      expect(membersAt(el, "m-storage/m-drinks").map(({ memberId }) => memberId)).toEqual([
        "m-lager",
        "m-beer",
        "m-lemonade",
      ]);
      expect(writeCalls(client)).toEqual([]);
    });

    it("A461 keeps the selection when the search changes and when a filter changes", async () => {
      const el = await mountLunch();
      await pressSelect(el);
      await tick(el, "m-burger");
      emit(q(el, 'wt-input[name="structure-search"]')!, "wt-change", { value: "Burger" });
      await settleStructure(el);
      expect(structure(el).selected).toEqual(["m-burger"]);
      expect(text(q(el, '[data-test="selected-count"]'))).toBe("1 selected");

      emit(q(el, 'wt-input[name="structure-search"]')!, "wt-change", { value: "" });
      await settleStructure(el);
      expect(structure(el).selected).toEqual(["m-burger"]);
      await chooseOption(inStructure(el, 'wt-combobox[data-filter="available"]')!, "yes");
      await settleStructure(el);
      expect(structure(el).selected).toEqual(["m-burger"]);
      expect(structure(el).selecting).toBe(true);
    });

    it("A461 gathers a hidden section and item across searches and filters", async () => {
      const client = api({}, [
        ...lunchNodes(),
        a461Section("m-storage", "s-storage", "Storage", []),
      ]);
      const el = await mountLunch(client);
      type(q(el, 'wt-input[name="structure-search"]')!, "Drinks");
      await settleStructure(el);
      await pressSelect(el);
      await tick(el, "m-drinks");
      type(q(el, 'wt-input[name="structure-search"]')!, "Burger");
      await settleStructure(el);
      await tick(el, "m-burger");
      expect(structure(el).selected).toEqual(["m-drinks", "m-burger"]);
      await chooseOption(inStructure(el, 'wt-combobox[data-filter="available"]')!, "yes");
      await settleStructure(el);
      expect(structure(el).selected).toEqual(["m-drinks", "m-burger"]);
      inStructure<HTMLInputElement>(el, '[data-test="select-all"]')!.click();
      await settleStructure(el);
      expect(structure(el).selected).toEqual(["m-drinks"]);
      inStructure<HTMLInputElement>(el, '[data-test="select-all"]')!.click();
      await settleStructure(el);
      expect(structure(el).selected).toEqual(["m-drinks", "m-burger"]);
      await chooseOption(inStructure(el, 'wt-combobox[data-filter="available"]')!, "");
      type(q(el, 'wt-input[name="structure-search"]')!, "");
      await settleStructure(el);
      expect(inStructure<HTMLInputElement>(el, '[data-test="select-m-drinks"]')!.checked).toBe(
        true,
      );
      expect(inStructure<HTMLInputElement>(el, '[data-test="select-m-burger"]')!.checked).toBe(
        true,
      );
      q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="selection-move"]')!.click();
      await vi.waitFor(() => expect(modal(el, "move-selected").open).toBe(true));
      expect(modal(el, "move-selected").getAttribute("heading")).toBe("Move 2 items");
      await chooseOption(
        inModal(el, "move-selected", 'wt-combobox[name="destination"]'),
        "s-storage",
      );
      inModal(el, "move-selected", '[data-test="move-selected-save"]').click();
      await vi.waitFor(() =>
        expect(membersAt(el, "m-storage").map(({ memberId }) => memberId)).toEqual([
          "m-burger",
          "m-drinks",
        ]),
      );
      expect(writeCalls(client)).toEqual([]);
    });

    it("turns the mode off when another menu is opened", async () => {
      const el = await mountLunch();
      await pressSelect(el);
      await tick(el, "m-burger");
      await visit(el, DINNER_PATH, "Dinner Menu");
      await settleStructure(el);
      expect(structure(el).selecting).toBe(false);
      expect(structure(el).selected).toEqual([]);
      expect(bar(el)).toBeNull();
    });

    it("drops a selected row a row action removes while keeping the other selected row", async () => {
      const client = api();
      const el = await mountLunch(client);
      await pressSelect(el);
      await tick(el, "m-burger");
      await tick(el, "m-fav");
      await rowAction(el, "m-burger", "remove");
      await vi.waitFor(() => expect(rowOf(el, "m-burger")).toBeNull());
      await settleStructure(el);
      expect(structure(el).selected).toEqual(["m-fav"]);
      expect(text(q(el, '[data-test="selected-count"]'))).toBe("1 selected");
    });

    it("turns Select off and puts focus on the empty box's first add when a bulk remove empties the menu", async () => {
      const client = api({
        getMenuStructure: vi.fn(async () => lunchWith([productNode("m-burger", "p-burger")])),
      });
      const el = await mountLunch(client);
      await vi.waitFor(() => expect(rowOf(el, "m-burger")).not.toBeNull());
      await pressSelect(el);
      await tick(el, "m-burger");
      removeButton(el).click();
      await vi.waitFor(() =>
        expect(
          structure(el).shadowRoot!.querySelector('[data-test="new-section-empty"]'),
        ).not.toBeNull(),
      );
      await settleStructure(el);
      expect(structure(el).selecting).toBe(false);
      expect(bar(el)).toBeNull();
      expect(selectToggle(el).getAttribute("aria-pressed")).toBe("false");
      expect(structure(el).shadowRoot!.activeElement?.getAttribute("data-test")).toBe(
        "new-section-empty",
      );
    });

    /** Lemonade's place in Drinks is shown twice: at the top level and inside Favourites. */
    async function tickLemonadeInBothPlaces(el: MenusScreen): Promise<void> {
      await toggleRow(el, "m-drinks");
      await toggleRow(el, "m-fav");
      await toggleRow(el, "m-fav/m-fav-drinks");
      await pressSelect(el);
      await tick(el, "m-drinks/m-lemonade");
      expect(
        inStructure<HTMLInputElement>(el, '[data-test="select-m-fav/m-fav-drinks/m-lemonade"]')!
          .checked,
      ).toBe(true);
    }

    it("removes a member shown in two places once, counting one tick in the bar", async () => {
      const client = api();
      const el = await mountLunch(client);
      await tickLemonadeInBothPlaces(el);
      expect(text(q(el, '[data-test="selected-count"]'))).toBe("1 selected");
      removeButton(el).click();
      await vi.waitFor(() => expect(rowOf(el, "m-drinks/m-lemonade")).toBeNull());
      expect(rowOf(el, "m-fav/m-fav-drinks/m-lemonade")).toBeNull();
      expect(modal(el, "remove-selected").open).toBe(false);
      expect(writeCalls(client)).toEqual([]);
    });

    it("moves a member ticked in two places once", async () => {
      const client = api();
      const el = await mountLunch(client);
      await tickLemonadeInBothPlaces(el);
      q(el, '[data-test="selection-move"]')!.click();
      await vi.waitFor(() => expect(modal(el, "move-selected").open).toBe(true));
      await el.updateComplete;
      expect(modal(el, "move-selected").getAttribute("heading")).toBe("Move 1 item");
      await chooseOption(
        inModal<HTMLElementTagNameMap["wt-combobox"]>(
          el,
          "move-selected",
          'wt-combobox[name="destination"]',
        ),
        "root-lunch",
      );
      await el.updateComplete;
      inModal(el, "move-selected", '[data-test="move-selected-save"]').click();
      await vi.waitFor(() =>
        expect(topLevelKeys(el)).toEqual(["m-burger", "m-drinks", "m-fav", "m-lemonade"]),
      );
      expect(membersAt(el, "m-drinks").map(({ memberId }) => memberId)).toEqual([
        "m-lager",
        "m-beer",
      ]);
      expect(writeCalls(client)).toEqual([]);
    });

    it("moves selected rows inside their selected section, wherever it is shown", async () => {
      const client = api({}, [
        ...lunchNodes(),
        a461Section("m-storage", "s-storage", "Storage", []),
      ]);
      const el = await mountLunch(client);
      await toggleRow(el, "m-fav");
      await toggleRow(el, "m-fav/m-fav-drinks");
      await pressSelect(el);
      await tick(el, "m-drinks");
      await tick(el, "m-fav/m-fav-drinks/m-lemonade");
      q(el, '[data-test="selection-move"]')!.click();
      await vi.waitFor(() => expect(modal(el, "move-selected").open).toBe(true));
      await el.updateComplete;
      expect(modal(el, "move-selected").getAttribute("heading")).toBe("Move 1 item");
      const destination = inModal<HTMLElementTagNameMap["wt-combobox"]>(
        el,
        "move-selected",
        'wt-combobox[name="destination"]',
      );
      await chooseOption(destination, "s-storage");
      await el.updateComplete;
      inModal(el, "move-selected", '[data-test="move-selected-save"]').click();
      await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-burger", "m-fav", "m-storage"]));
      expect(membersAt(el, "m-storage/m-drinks").map(({ memberId }) => memberId)).toEqual([
        "m-lager",
        "m-beer",
        "m-lemonade",
      ]);
      expect(writeCalls(client)).toEqual([]);
    });

    it("ticks only the matching rows when everything is selected during a search, and moves only those", async () => {
      const nodes = lunchNodes();
      nodes[2]!.children![0] = productNode("m-fav-lemonade", "p-frozen-lemonade");
      const client = api(
        {
          listLibraryProducts: vi.fn(async () => [
            ...products,
            product("p-frozen-lemonade", "Frozen Lemonade"),
          ]),
        },
        nodes,
      );
      const el = await mountLunch(client);
      emit(q(el, 'wt-input[name="structure-search"]')!, "wt-change", { value: "Lemonade" });
      await settleStructure(el);
      await pressSelect(el);
      inStructure(el, '[data-test="select-all"]')!.click();
      await settleStructure(el);
      expect(structure(el).selected).toEqual(["m-drinks/m-lemonade", "m-fav/m-fav-lemonade"]);
      expect(text(q(el, '[data-test="selected-count"]'))).toBe("2 selected");
      q(el, '[data-test="selection-move"]')!.click();
      await vi.waitFor(() => expect(modal(el, "move-selected").open).toBe(true));
      await el.updateComplete;
      expect(modal(el, "move-selected").getAttribute("heading")).toBe("Move 2 items");
      await chooseOption(
        inModal<HTMLElementTagNameMap["wt-combobox"]>(
          el,
          "move-selected",
          'wt-combobox[name="destination"]',
        ),
        "root-lunch",
      );
      await el.updateComplete;
      inModal(el, "move-selected", '[data-test="move-selected-save"]').click();
      type(q(el, 'wt-input[name="structure-search"]')!, "");
      await vi.waitFor(() =>
        expect(topLevelKeys(el)).toEqual([
          "m-burger",
          "m-drinks",
          "m-fav",
          "m-lemonade",
          "m-fav-lemonade",
        ]),
      );
      expect(writeCalls(client)).toEqual([]);
    });

    it("removes the rows ticked during a search, and only those", async () => {
      const client = api();
      const el = await mountLunch(client);
      emit(q(el, 'wt-input[name="structure-search"]')!, "wt-change", { value: "Lemonade" });
      await settleStructure(el);
      await pressSelect(el);
      await tick(el, "m-drinks/m-lemonade");
      await tick(el, "m-fav/m-fav-lemonade");
      removeButton(el).click();
      await vi.waitFor(() =>
        expect(membersAt(el, "m-drinks").map(({ memberId }) => memberId)).toEqual([
          "m-lager",
          "m-beer",
        ]),
      );
      expect(membersAt(el, "m-fav").map(({ memberId }) => memberId)).toEqual(["m-fav-drinks"]);
      expect(membersAt(el, "").map(({ memberId }) => memberId)).toEqual([
        "m-burger",
        "m-drinks",
        "m-fav",
      ]);
      expect(modal(el, "remove-selected").open).toBe(false);
      expect(writeCalls(client)).toEqual([]);
    });

    it("A461 loses hidden included children from ticks and an open Remove snapshot", async () => {
      const live = new LiveData();
      const client = api({ liveData: live });
      client.getMenuStructure.mockImplementation(async (id: string) =>
        id === "other-menu"
          ? lunchWith(drinksNode("other-drinks").children!)
          : lunchWith(lunchNodes()),
      );
      const el = await mountLunch(client);
      await toggleRow(el, "m-drinks");
      await pressSelect(el);
      await tick(el, "m-fav");
      await tick(el, "m-burger");
      await tick(el, "m-drinks/m-lemonade");
      type(q(el, 'wt-input[name="structure-search"]')!, "Burger");
      await settleStructure(el);
      await openRemove(el);
      const nodes = lunchNodes();
      nodes[1] = { ...nodes[1]!, includedMenuId: "other-menu" };
      nodes[2] = {
        ...nodes[2]!,
        children: nodes[2]!.children!.map((node) =>
          node.memberId === "m-fav-drinks" ? { ...node, includedMenuId: "other-menu" } : node,
        ),
      };
      client.getMenuStructure.mockImplementation(async (id: string) =>
        id === "other-menu" ? lunchWith(drinksNode("other-drinks").children!) : lunchWith(nodes),
      );
      live.invalidate([{ type: "section_members" }]);
      await vi.waitFor(() =>
        expect(modal(el, "remove-selected").getAttribute("heading")).toBe("Remove 2 items?"),
      );
      expect(structure(el).selected).toEqual(["m-fav", "m-burger"]);
      type(q(el, 'wt-input[name="structure-search"]')!, "Lemonade");
      await settleStructure(el);
      expect(rowOf(el, "m-drinks/m-lemonade")).not.toBeNull();
      expect(inStructure(el, '[data-test="select-m-drinks/m-lemonade"]')).toBeNull();
      inModal(el, "remove-selected", '[data-test="remove-selected-save"]').click();
      await vi.waitFor(() =>
        expect(membersAt(el, "").map(({ memberId }) => memberId)).toEqual(["m-drinks"]),
      );
      expect(membersAt(el, "m-drinks").map(({ memberId }) => memberId)).toContain("m-lemonade");
      expect(writeCalls(client)).toEqual([]);
    });

    it("A461 keeps the member tick and Remove snapshot when one repeated path is removed live", async () => {
      const live = new LiveData();
      const client = api({ liveData: live });
      const el = await mountLunch(client);
      type(q(el, 'wt-input[name="structure-search"]')!, "Lager");
      await settleStructure(el);
      await pressSelect(el);
      await tick(el, "m-drinks/m-lager");
      type(q(el, 'wt-input[name="structure-search"]')!, "Beer");
      await settleStructure(el);
      await tick(el, "m-drinks/m-beer");
      await openRemove(el);
      type(q(el, 'wt-input[name="structure-search"]')!, "Lager");
      await settleStructure(el);
      const nodes = lunchNodes().filter((node) => node.memberId !== "m-drinks");
      client.getMenuStructure.mockResolvedValue(lunchWith(nodes));
      live.invalidate([{ type: "section_members" }]);
      await vi.waitFor(() => expect(rowOf(el, "m-drinks/m-lager")).toBeNull());
      await settleStructure(el);
      expect(structure(el).selected).toEqual([
        "m-fav/m-fav-drinks/m-lager",
        "m-fav/m-fav-drinks/m-beer",
      ]);
      expect(
        (inStructure(el, '[data-test="select-m-fav/m-fav-drinks/m-lager"]') as HTMLInputElement)
          .checked,
      ).toBe(true);
      expect(modal(el, "remove-selected").open).toBe(true);
      inModal(el, "remove-selected", '[data-test="remove-selected-save"]').click();
      await vi.waitFor(() =>
        expect(membersAt(el, "m-fav/m-fav-drinks").map(({ memberId }) => memberId)).toEqual([
          "m-lemonade",
        ]),
      );
      expect(writeCalls(client)).toEqual([]);
    });

    it("trims the open Remove confirm when a live update takes a row away, and closes it once none is left", async () => {
      const live = new LiveData();
      const client = api({ liveData: live });
      const el = await mountLunch(client);
      await toggleRow(el, "m-fav");
      await pressSelect(el);
      await tick(el, "m-burger");
      await tick(el, "m-fav");
      await openRemove(el);
      expect(modal(el, "remove-selected").getAttribute("heading")).toBe("Remove 2 items?");

      const [, drinks, favourites] = lunchNodes();
      client.getMenuStructure.mockResolvedValue(lunchWith([drinks!, favourites!]));
      live.invalidate([{ type: "section_members" }]);
      await vi.waitFor(() =>
        expect(modal(el, "remove-selected").getAttribute("heading")).toBe("Remove 1 item?"),
      );
      expect(
        [
          ...modal(el, "remove-selected").querySelectorAll(
            '[data-test="remove-selected-items"] li',
          ),
        ].map(text),
      ).toEqual(["Favourites, from Lunch Menu"]);

      client.getMenuStructure.mockResolvedValue(lunchWith([drinks!]));
      live.invalidate([{ type: "section_members" }]);
      await vi.waitFor(() => expect(modal(el, "remove-selected").open).toBe(false));
      expect(client.removeSectionMembers).not.toHaveBeenCalled();
    });

    it("clears the chosen Move destination when a live update takes it away, and closes the dialog once nothing is left to move", async () => {
      const live = new LiveData();
      const client = api({ liveData: live });
      const el = await mountLunch(client);
      await pressSelect(el);
      await tick(el, "m-burger");
      q(el, '[data-test="selection-move"]')!.click();
      await vi.waitFor(() => expect(modal(el, "move-selected").open).toBe(true));
      await el.updateComplete;
      const destination = () =>
        inModal<HTMLElementTagNameMap["wt-combobox"]>(
          el,
          "move-selected",
          'wt-combobox[name="destination"]',
        );
      const save = () =>
        inModal<HTMLElementTagNameMap["wt-button"]>(
          el,
          "move-selected",
          '[data-test="move-selected-save"]',
        );
      await chooseOption(destination(), "s-fav");
      await el.updateComplete;
      expect(save().disabled).toBe(false);

      const [burger, drinks] = lunchNodes();
      client.getMenuStructure.mockResolvedValue(lunchWith([burger!, drinks!]));
      live.invalidate([{ type: "section_members" }]);
      await vi.waitFor(() => expect(destination().value).toBe(""));
      await el.updateComplete;
      expect(modal(el, "move-selected").open).toBe(true);
      expect(save().disabled).toBe(true);
      expect(save().variant).toBe("secondary");

      client.getMenuStructure.mockResolvedValue(lunchWith([drinks!]));
      live.invalidate([{ type: "section_members" }]);
      await vi.waitFor(() => expect(modal(el, "move-selected").open).toBe(false));
      expect(client.moveSectionMembersInto).not.toHaveBeenCalled();
    });

    it("A461 keeps a selected section a live rename hides from search in Move", async () => {
      const live = new LiveData();
      const client = api({ liveData: live });
      const el = await mountLunch(client);
      type(q(el, 'wt-input[name="structure-search"]')!, "Drinks");
      await settleStructure(el);
      await pressSelect(el);
      await tick(el, "m-drinks");
      expect(structure(el).selected).toEqual(["m-drinks"]);
      q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="selection-move"]')!.click();
      await vi.waitFor(() => expect(modal(el, "move-selected").open).toBe(true));

      const nodes = lunchNodes();
      const rename = (items: MenuStructureNode[]) => {
        for (const node of items) {
          if (node.ref.kind === "section" && node.ref.sectionId === "s-drinks")
            node.internalName = "Beverages";
          rename(node.children ?? []);
        }
      };
      rename(nodes);
      client.getMenuStructure.mockResolvedValue(lunchWith(nodes));
      live.invalidate([{ type: "sections" }]);
      await vi.waitFor(() => expect(structure(el).nodes[1]!.internalName).toBe("Beverages"));
      await settleStructure(el);
      expect(rowOf(el, "m-drinks")).toBeNull();
      expect(structure(el).selected).toEqual(["m-drinks"]);
      expect(text(q(el, '[data-test="selected-count"]'))).toBe("1 selected");
      const move = q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="selection-move"]')!;
      expect(move.disabled).toBe(false);
      await el.updateComplete;
      expect(modal(el, "move-selected").open).toBe(true);
      expect(client.moveSectionMembersInto).not.toHaveBeenCalled();
    });

    it("A461 keeps a selected product hidden by live availability in the open Remove confirm", async () => {
      const live = new LiveData();
      const client = api({ liveData: live });
      const el = await mountLunch(client);
      await toggleRow(el, "m-drinks");
      await pressSelect(el);
      await tick(el, "m-burger");
      await tick(el, "m-drinks/m-lemonade");
      await tick(el, "m-drinks/m-beer");
      await chooseOption(inStructure(el, 'wt-combobox[data-filter="available"]')!, "yes");
      await settleStructure(el);
      await openRemove(el);
      expect(modal(el, "remove-selected").getAttribute("heading")).toBe("Remove 3 items?");

      client.listLibraryProducts.mockResolvedValue(
        products.map((each) => (each.id === "p-burger" ? { ...each, available: false } : each)),
      );
      live.invalidate([{ type: "products" }]);
      await vi.waitFor(() => expect(rowOf(el, "m-burger")).toBeNull());
      await settleStructure(el);
      expect(modal(el, "remove-selected").getAttribute("heading")).toBe("Remove 3 items?");
      expect(rowOf(el, "m-burger")).toBeNull();
      expect(structure(el).selected).toEqual([
        "m-burger",
        "m-drinks/m-lemonade",
        "m-drinks/m-beer",
      ]);
      inModal(el, "remove-selected", '[data-test="remove-selected-save"]').click();
      await vi.waitFor(() =>
        expect(membersAt(el, "").map(({ memberId }) => memberId)).toEqual(["m-drinks", "m-fav"]),
      );
      expect(membersAt(el, "m-drinks").map(({ memberId }) => memberId)).toEqual(["m-lager"]);
      expect(writeCalls(client)).toEqual([]);
    });

    it("keeps a selected row inside a section the person closed when a live update arrives", async () => {
      const live = new LiveData();
      const client = api({ liveData: live });
      const el = await mountLunch(client);
      await toggleRow(el, "m-drinks");
      await pressSelect(el);
      await tick(el, "m-drinks/m-lemonade");
      await toggleRow(el, "m-drinks");
      expect(rowOf(el, "m-drinks/m-lemonade")).toBeNull();

      const nodes = lunchNodes();
      nodes[2]!.internalName = "Picks";
      client.getMenuStructure.mockResolvedValue(lunchWith(nodes));
      live.invalidate([{ type: "sections" }]);
      await vi.waitFor(() => expect(structure(el).nodes[2]!.internalName).toBe("Picks"));
      await settleStructure(el);
      expect(structure(el).selected).toEqual(["m-drinks/m-lemonade"]);
      expect(text(q(el, '[data-test="selected-count"]'))).toBe("1 selected");
    });

    it("clears the search when the menu empties", async () => {
      let removed = false;
      const client = api({
        getMenuStructure: vi.fn(async () =>
          lunchWith(removed ? [] : [productNode("m-burger", "p-burger")]),
        ),
        removeSectionMember: vi.fn(async () => {
          removed = true;
        }),
      });
      const el = await mountLunch(client);
      await vi.waitFor(() => expect(rowOf(el, "m-burger")).not.toBeNull());
      emit(q(el, 'wt-input[name="structure-search"]')!, "wt-change", { value: "Burger" });
      await settleStructure(el);
      await rowAction(el, "m-burger", "remove");
      await vi.waitFor(() =>
        expect(
          structure(el).shadowRoot!.querySelector('[data-test="new-section-empty"]'),
        ).not.toBeNull(),
      );
      await settleStructure(el);
      expect(structure(el).search).toBe("");
      expect(
        q<HTMLElementTagNameMap["wt-input"]>(el, 'wt-input[name="structure-search"]')!.value,
      ).toBe("");
    });

    describe("Move to section", () => {
      const moveButton = (el: MenusScreen) =>
        q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="selection-move"]')!;
      const destination = (el: MenusScreen) =>
        inModal<HTMLElementTagNameMap["wt-combobox"]>(
          el,
          "move-selected",
          'wt-combobox[name="destination"]',
        );
      const confirm = (el: MenusScreen) =>
        inModal<HTMLElementTagNameMap["wt-button"]>(
          el,
          "move-selected",
          '[data-test="move-selected-save"]',
        );
      const cancel = (el: MenusScreen) =>
        inModal<HTMLElementTagNameMap["wt-button"]>(
          el,
          "move-selected",
          '[data-test="move-selected-cancel"]',
        );
      const labels = (el: MenusScreen) => destination(el).options.map(({ label }) => label);

      async function openMove(el: MenusScreen): Promise<void> {
        moveButton(el).click();
        await vi.waitFor(() => expect(modal(el, "move-selected").open).toBe(true));
        await el.updateComplete;
      }

      it("keeps both placements and the selection when Move would create a duplicate", async () => {
        const client = api();
        const el = await mountLunch(client);
        await editDrinks(el);
        await toggleRow(el, "m-drinks/m-beer");
        await pressSelect(el);
        await tick(el, "m-drinks/m-lager");
        await openMove(el);
        await chooseOption(destination(el), "s-beer");
        confirm(el).click();
        await vi.waitFor(() =>
          expect(modal(el, "move-selected").querySelector("wt-form-actions")!.error).toBe(
            codeMessage("menu_section.member_duplicate"),
          ),
        );
        expect(modal(el, "move-selected").open).toBe(true);
        expect(structure(el).selected).toEqual(["m-drinks/m-lager"]);
        expect(childKeys(el, "m-drinks")).toContain("m-drinks/m-lager");
        expect(childKeys(el, "m-drinks/m-beer")).toEqual(["m-drinks/m-beer/m-lager-2"]);
        expect(writeCalls(client)).toEqual([]);
      });

      it("sits before Remove, disabled until something is selected and secondary throughout", async () => {
        const el = await mountLunch();
        await pressSelect(el);
        expect(moveButton(el).nextElementSibling).toBe(removeButton(el));
        expect(text(moveButton(el).querySelector(".selection-move-full"))).toBe("Move to section…");
        expect(moveButton(el).disabled).toBe(true);
        expect(moveButton(el).variant).toBe("secondary");
        moveButton(el).click();
        await el.updateComplete;
        expect(modal(el, "move-selected").open).toBe(false);
        await tick(el, "m-drinks");
        expect(moveButton(el).disabled).toBe(false);
        expect(moveButton(el).variant).toBe("secondary");
      });

      it("stages a move from two lists, in tree order, then opens the destination", async () => {
        const client = api();
        const el = await mountLunch(client);
        await toggleRow(el, "m-drinks");
        await toggleRow(el, "m-drinks/m-beer");
        await pressSelect(el);
        await tick(el, "m-drinks/m-beer/m-lager-2");
        await tick(el, "m-burger");
        await openMove(el);
        const dialog = modal(el, "move-selected");
        expect(dialog.getAttribute("size")).toBe("compact");
        expect(dialog.getAttribute("heading")).toBe("Move 2 items");
        expect(destination(el).required).toBe(true);
        expect(labels(el)).toEqual(["Top level", "Drinks", "Drinks › Beer", "Favourites"]);
        expect(destination(el).options[0]!.value).toBe("root-lunch");
        await chooseOption(destination(el), "s-fav");
        await el.updateComplete;
        expect(text(confirm(el))).toBe("Move");
        confirm(el).click();
        await vi.waitFor(() => expect(modal(el, "move-selected").open).toBe(false));
        expect(membersAt(el, "m-fav").map(({ memberId }) => memberId)).toEqual([
          "m-fav-lemonade",
          "m-fav-drinks",
          "m-burger",
          "m-lager-2",
        ]);
        expect(membersAt(el, "m-drinks/m-beer")).toEqual([]);
        expect(writeCalls(client)).toEqual([]);
        expect(client.getMenuStructure).toHaveBeenCalledOnce();
        await afterDialogCloses(el);
        await settleStructure(el);
        expect(structure(el).current).toEqual(["m-fav"]);
        await vi.waitFor(() => expect(rowOf(el, "m-fav/m-burger")).not.toBeNull());
        expect(structure(el).selected).toEqual([]);
        expect(selectToggle(el).getAttribute("aria-pressed")).toBe("true");
        expect(el.shadowRoot!.activeElement).toBe(modeHost(el));
        expect(modeHost(el).shadowRoot!.activeElement).toBe(selectToggle(el));
      });

      it("moves a selected section with its selected child still inside", async () => {
        const client = api();
        const el = await mountLunch(client);
        await toggleRow(el, "m-drinks");
        await pressSelect(el);
        await tick(el, "m-drinks/m-beer");
        await toggleRow(el, "m-drinks/m-beer");
        await tick(el, "m-drinks/m-beer/m-lager-2");
        expect(text(q(el, '[data-test="selected-count"]'))).toBe("2 selected");
        await openMove(el);
        expect(modal(el, "move-selected").getAttribute("heading")).toBe("Move 1 item");
        await chooseOption(destination(el), "s-fav");
        await el.updateComplete;
        confirm(el).click();
        expect(writeCalls(client)).toEqual([]);
        await vi.waitFor(() => expect(modal(el, "move-selected").open).toBe(false));
        await vi.waitFor(() =>
          expect(
            structure(el)
              .nodes.find((node) => node.memberId === "m-fav")!
              .children!.find((node) => node.memberId === "m-beer")!
              .children!.map((node) => node.memberId),
          ).toEqual(["m-lager-2"]),
        );
      });

      it("offers Top level and every section the menu owns, but no selected section or anything below it", async () => {
        const el = await mountLunch();
        await pressSelect(el);
        await tick(el, "m-drinks");
        await openMove(el);
        expect(labels(el)).toEqual(["Top level", "Favourites"]);
        cancel(el).click();
        await vi.waitFor(() => expect(modal(el, "move-selected").open).toBe(false));
        await tick(el, "m-drinks");
        await tick(el, "m-fav");
        await openMove(el);
        expect(labels(el)).toEqual(["Top level"]);
      });

      it("offers no section inside an included menu", async () => {
        const wines: MenuStructureNode = {
          memberId: "m-wines",
          ref: { kind: "section", sectionId: "wine-root" },
          internalName: "Wines",
          includedMenuId: "menu-wine",
          ownerMenuId: "menu-wine",
          folder: { showAsFolder: true, overrides: {} },
          children: [
            {
              memberId: "m-reds",
              ref: { kind: "section", sectionId: "s-reds" },
              internalName: "Reds",
              ownerMenuId: "menu-wine",
              children: [],
            },
          ],
        };
        const el = await mountLunch(
          api({ getMenuStructure: vi.fn(async () => lunchWith([...lunchNodes(), wines])) }),
        );
        await pressSelect(el);
        await tick(el, "m-burger");
        await openMove(el);
        expect(labels(el)).toEqual(["Top level", "Drinks", "Drinks › Beer", "Favourites"]);
      });

      it("keeps Move quiet and disabled until a destination is chosen", async () => {
        const client = api();
        const el = await mountLunch(client);
        await pressSelect(el);
        await tick(el, "m-burger");
        await openMove(el);
        expect(destination(el).value).toBe("");
        expect(confirm(el).disabled).toBe(true);
        expect(confirm(el).variant).toBe("secondary");
        await chooseOption(destination(el), "s-drinks");
        await el.updateComplete;
        expect(confirm(el).disabled).toBe(false);
        expect(confirm(el).variant).toBe("primary");
      });

      it.each([
        ["en", 1, "1 selected", "Move 1 item"],
        ["en", 2, "2 selected", "Move 2 items"],
        ["es", 1, "1 seleccionado", "Mover 1 elemento"],
        ["es", 2, "2 seleccionados", "Mover 2 elementos"],
      ] as const)(
        "renders the selected count and native move heading in %s for %i items",
        async (locale, count, selected, heading) => {
          setLocale(locale);
          const el = await mountLunch();
          await pressSelect(el);
          await tick(el, "m-burger");
          if (count === 2) await tick(el, "m-fav");
          expect(text(q(el, '[data-test="selected-count"]'))).toBe(selected);
          await openMove(el);
          const dialog = modal(el, "move-selected");
          await dialog.updateComplete;
          expect(text(dialog.shadowRoot!.querySelector("h2"))).toBe(heading);
        },
      );

      it("names the button, the dialog and Top level in Spanish", async () => {
        setLocale("es");
        const el = await mountLunch();
        await pressSelect(el);
        await tick(el, "m-burger");
        await tick(el, "m-fav");
        expect(text(moveButton(el).querySelector(".selection-move-full"))).toBe(
          "Mover a una sección…",
        );
        await openMove(el);
        expect(modal(el, "move-selected").getAttribute("heading")).toBe("Mover 2 elementos");
        expect(labels(el)[0]).toBe("Nivel principal");
        expect(text(confirm(el))).toBe("Mover");
      });
    });
  });

  describe("an included menu", () => {
    async function mountWithWines(overrides: ApiOverrides = {}) {
      const client = includeClient({
        getMenuStructure: vi.fn(async (id: string) =>
          id === "wine"
            ? {
                ...lunchWith(wines().children!),
                root: {
                  id: "wine-root",
                  internalName: "Wines",
                  names: {},
                  image: null,
                  color: null,
                  members: [],
                },
              }
            : lunchWith([...lunchNodes(), wines()]),
        ),
        ...overrides,
      });
      return { client, el: await mountLunch(client) };
    }

    it("opens for browsing, and offers Edit product while keeping its rows fixed", async () => {
      const { el } = await mountWithWines();
      await pressMode(el);
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
        const actions = rowOf(el, key)!.querySelector("wt-row-actions");
        if (key.endsWith("wine-red")) expect(actions).toBeNull();
        else
          expect([...actions!.querySelectorAll("a, wt-button")].map(text)).toEqual([
            t("product.edit"),
          ]);
        expect(rowOf(el, key)!.querySelector('[part~="drag-grip"]'), key).toBeNull();
      }
    });

    it("removes the inclusion from this menu alone, and links to the included menu's own Structure tab", async () => {
      const { client, el } = await mountWithWines();
      expect(inStructure(el, '[data-test="source-included-wine"]')!.getAttribute("href")).toBe(
        "/menus/menu/wine/view/structure",
      );
      await rowAction(el, "included-wine", "remove");
      await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-burger", "m-drinks", "m-fav"]));
      expect(writeCalls(client)).toEqual([]);
    });
  });

  /** The ⋮ that has focus in the tree's table, as its row's key; `""` for the root row's. */
  function focusedRowMenu(el: MenusScreen): string | undefined {
    const focused = structureRows(el).shadowRoot.activeElement;
    if (focused?.localName !== "wt-row-actions")
      return `not a row menu: ${focused?.localName ?? "nothing"}`;
    const key = focused.closest("tr")?.dataset.rowKey;
    return key === "root" ? "" : key;
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
      name: "Add section, cancelled",
      open: (el) => rowAction(el, "m-drinks", "new-section"),
      close: closeSectionForm,
      focused: "m-drinks",
    },
    {
      name: "Add section, staged",
      open: (el) => rowAction(el, "m-drinks", "new-section"),
      close: async (el) => {
        type(inModal(el, "new-section", 'wt-input[name="internalName"]'), "Ciders");
        await el.updateComplete;
        inModal(el, "new-section", '[data-test="new-section-save"]').click();
        await vi.waitFor(() => expect(modal(el, "new-section").open).toBe(false));
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
      name: "Add products, staged",
      open: (el) => rowAction(el, "m-fav", "open-add-products"),
      close: async (el) => {
        emit(inModal(el, "add-products", "dashboard-section-add-products"), "wt-add-products", {
          productIds: ["p-chips"],
        });
        await vi.waitFor(() => expect(modal(el, "add-products").open).toBe(false));
      },
      focused: "m-fav",
    },
    {
      name: "Add section at the top level, cancelled",
      open: (el) => rowAction(el, "", "new-section"),
      close: closeSectionForm,
      focused: "",
    },
    {
      name: "Add products at the top level, cancelled",
      open: (el) => rowAction(el, "", "open-add-products"),
      close: async (el) => {
        inModal(el, "add-products", '[data-test="add-products-cancel"]').click();
        await vi.waitFor(() => expect(modal(el, "add-products").open).toBe(false));
      },
      focused: "",
    },
    {
      name: "Add products at the top level, staged",
      open: (el) => rowAction(el, "", "open-add-products"),
      close: async (el) => {
        emit(inModal(el, "add-products", "dashboard-section-add-products"), "wt-add-products", {
          productIds: ["p-chips"],
        });
        await vi.waitFor(() => expect(modal(el, "add-products").open).toBe(false));
      },
      focused: "",
    },
    {
      name: "Include a menu, staged",
      client: () => {
        const client = api();
        const read = client.getMenuStructure.getMockImplementation()! as (
          id: string,
        ) => Promise<MenuStructure>;
        client.getMenuStructure.mockImplementation(async (id: string) => ({
          ...(await read(id)),
          includable: [{ id: "wine", name: "Wines", rootSectionId: "wine-root" }],
        }));
        return client;
      },
      open: (el) => rowAction(el, "", "include-menu"),
      close: async (el) => {
        await chooseOption(inModal(el, "include", '[name="included-menu"]'), "wine-root");
        await vi.waitFor(() => expect(modal(el, "include").open).toBe(false));
      },
      focused: "",
    },
    {
      name: "Include a menu, cancelled",
      open: (el) => rowAction(el, "", "include-menu"),
      close: async (el) => {
        await click(el, "include-cancel");
        await vi.waitFor(() => expect(modal(el, "include").open).toBe(false));
      },
      focused: "",
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
      name: "Include Edit, staged",
      client: () => winesClient({ showAsFolder: true, overrides: {} }).client,
      open: async (el) => {
        await rowAction(el, "included-wine", "edit");
        await vi.waitFor(() => expect(includeModal(el).open).toBe(true));
      },
      close: async (el) => {
        emit(
          includeForm(el).shadowRoot!.querySelector('wt-switch[name="show-as-folder"]')!,
          "wt-change",
          { checked: false },
        );
        await includeForm(el).updateComplete;
        const closed = dialogClosed(includeModal(el));
        includeForm(el).shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
        await closed;
        await vi.waitFor(() => expect(includeModal(el).open).toBe(false));
      },
      focused: "included-wine",
    },
    {
      name: "Remove nonempty section, confirmed",
      open: async (el) => {
        await toggleRow(el, "m-drinks");
        await rowAction(el, "m-drinks/m-beer", "delete");
      },
      close: async (el) => {
        const closed = dialogClosed(modal(el, "delete-section"));
        inModal(el, "delete-section", '[data-test="delete-section-save"]').click();
        await closed;
        await vi.waitFor(() => expect(modal(el, "delete-section").open).toBe(false));
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

  it("keeps focus on the row's menu through the read after Structure Save", async () => {
    const reading = deferred<MenuStructure>();
    const client = api();
    const el = await mountLunch(client);
    await rowAction(el, "m-fav", "open-add-products");
    emit(inModal(el, "add-products", "dashboard-section-add-products"), "wt-add-products", {
      productIds: ["p-chips"],
    });
    await vi.waitFor(() => expect(modal(el, "add-products").open).toBe(false));
    await afterDialogCloses(el);
    await vi.waitFor(() => expect(focusedRowMenu(el)).toBe("m-fav"));

    client.getMenuStructure.mockImplementationOnce(() => reading.promise);
    await saveStructure(el);
    await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(2));
    reading.resolve(lunchWith([productNode("m-new-chips", "p-chips"), ...lunchNodes()]));
    await vi.waitFor(() =>
      expect(topLevelKeys(el)).toEqual(["m-new-chips", "m-burger", "m-drinks", "m-fav"]),
    );
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

  it("keeps Add products' buttons in a 390×700 window with 200 products, and adds two from the root's ⋮", async () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    await page.viewport(390, 700);
    onTestFinished(() => page.viewport(width, height));
    const many = Array.from({ length: 200 }, (_, index) =>
      product(`p-many-${String(index).padStart(3, "0")}`, `Many ${String(index).padStart(3, "0")}`),
    );
    const client = api({ listLibraryProducts: vi.fn().mockResolvedValue([...products, ...many]) });
    const el = await mountLunch(client);
    await rowAction(el, "", "open-add-products");
    expect(modal(el, "add-products").open).toBe(true);
    const picker = inModal<SectionAddProducts>(
      el,
      "add-products",
      "dashboard-section-add-products",
    );
    await picker.updateComplete;
    expect(picker.shadowRoot!.querySelectorAll("li").length).toBeGreaterThanOrEqual(200);
    const add = picker.shadowRoot!.querySelector<HTMLElement>('[data-test="add"]')!;
    const cancel = inModal(el, "add-products", '[data-test="add-products-cancel"]');
    for (const button of [cancel, add]) {
      const box = button.getBoundingClientRect();
      expect(box.top, button.dataset.test).toBeGreaterThanOrEqual(0);
      expect(box.bottom, button.dataset.test).toBeLessThanOrEqual(window.innerHeight);
      expect(box.left, button.dataset.test).toBeGreaterThanOrEqual(0);
      expect(box.right, button.dataset.test).toBeLessThanOrEqual(window.innerWidth);
    }
    for (const id of ["p-many-000", "p-many-001"])
      picker.shadowRoot!.querySelector<HTMLInputElement>(`input[value="${id}"]`)!.click();
    await picker.updateComplete;
    add.click();
    await vi.waitFor(() => expect(modal(el, "add-products").open).toBe(false));
    expect(
      membersAt(el, "")
        .slice(-2)
        .map(({ ref }) => ref),
    ).toEqual([
      { kind: "product", productId: "p-many-000" },
      { kind: "product", productId: "p-many-001" },
    ]);
    expect(writeCalls(client)).toEqual([]);
    await afterDialogCloses(el);
    await settleStructure(el);
    expect(focusedRowMenu(el)).toBe("");
  });

  it("hands focus to the holding section's ⋮ after a removal", async () => {
    const client = api();
    const el = await mountLunch(client);
    await toggleRow(el, "m-drinks");
    await rowAction(el, "m-drinks/m-lemonade", "remove");
    await vi.waitFor(() => expect(rowOf(el, "m-drinks/m-lemonade")).toBeNull());
    expect(writeCalls(client)).toEqual([]);
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
    await rowAction(el, "", "include-menu");
    await visit(el, DINNER_PATH, "Dinner Menu");
    await afterDialogCloses(el);
    await settleStructure(el);
    expect(focusedRowMenu(el)).not.toBe("");
    // Dinner is empty, so its adds are the empty box's.
    expect(
      structure(el).shadowRoot!.querySelector('[data-test="new-section-empty"]'),
    ).not.toBeNull();
    expect(structure(el).shadowRoot!.activeElement).toBeNull();
  });

  it("puts nothing beside the tabs", async () => {
    const el = await mountLunch();
    await settleStructure(el);
    const tabs = q(el, 'wt-tabs[data-test="menu-tabs"]')!;
    expect(tabs.querySelector('[slot="actions"]')).toBeNull();
  });

  it.each(["answer", "refusal"])(
    "keeps the other menu open after a departed product lookup (%s)",
    async (outcome) => {
      const burger = products.find(({ id }) => id === "p-burger")!;
      const value = { ...burger, parentId: null, inherited: null };
      const lookup = deferred<typeof value>();
      const read = vi.fn().mockReturnValueOnce(lookup.promise).mockResolvedValue(value);
      const client = api({
        getProductEditor: read,
        listUnits: vi.fn().mockResolvedValue([burger.unit]),
        listCourses: vi.fn().mockResolvedValue([]),
        listExtraLists: vi.fn().mockResolvedValue([]),
        listOptionLists: vi.fn().mockResolvedValue([]),
      });
      const el = await mountLunch(client);
      el.canEditProducts = true;
      await el.updateComplete;
      await rowAction(el, "m-burger", "edit-product");
      await vi.waitFor(() => expect(read).toHaveBeenCalledExactlyOnceWith("p-burger"));
      await visit(el, DINNER_PATH, "Dinner Menu");
      if (outcome === "answer") lookup.resolve(value);
      else lookup.reject({ code: "connection.failed" });
      await new Promise(requestAnimationFrame);
      el.requestUpdate();
      await el.updateComplete;
      expect(q<ProductEditor>(el, "dashboard-product-editor")?.open ?? false).toBe(false);
      expect(q(el, '[data-test="structure-write-error"]')).toBeNull();
      await visit(el, LUNCH_PATH, "Lunch Menu");
      await rowAction(el, "m-burger", "edit-product");
      await vi.waitFor(() =>
        expect(q<ProductEditor>(el, "dashboard-product-editor")?.open).toBe(true),
      );
    },
  );

  const relatedChoices = [
    [
      "unit",
      "listUnits",
      "createUnit",
      "dashboard-unit-form",
      "units",
      {
        staffName: "Portion",
        staffAbbreviation: "pt",
        name: { en: "Portion" },
        abbreviation: { en: "pt" },
        precision: 0,
      },
    ],
    [
      "extras",
      "listExtraLists",
      "createExtraList",
      "dashboard-extra-list-form",
      "extraLists",
      {
        name: "Sides",
        customerName: null,
        kitchenName: null,
        active: true,
        minPicks: 0,
        maxPicks: null,
        items: [],
      },
    ],
    [
      "options",
      "listOptionLists",
      "createOptionList",
      "dashboard-option-list-form",
      "optionLists",
      {
        name: "Preparation",
        customerName: null,
        kitchenName: null,
        active: true,
        defaultLabelId: null,
        labels: [],
      },
    ],
    [
      "courses",
      "listCourses",
      "createCourse",
      "dashboard-course-list",
      "courses",
      { name: "Dessert", displayOrder: 1, active: true },
    ],
  ] as const;
  it.each(
    relatedChoices.flatMap(([kind, ...example]) => [
      [kind, false, ...example] as const,
      [kind, true, ...example] as const,
    ]),
  )(
    "reloads the %s choices for the editor that asked (departed: %s)",
    async (kind, departed, list, create, selector, field, value) => {
      const burger = products.find(({ id }) => id === "p-burger")!;
      const saved = { ...value, id: "new-choice" };
      const read = vi.fn().mockResolvedValue([]);
      const client = api({
        getProductEditor: vi.fn().mockResolvedValue({ ...burger, parentId: null, inherited: null }),
        listUnits: vi.fn().mockResolvedValue([burger.unit]),
        listCourses: vi.fn().mockResolvedValue([]),
        listExtraLists: vi.fn().mockResolvedValue([]),
        listOptionLists: vi.fn().mockResolvedValue([]),
        [list]: read,
        [create]: vi.fn(async () => {
          read.mockResolvedValue([saved]);
          return saved;
        }),
      });
      const el = await mountLunch(client);
      el.canEditProducts = true;
      await el.updateComplete;
      await rowAction(el, "m-burger", "edit-product");
      const editor = () => q<ProductEditor>(el, "dashboard-product-editor")!;
      await vi.waitFor(() => expect(editor()?.open).toBe(true));
      emit(editor(), "wt-create-related", { kind });
      await el.updateComplete;
      const form = q(el, selector)!;
      expect(form).not.toBeNull();
      const reloading = deferred<(typeof saved)[]>();
      const requested = deferred<void>();
      const reload = () => {
        requested.resolve();
        return reloading.promise;
      };
      if (kind === "courses") {
        await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
        read.mockImplementationOnce(reload);
        emit(form, "course-added", { id: saved.id });
        await userEvent.click(q(el, '[data-test="courses-done"]')!);
      } else {
        client[create].mockImplementationOnce(async () => {
          read.mockImplementationOnce(reload);
          return saved;
        });
        emit(form, "wt-submit", { value, body: value });
      }
      await requested.promise;
      if (departed) {
        await visit(el, DINNER_PATH, "Dinner Menu");
        await visit(el, LUNCH_PATH, "Lunch Menu");
        await rowAction(el, "m-burger", "edit-product");
        await vi.waitFor(() => expect(editor()?.open).toBe(true));
        reloading.resolve([saved]);
        await new Promise(requestAnimationFrame);
        expect(editor()[field]).toEqual([]);
        return;
      }
      reloading.resolve([saved]);
      await vi.waitFor(() => expect(editor()[field]).toEqual([saved]));
      const draft = editor().currentValue;
      expect(draft.name).toBe("Burger");
      if (kind === "courses") expect(draft.courseId).toBe(saved.id);
      else if (kind === "unit") expect(draft.unitId).toBe(saved.id);
      else expect(draft.modifiers).toContainEqual({ kind, id: saved.id });
    },
  );

  it("fits a phone: the tab does not scroll sideways and every row's ⋮ is on screen (390 px)", async () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    await page.viewport(390, 844);
    onTestFinished(() => page.viewport(width, height));
    const el = await mountLunch();
    await vi.waitFor(() => expect(rowOf(el, "m-burger")).not.toBeNull());
    await toggleRow(el, "m-drinks");
    await toggleRow(el, "m-drinks/m-beer");
    expect(window.innerWidth).toBe(390);
    const overflow = Array.from(el.shadowRoot!.querySelectorAll<HTMLElement>("*")).flatMap(
      (node) => {
        const rect = node.getBoundingClientRect();
        return rect.right > window.innerWidth
          ? [`${node.localName}.${node.className} ${rect.right}`]
          : [];
      },
    );
    expect(document.scrollingElement!.scrollWidth, overflow.join(", ")).toBeLessThanOrEqual(
      window.innerWidth,
    );
    const menus = allInStructure(el, 'wt-row-actions[data-test^="actions-"]');
    expect(menus.map((menu) => menu.closest("tr")!.dataset.rowKey)).toEqual([
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
      expect(link.getAttribute("href")).toBe("/products/product/p-burger");
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
      expect(heard).toEqual([{ productId: "p-burger", path: ["m-burger"] }]);
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

  it("stages the switch and the changed fields on the include's row", async () => {
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
    await vi.waitFor(() => expect(includeModal(el).open).toBe(false));
    expect(client.setIncludeFolder).not.toHaveBeenCalled();
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
    await vi.waitFor(() => expect(includeModal(el).open).toBe(false));
    expect(writeCalls(client)).toEqual([]);
    await saveStructure(el);
    expect(structureWrite(client).rootMembers.at(-1)).toEqual({
      id: "included-wine",
      ref: { kind: "section", sectionId: "wine-root" },
      folder: { showAsFolder: true, overrides: { color: "#256bb1" } },
    });
  });

  it.each([
    ["names", "menu_section.translation_required"],
    ["image", "menu_section.invalid"],
    ["color", "menu_section.invalid"],
  ])("puts a refused folder's %s beside its row and keeps Save ready", async (field, code) => {
    const { client } = winesClient(
      { showAsFolder: true, overrides: {} },
      {
        saveMenuStructure: vi.fn().mockRejectedValue({
          code,
          params: { field: "rootMembers.3.folder." + field },
        }),
      },
    );
    const el = await mountLunch(client);
    await openWines(el);
    includeForm(el).shadowRoot!.querySelector<HTMLElement>("[data-color='#256bb1']")!.click();
    await includeForm(el).updateComplete;
    includeSave(el).click();
    await vi.waitFor(() => expect(includeModal(el).open).toBe(false));
    expect(writeCalls(client)).toEqual([]);
    await saveStructure(el);
    await vi.waitFor(() => expect(text(rowOf(el, "included-wine"))).toContain(codeMessage(code)));
    expect(text(rowOf(el, "m-drinks"))).not.toContain(codeMessage(code));
    expect(
      q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="structure-save"]')!.disabled,
    ).toBe(false);
  });

  it("closes when another menu is opened, saving nothing", async () => {
    const { client } = winesClient({ showAsFolder: true, overrides: {} });
    const el = await mountLunch(client);
    await openWines(el);
    await visit(el, DINNER_PATH, "Dinner Menu");
    expect(includeModal(el).open).toBe(false);
    emit(includeForm(el), "wt-submit", { showAsFolder: false });
    await el.updateComplete;
    expect(client.setIncludeFolder).not.toHaveBeenCalled();
  });
});

async function chooseTab(el: MenusScreen, key: string): Promise<void> {
  const tabs = q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!;
  tabs.shadowRoot!.querySelector<HTMLElement>(`[role="tab"][data-key="${key}"]`)!.click();
  await el.updateComplete;
}

it("keeps its tab when a change event bubbles up from a control inside a tab's content", async () => {
  const el = await mountLunch();
  await chooseTab(el, "home");
  q(el, '[slot="home"]')!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "structure" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!.value).toBe("home");
  expect(location.pathname).toBe(HOME_PATH);
});

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
    const selector = `[data-test="${testId}"]`;
    return testId === "publish" || testId === "schedule-open"
      ? q(el, selector)
      : panel(el).shadowRoot!.querySelector<HTMLElement>(selector);
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

  it("refreshes a stale scheduled preview while retaining the date draft and asking again", async () => {
    const warned = {
      ...lunchPreview(),
      warnings: [
        {
          kind: "allergens_unreviewed" as const,
          products: [{ id: "p-burger", name: "Staff burger", parentName: null }],
        },
      ],
    };
    const client = api({
      getMenuPreview: vi.fn().mockResolvedValue(warned),
      scheduleMenuPublication: vi
        .fn()
        .mockRejectedValueOnce({ code: "menu.changed_since_preview" })
        .mockResolvedValue({ number: 3, versionId: "v3", activatesAt: "2030-01-01T12:00:00Z" }),
    });
    const el = await mountPreview(client);
    const schedule = panel(el).shadowRoot!.querySelector<
      HTMLElementTagNameMap["dashboard-menu-publications"]
    >("dashboard-menu-publications")!;
    const sq = (selector: string) => schedule.shadowRoot!.querySelector<HTMLElement>(selector)!;
    await expect.poll(() => inPanel(el, "schedule-open")).not.toBeNull();
    await userEvent.click(inPanel(el, "schedule-open")!);
    await schedule.updateComplete;
    for (const [name, value] of [
      ["date", "2030-01-01"],
      ["time", "12:00"],
    ]) {
      const field = sq(`wt-input[name="${name}"]`) as HTMLElementTagNameMap["wt-input"];
      field.value = value!;
      field.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
      );
    }
    await schedule.updateComplete;
    await userEvent.click(sq('[data-test="schedule-submit"]'));
    await schedule.updateComplete;
    expect(client.scheduleMenuPublication).not.toHaveBeenCalled();
    const reads = client.getMenuPreview.mock.calls.length;
    client.getMenuPreview.mockResolvedValue({ ...warned, hash: "fresh-scheduled-hash" });
    await userEvent.click(sq('[data-test="publish-confirm"]'));
    await expect.poll(() => schedule.preview?.hash).toBe("fresh-scheduled-hash");
    expect(client.getMenuPreview).toHaveBeenCalledTimes(reads + 1);
    expect(schedule.isConnected).toBe(true);
    expect((sq('wt-input[name="date"]') as HTMLElementTagNameMap["wt-input"]).value).toBe(
      "2030-01-01",
    );
    expect((sq('wt-input[name="time"]') as HTMLElementTagNameMap["wt-input"]).value).toBe("12:00");
    await userEvent.click(sq('[data-test="schedule-submit"]'));
    await schedule.updateComplete;
    expect(client.scheduleMenuPublication).toHaveBeenCalledTimes(1);
    await userEvent.click(sq('[data-test="publish-confirm"]'));
    await expect.poll(() => client.scheduleMenuPublication.mock.calls.length).toBe(2);
    expect(client.scheduleMenuPublication).toHaveBeenLastCalledWith("menu-lunch", {
      expectedHash: "fresh-scheduled-hash",
      activatesAt: { date: "2030-01-01", time: "12:00" },
    });
  });

  for (const action of ["Schedule", "Change time"] as const) {
    for (const destination of ["/menus/menu/menu-dinner/view/preview", "/menus"]) {
      it(`${action}: reports a refused save on the screen after leaving for ${destination}`, async () => {
        const pending = deferred<never>();
        const client = api({
          getMenuPublications: vi.fn().mockResolvedValue({
            timeZone: "Europe/Madrid",
            live: null,
            editions:
              action === "Schedule"
                ? []
                : [
                    {
                      versionId: "v-lunch-2",
                      number: 2,
                      state: "queued",
                      activatesAt: "2030-01-01T11:00:00.000Z",
                      queuedAt: "2026-10-07T08:00:00.000Z",
                      cancelledAt: null,
                      contentHash: "other-hash",
                      local: {
                        date: "2030-01-01",
                        time: "12:00",
                        offset: "+01:00",
                        repeated: false,
                      },
                    },
                  ],
          }),
          getMenuPreview: vi.fn().mockResolvedValue({ ...lunchPreview(), warnings: [] }),
          scheduleMenuPublication: vi.fn(() => pending.promise),
          rescheduleMenuPublication: vi.fn(() => pending.promise),
        });
        const el = await mountPreview(client);
        const schedule = panel(el).shadowRoot!.querySelector("dashboard-menu-publications")!;
        const sq = (selector: string) => schedule.shadowRoot!.querySelector<HTMLElement>(selector);
        if (action === "Schedule") {
          await expect.poll(() => inPanel(el, "schedule-open")).toBeTruthy();
          inPanel(el, "schedule-open")!.click();
        } else {
          const move = () =>
            sq("wt-data-table")?.shadowRoot?.querySelector<HTMLElement>(
              '[data-test="move-v-lunch-2"]',
            );
          await expect.poll(move).toBeTruthy();
          move()!.click();
        }
        await schedule.updateComplete;
        type(sq('wt-input[name="date"]')!, "2030-01-02");
        type(sq('wt-input[name="time"]')!, "13:00");
        await schedule.updateComplete;
        sq('[data-test="schedule-submit"]')!.click();
        const write =
          action === "Schedule" ? client.scheduleMenuPublication : client.rescheduleMenuPublication;
        await expect.poll(() => write.mock.calls.length).toBe(1);
        history.pushState(null, "", destination);
        window.dispatchEvent(new PopStateEvent("popstate"));
        await expect
          .poll(() => schedule.isConnected && schedule.menuId === "menu-lunch")
          .toBe(false);
        pending.reject({ code: "connection.failed" });
        await expect
          .poll(() => text(q(el, '[data-test="member-error"]')))
          .toBe(
            "The schedule change for Lunch Menu was not confirmed. Open its Preview tab and check Scheduled versions before trying again.",
          );
        expect(write).toHaveBeenCalledTimes(1);
      });
    }
  }

  it("reports a schedule refused after leaving the Menus screen on the current dashboard page", async () => {
    await import("../dashboard-app.js");
    const pending = deferred<never>();
    const client = api({
      getMenuPreview: vi.fn().mockResolvedValue({ ...lunchPreview(), warnings: [] }),
      scheduleMenuPublication: vi.fn(() => pending.promise),
      getMe: async () => ({
        personId: "p1",
        email: "ada@example.com",
        roleIds: ["manager"],
        locale: "en-GB",
        venueLocale: "en-GB",
        sessionDefault: "en-GB",
        venueName: "Venue",
        permissions: ["product.manage", "menu.manage", "venue.view"],
        modules: [],
      }),
      forgetLocales: () => {},
      getLocales: async () => ({
        locales: [{ code: "en-GB", label: "English" }],
        venueDefault: "en-GB",
        loginDefault: "en-GB",
        venueName: "Venue",
        onboardingIntent: "prepare",
      }),
      listAlerts: async () => ({ visible: false, alerts: [] }),
      getDiskStop: async () => ({ stopped: false, deleted: null }),
      getGoogleConfig: async () => ({ configured: false }),
      passkeySignals: async () => ({
        rpId: "localhost",
        userId: "cDE",
        credentialIds: [],
        name: "ada@example.com",
        displayName: "Ada",
      }),
    });
    history.replaceState(null, "", PREVIEW_PATH);
    const { el: app } = await mountWidget<DashboardApp>("dashboard-app", { api: client });
    const publication = () =>
      app
        .shadowRoot!.querySelector("dashboard-menus-screen")
        ?.shadowRoot?.querySelector("dashboard-menu-preview")
        ?.shadowRoot?.querySelector("dashboard-menu-publications");
    const menusScreen = () => app.shadowRoot!.querySelector("dashboard-menus-screen");
    await expect
      .poll(() => menusScreen()?.shadowRoot?.querySelector('[data-test="schedule-open"]'))
      .toBeTruthy();
    const menus = menusScreen()!;
    const schedule = publication()!;
    await menus.updateComplete;
    await schedule.updateComplete;
    const menuRenders = vi.spyOn(menus, "render");
    const scheduleRenders = vi.spyOn(schedule, "render");
    for (let i = 0; i < 3; i++) {
      app.requestUpdate();
      await app.updateComplete;
      await menus.updateComplete;
      await schedule.updateComplete;
    }
    expect(menuRenders).not.toHaveBeenCalled();
    expect(scheduleRenders).not.toHaveBeenCalled();
    const sq = (selector: string) => schedule.shadowRoot!.querySelector<HTMLElement>(selector)!;
    inPanel(menus, "schedule-open")!.click();
    await schedule.updateComplete;
    type(sq('wt-input[name="date"]'), "2030-01-02");
    type(sq('wt-input[name="time"]'), "13:00");
    await schedule.updateComplete;
    sq('[data-test="schedule-submit"]').click();
    await expect.poll(() => client.scheduleMenuPublication.mock.calls.length).toBe(1);
    app.shadowRoot!.querySelector<HTMLElement>('[data-test="nav-overview"]')!.click();
    const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await expect.poll(() => question.open).toBe(true);
    await question.updateComplete;
    await userEvent.click(
      question.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!,
    );
    await expect.poll(() => schedule.isConnected).toBe(false);
    pending.reject({ code: "connection.failed" });
    await expect
      .poll(
        () =>
          app.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-banner"]>(
            '[data-test="save-refusal"]',
          )?.message,
      )
      .toBe(
        "The schedule change for Lunch Menu was not confirmed. Open its Preview tab and check Scheduled versions before trying again.",
      );
    expect(client.scheduleMenuPublication).toHaveBeenCalledTimes(1);
  });

  it("keeps a schedule refusal in its still-open dialog without a page notice", async () => {
    const pending = deferred<never>();
    const client = api({
      getMenuPreview: vi.fn().mockResolvedValue({ ...lunchPreview(), warnings: [] }),
      scheduleMenuPublication: vi.fn(() => pending.promise),
    });
    const el = await mountPreview(client);
    const schedule = panel(el).shadowRoot!.querySelector("dashboard-menu-publications")!;
    const sq = (selector: string) => schedule.shadowRoot!.querySelector<HTMLElement>(selector)!;
    await expect.poll(() => inPanel(el, "schedule-open")).toBeTruthy();
    inPanel(el, "schedule-open")!.click();
    await schedule.updateComplete;
    type(sq('wt-input[name="date"]'), "2030-01-02");
    type(sq('wt-input[name="time"]'), "13:00");
    await schedule.updateComplete;
    sq('[data-test="schedule-submit"]').click();
    await expect.poll(() => client.scheduleMenuPublication.mock.calls.length).toBe(1);
    pending.reject({ code: "connection.failed" });
    await expect
      .poll(
        () =>
          sq('[data-test="schedule-dialog"]').querySelector<
            HTMLElementTagNameMap["wt-form-actions"]
          >("wt-form-actions")!.error,
      )
      .toBe(codeMessage("connection.failed"));
    expect(q(el, '[data-test="member-error"]')).toBeNull();
    expect(sq('[data-test="late-refusal"]')).toBeNull();
  });

  it.each([false, true])(
    "returns focus after cancelling the last queued version with unpublished changes: %s",
    async (changed) => {
      const edition = {
        versionId: "v-next",
        number: 3,
        state: "queued" as const,
        activatesAt: "2030-01-01T11:00:00.000Z",
        queuedAt: PUBLISHED_AT,
        cancelledAt: null,
        contentHash: "e".repeat(64),
        local: { date: "2030-01-01", time: "12:00", offset: "+01:00", repeated: false },
      };
      const queue = { timeZone: "Europe/Madrid", live: null, editions: [edition] };
      const preview = { ...lunchPreview(), warnings: [] };
      const client = api({
        getMenuPreview: vi.fn().mockResolvedValue({
          ...preview,
          status: {
            ...statuses()["menu-lunch"],
            state: changed ? "changed" : "current",
            hash: changed ? LUNCH_LIVE_HASH : preview.hash,
          },
        }),
        getMenuPublications: vi.fn().mockResolvedValue(queue),
        cancelMenuPublication: vi.fn(async () => {
          client.getMenuPublications.mockResolvedValue({ ...queue, editions: [] });
        }),
      });
      const el = await mount(client, PREVIEW_PATH);
      if (!changed) {
        await vi.waitFor(() => expect(inPanel(el, "schedule-open")).not.toBeNull());
        expect(inPanel(el, "publish")).toBeNull();
      }
      const schedule = panel(el).shadowRoot!.querySelector("dashboard-menu-publications")!;
      const cancel = () =>
        schedule
          .shadowRoot!.querySelector("wt-data-table")
          ?.shadowRoot!.querySelector<HTMLElement>('[data-test="cancel-v-next"]');
      await vi.waitFor(() => expect(cancel()).toBeTruthy());
      cancel()!.closest("wt-row-actions")!.show();
      await userEvent.click(cancel()!);
      const confirm = schedule.shadowRoot!.querySelector<HTMLElement>(
        '[data-test="cancel-confirm"]',
      )!;
      await userEvent.click(confirm);
      await vi.waitFor(() => expect(cancel()).toBeUndefined());
      await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(q(el, "h1")));
      await userEvent.keyboard("{Enter}");
      expect(client.publishMenu).not.toHaveBeenCalled();
    },
  );

  it("renders the publications widget for the open menu with the preview it read", async () => {
    const client = api();
    const el = await mountPreview(client);
    const schedule = panel(el).shadowRoot!.querySelector<
      HTMLElementTagNameMap["dashboard-menu-publications"]
    >("dashboard-menu-publications")!;
    expect(schedule.querySelector('[data-test="changes-pane"]')).not.toBeNull();
    expect(schedule.menuId).toBe("menu-lunch");
    expect(schedule.menuName).toBe("Lunch Menu");
    expect(schedule.api).toBe(client);
    expect(schedule.preview).toBe(panel(el).preview);
    expect(schedule.preview?.hash).toBe(LUNCH_HASH);
    await vi.waitFor(() => expect(client.getMenuPublications).toHaveBeenCalledWith("menu-lunch"));
  });

  it("hands the publications widget no preview once a background preview read fails", async () => {
    const live = new LiveData();
    const client = api({
      liveData: live,
      getMenuPreview: vi.fn().mockResolvedValue(lunchPreview()),
    });
    const el = await mountPreview(client);
    const schedule = panel(el).shadowRoot!.querySelector<
      HTMLElementTagNameMap["dashboard-menu-publications"]
    >("dashboard-menu-publications")!;
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
      allergens: null,
      diet: null,
      dietOverride: null,
      dietaryDeclarations: [],
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
        id: "home-order",
        kind: "home_display_changed",
        source: "this_menu",
        targets: {
          before: [{ kind: "home", field: "order" }],
          after: [{ kind: "home", field: "order" }],
        },
      },
    ];
    snapshot.document.root.members = snapshot.document.root.members.filter(
      (m) => m.kind !== "product",
    );
    delete snapshot.document.offers["mi-burger"];
    return snapshot;
  }

  async function content(el: MenusScreen): Promise<MenuDocumentTree> {
    const renderer = panel(el).shadowRoot!.querySelector<MenuDocumentTree>(
      "dashboard-menu-document-tree",
    )!;
    await renderer.updateComplete;
    await renderer.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
    return renderer;
  }
  function treeRows(renderer: MenuDocumentTree) {
    return renderer.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!;
  }

  async function followChange(el: MenusScreen, id: string): Promise<void> {
    const link = panel(el).shadowRoot!.querySelector<HTMLAnchorElement>(
      `a[data-change-id="${id}"]`,
    )!;
    expect(link).not.toBeNull();
    if (id === "home-order") {
      expect(link.getAttribute("href")).toBe("/menus/menu/menu-lunch/view/home");
      return;
    }
    link.focus();
    link.click();
    await panel(el).updateComplete;
    await vi.waitFor(async () =>
      expect(treeRows(await content(el)).querySelector('[aria-current="true"]')).not.toBeNull(),
    );
    if (panel(el).shadowRoot!.querySelector("wt-segmented-control")!.getClientRects().length > 0) {
      const tree = treeRows(await content(el));
      expect(tree.activeElement?.getAttribute("aria-current")).toBe("true");
    } else expect(panel(el).shadowRoot!.activeElement).toBe(link);
  }

  it("inspects frozen tree names and reads removed rows without another read or write", async () => {
    const snapshot = navigablePreview();
    const original = JSON.stringify(snapshot);
    const client = api({ getMenuPreview: vi.fn().mockResolvedValue(snapshot) });
    const el = await mountPreview(client);
    await followChange(el, "lemon-description");
    const renderer = await content(el);
    expect(renderer.view).toEqual({ kind: "customer", language: "es" });
    expect(treeRows(renderer).textContent).toContain("Lemonade para clientes");
    const reads = client.getMenuPreview.mock.calls.length;
    setLocale("es-ES");
    await panel(el).updateComplete;
    await renderer.updateComplete;
    expect(renderer.view).toEqual({ kind: "customer", language: "es" });
    const selector = panel(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      'wt-combobox[name="menu-preview-view"]',
    )!;
    await chooseOption(selector, "internal");
    await renderer.updateComplete;
    await renderer.shadowRoot!.querySelector("wt-data-table")!.updateComplete;
    expect(renderer.view).toEqual({ kind: "internal" });
    expect(treeRows(renderer).textContent).toContain("Lemonade");
    await chooseOption(selector, "es");
    await renderer.updateComplete;
    expect(renderer.view).toEqual({ kind: "customer", language: "es" });
    expect(panel(el).shadowRoot!.querySelector('a[data-change-id="removed-burger"]')).toBeNull();
    expect(renderer.document).toBe(snapshot.document);
    await followChange(el, "home-order");
    expect(client.getMenuPreview.mock.calls.length).toBe(reads);
    expect(writeCalls(client)).toEqual([]);
    expect(JSON.stringify(snapshot)).toBe(original);
  });

  it("publishes the proposed preview hash with a removed dish", async () => {
    const snapshot = navigablePreview();
    const client = api({ getMenuPreview: vi.fn().mockResolvedValue(snapshot) });
    const el = await mountPreview(client);
    expect(panel(el).shadowRoot!.querySelector('a[data-change-id="removed-burger"]')).toBeNull();
    expect((await content(el)).document).toBe(snapshot.document);
    await publish(el);
    expect(client.publishMenu.mock.calls).toEqual([["menu-lunch", LUNCH_HASH]]);
    expect(writeCalls(client)).toEqual(["publishMenu"]);
  });

  it("replaces the whole preview envelope without stealing focus or retaining tree expansion", async () => {
    const live = new LiveData();
    const initial = navigablePreview();
    const refreshed = navigablePreview();
    refreshed.hash = "f".repeat(64);
    refreshed.document.offers["mi-lemonade"]!.customerName = { es: "New frozen name" };
    const client = api({ liveData: live, getMenuPreview: vi.fn().mockResolvedValue(initial) });
    const el = await mountPreview(client);
    await followChange(el, "lemon-description");
    const renderer = await content(el);
    const back = q<HTMLElement>(el, '[data-test="back"]')!;
    back.focus();
    expect(el.shadowRoot!.activeElement).toBe(back);
    client.getMenuPreview.mockResolvedValue(refreshed);
    live.invalidate([{ type: "products" }]);
    await vi.waitFor(() => expect(panel(el).preview).toBe(refreshed));
    await vi.waitFor(() =>
      expect(
        treeRows(renderer).querySelector('tr[data-row-key="s-drinks/mi-lemonade"]'),
      ).toBeNull(),
    );
    expect(inPanel(el, "publish-confirmation")).toBeNull();
    expect(el.shadowRoot!.activeElement).toBe(back);
    expect(treeRows(renderer).querySelector('[aria-current="true"]')).toBeNull();
    await followChange(el, "lemon-description");
    expect(treeRows(renderer).textContent).toContain("New frozen name");
    expect(panel(el).shadowRoot!.querySelector('a[data-change-id="removed-burger"]')).toBeNull();
    expect((await content(el)).document).toBe(refreshed.document);
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
        .mockResolvedValue({ versionId: "v3", number: 3, publishedAt: NEXT_PUBLISHED_AT }),
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
      history.pushState(null, "", "/menus/menu/menu-dinner/view/preview");
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
      expect(treeRows(renderer).textContent).toContain("Frozen dinner title");
      expect(treeRows(renderer).textContent).not.toContain("Lemonade para clientes");
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
        listMenus: vi.fn().mockResolvedValue([{ ...menus[0]!, name }]),
        getMenuPreview: vi.fn().mockResolvedValue(snapshot),
      });
      const el = await mount(client, PREVIEW_PATH, theme);
      await vi.waitFor(() => expect(inPanel(el, "changes")).not.toBeNull());
      const panes = () => [
        inPanel(el, "changes-pane")!.getBoundingClientRect(),
        inPanel(el, "document-pane")!.getBoundingClientRect(),
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
      } else {
        expect(inPanel(el, "document-pane")!.getClientRects()).toHaveLength(0);
        await selectPreviewPane(panel(el), "menu");
      }
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
        path: `__screenshots__/w95-final-screen/${locale}-${theme}-${width}-hierarchy.png`,
      });
      if (width === 390) await selectPreviewPane(panel(el), "changes");
      await followChange(el, "lemon-description");
      checkWidth();
      await expectNoA11yViolations(el.parentElement!);
      await page.screenshot({
        element: inPanel(el, "document-pane")!,
        path: `__screenshots__/w95-final-screen/${locale}-${theme}-${width}-detail.png`,
      });
      const menuPane = inPanel(el, "document-pane")!;
      const renderer = await content(el);
      const selected = treeRows(renderer).querySelector<HTMLElement>('[aria-current="true"]')!;
      expect(selected.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        menuPane.getBoundingClientRect().top,
      );
      expect(selected.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        menuPane.getBoundingClientRect().bottom,
      );
      if (width === 390) await selectPreviewPane(panel(el), "changes");
      expect(panel(el).shadowRoot!.querySelector('a[data-change-id="removed-empty"]')).toBeNull();
      expect(renderer.document).toBe(snapshot.document);
      checkWidth();
      await expectNoA11yViolations(el.parentElement!);
      await followChange(el, "home-order");
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
      listMenus: vi
        .fn()
        .mockResolvedValue([...menus, { id: "menu-brunch", name: "Brunch Menu", active: true }]),
      getMenuStatuses: vi
        .fn()
        .mockResolvedValue({ ...statuses(), "menu-brunch": { state: "unpublished", clashes: 0 } }),
    });
    const el = await mount(client);
    await table(el).updateComplete;
    await vi.waitFor(() => expect(statusCell(el, "menu-brunch")).toBe("Unpublished"));
    expect(statusCell(el, "menu-lunch")).toBe(`Published · 1 hour ago`);
    expect(statusCell(el, "menu-dinner")).toBe(`Published · Sunday, 18:00`);
    expect(client.getMenuStatuses).toHaveBeenCalledTimes(1);
    expect(client.getMenuStatus).not.toHaveBeenCalled();
  });

  it("puts the menus waiting for a publish first when the status heading is pressed", async () => {
    const client = api({
      listMenus: vi
        .fn()
        .mockResolvedValue([...menus, { id: "menu-brunch", name: "Brunch Menu", active: true }]),
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
    await vi.waitFor(() => expect(inPanel(onPreview, "live")).toBeNull());
  });

  it("keeps the state it read on another tab when the preview cannot be read", async () => {
    const client = api({ getMenuPreview: vi.fn().mockRejectedValue(new Error("offline")) });
    const el = await mountLunch(client);
    const shown = `Live: version 2 · 1 hour ago`;
    await vi.waitFor(() => expect(text(q(el, '[data-test="menu-status"]'))).toBe(shown));
    await chooseTab(el, "preview");
    await vi.waitFor(() => expect(inPanel(el, "preview-error")).not.toBeNull());
    expect(text(q(el, '[data-test="menu-status"]'))).toBe(shown);
    expect(inPanel(el, "live")).toBeNull();
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
      listMenus: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(menus),
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
      expect(statusCell(el, "menu-dinner")).toBe(`Published · Sunday, 18:00`);
    });
    expect(client.getMenuStatuses).toHaveBeenCalledTimes(2);
  });

  it("keeps the open menu's state and reads its preview again when a failed load is retried on the Preview tab", async () => {
    const client = api({
      listMenus: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(menus),
    });
    const el = await mount(client, PREVIEW_PATH);
    expect(q(el, '[data-test="load-error"]')).not.toBeNull();
    const shown = `Live: version 2 · 1 hour ago`;
    await vi.waitFor(() => expect(text(q(el, '[data-test="menu-status"]'))).toBe(shown));
    const previews = client.getMenuPreview.mock.calls.length;
    await click(el, "retry");
    expect(text(q(el, '[data-test="menu-status"]'))).toBe(shown);
    await vi.waitFor(() => expect(client.getMenuPreview.mock.calls.length).toBe(previews + 1));
    await vi.waitFor(() => expect(q(el, '[data-test="load-error"]')).toBeNull());
    expect(text(q(el, '[data-test="menu-status"]'))).toBe(shown);
    expect(client.getMenuStatus).not.toHaveBeenCalled();
  });

  it("lists the status column without Kind, Changes or a chooser", async () => {
    setLocale("es-ES");
    const set = {
      id: "set-daily",
      name: "Daily menu",
      active: true,
      kind: "set_menu",
      setPrice: "14.00",
    };
    const el = await mount(api({ listMenus: vi.fn().mockResolvedValue([...menus, set]) }));
    const headerTexts = () =>
      [...table(el).shadowRoot.querySelectorAll("thead th")].map((th) => text(th));
    await vi.waitFor(async () => {
      await table(el).updateComplete;
      expect(headerTexts()).toContain(t("menus.status"));
    });
    expect(headerTexts().slice(1)).toEqual([t("menus.status"), t("menus.actions")]);
    expect(table(el).shadowRoot.querySelector('tr[data-row-key="set-daily"]')).toBeNull();
    expect(headerTexts()).not.toContain("Cambios");
    expect(table(el).shadowRoot.querySelector(".columns-trigger")).toBeNull();
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
        `Lunch Menu Published · 1 hour ago Unpublished changes`,
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

  it.each([
    ["en-GB", "Main menu", "Staff menus", "Kind", "Lunch"],
    ["es-ES", "Carta principal", "Cartas del personal", "Tipo", "Almuerzo"],
  ] as const)(
    "shows starting and staff periods on desktop and phone in %s, with Actions in view",
    async (locale, mainHeading, staffHeading, kindHeading, periodName) => {
      const before = currentLocale();
      setLocale(locale);
      onTestFinished(() => setLocale(before));
      const set = {
        id: "set-daily",
        name: "Daily menu",
        active: true,
        kind: "set_menu",
        setPrice: "14.00",
      };
      const unused = { ...menus[0]!, id: "unused", name: "Unused menu" };
      const client = api({ listMenus: vi.fn().mockResolvedValue([...menus, set, unused]) });
      const { el } = await mountWidget<MenusScreen>("dashboard-menus-screen", {
        api: client,
        menuPeriodUsage: {
          watch(publish) {
            publish([
              {
                periodId: "lunch",
                label: periodName,
                menuId: "menu-lunch",
                staffMenuIds: ["menu-dinner"],
                href: "/periods/period/lunch",
              },
            ]);
            return () => {};
          },
        } satisfies MenuPeriodUsageProvider,
      });
      const row = (id: string) => table(el)?.shadowRoot.querySelector(`tr[data-row-key="${id}"]`);
      const headings = () =>
        [...(table(el)?.shadowRoot.querySelectorAll("thead th") ?? [])].map(text);
      for (const [width, stacked] of [
        [1280, false],
        [790, true],
        [390, true],
      ] as const) {
        await page.viewport(width, 900);
        await vi.waitFor(() => {
          const lunch = row("menu-lunch");
          const starting = lunch?.querySelector('a[href="/periods/period/lunch"]');
          expect(starting?.textContent?.trim()).toBe(periodName);
          expect(starting?.closest("td")).toBe(lunch?.querySelectorAll("td")[stacked ? 0 : 2]);
          expect(headings().includes(mainHeading)).toBe(!stacked);
          expect(headings().includes(staffHeading)).toBe(!stacked);
          expect(headings()).not.toContain(kindHeading);
          expect(table(el).shadowRoot.querySelector(".columns-trigger") !== null).toBe(!stacked);
          expect(text(row("menu-dinner"))).toContain(periodName);
          expect(text(row("menu-dinner"))).not.toContain(t("menus.period_unused"));
          expect(text(row("unused"))).toContain(t("menus.period_unused"));
          expect(row("set-daily")).toBeNull();
          if (stacked) {
            expect(text(lunch?.querySelector('[part="period-label"]') ?? null)).toBe(mainHeading);
            expect(text(row("menu-dinner")?.querySelector('[part="period-label"]') ?? null)).toBe(
              staffHeading,
            );
            const unusedRow = row("unused")!;
            const state = unusedRow.querySelector('[data-test="status-unused"]')!;
            const periodState = [...unusedRow.querySelectorAll("[part]")].find(
              (part) => text(part) === t("menus.period_unused"),
            )!;
            expect(periodState.getBoundingClientRect().top).toBeGreaterThanOrEqual(
              state.getBoundingClientRect().bottom,
            );
          }
          const scroll = table(el).shadowRoot.querySelector<HTMLElement>(".scroll")!;
          expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
          expectRowMenusOnScreen(table(el), 3, "wt-row-actions", false);
        });
      }
    },
  );

  it("only a successful read can show that a menu is unused", async () => {
    let publish!: (rows: readonly MenuPeriodUsage[] | null) => void;
    const { el } = await mountWidget<MenusScreen>("dashboard-menus-screen", {
      api: api(),
      menuPeriodUsage: {
        watch(accept) {
          publish = accept;
          return () => {};
        },
      } satisfies MenuPeriodUsageProvider,
    });
    const lunch = () =>
      text(table(el)?.shadowRoot.querySelector('tr[data-row-key="menu-lunch"]') ?? null);
    await expect.poll(lunch).toContain("Checking periods…");
    expect(lunch()).not.toContain("Not used by any period");
    publish(null);
    await expect.poll(lunch).toContain("Could not check periods");
    expect(lunch()).not.toContain("Not used by any period");
    publish([]);
    await expect.poll(lunch).toContain("Not used by any period");
    expect(lunch()).not.toContain("Could not check periods");
  });

  it("sorts by name, and shows it, when a list sorted by status turns phone-width", async () => {
    const client = api({
      listMenus: vi
        .fn()
        .mockResolvedValue([...menus, { id: "menu-brunch", name: "Brunch Menu", active: true }]),
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
      expect(text(q(el, '[data-test="menu-status"]'))).toBe(`Live: version 2 · 1 hour ago`),
    );
    expect(client.getMenuStatus).toHaveBeenCalledWith("menu-lunch");
    const one = client.getMenuStatus.mock.calls.length;
    live.invalidate([{ type: "menu_releases" }]);
    await vi.waitFor(() => expect(client.getMenuStatus.mock.calls.length).toBe(one + 1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.getMenuStatuses).toHaveBeenCalledTimes(1);
    await click(el, "back");
    await vi.waitFor(() => expect(client.getMenuStatuses).toHaveBeenCalledTimes(2));
    live.invalidate([{ type: "menu_releases" }]);
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
      ).toEqual(["Drinks › Chips", "Lemonade: colour changed in Products, also on Dinner Menu"]),
    );
    expect(client.getMenuPreview).toHaveBeenCalledWith("menu-lunch");
    expect(inPanel(el, "live")).toBeNull();
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
    live.invalidate([{ type: "menu_releases" }]);
    await vi.waitFor(() => expect(client.getMenuPreview.mock.calls.length).toBe(previews + 1));
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="menu-status"]'))).toBe(`Live: version 3 · 1 hour ago`),
    );
    expect(inPanel(el, "live")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.getMenuStatus.mock.calls.length).toBe(statusReads);
    const held = deferred<MenuStatus>();
    client.getMenuStatus.mockReturnValueOnce(held.promise);
    await chooseTab(el, "structure");
    await vi.waitFor(() => expect(client.getMenuStatus.mock.calls.length).toBe(statusReads + 1));
    await el.updateComplete;
    expect(text(q(el, '[data-test="menu-status"]'))).toBe(`Live: version 3 · 1 hour ago`);
    held.resolve(statuses()["menu-lunch"]!);
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="menu-status"]'))).toBe(`Live: version 2 · 1 hour ago`),
    );
    live.invalidate([{ type: "menu_releases" }]);
    await vi.waitFor(() => expect(client.getMenuStatus.mock.calls.length).toBe(statusReads + 2));
    expect(client.getMenuPreview.mock.calls.length).toBe(previews + 1);
    cleanupWidgets();

    const opened = api({ liveData: new LiveData() });
    const direct = await mountPreview(opened);
    await vi.waitFor(() =>
      expect(text(q(direct, '[data-test="menu-status"]'))).toBe(`Live: version 2 · 1 hour ago`),
    );
    expect(opened.getMenuStatus).not.toHaveBeenCalled();
  });

  it("publishes the hash it previewed, names the one menu, and says the new version is live", async () => {
    const client = api();
    const el = await mountPreview(client);
    expect(q(el, "dashboard-guest-menu-preview")).toBeNull();
    expect(text(inPanel(el, "publish"))).toBe("Publish now");
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
    expect(text(q(el, '[data-test="menu-status"]'))).toBe(`Live: version 3 · 30 minutes ago`);
  });

  it("shows the box's publish time in the header when the preview cannot be read again", async () => {
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
    expect(text(q(el, '[data-test="menu-status"]'))).toBe(`Live: version 3 · 55 minutes ago`);
    expect(inPanel(el, "live")).toBeNull();
    cleanupWidgets();

    // Answered with the version already live, as when that content was published already: its
    // own publication time stays.
    const again = api({
      publishMenu: vi
        .fn()
        .mockResolvedValue({ versionId: "v2", number: 2, publishedAt: PUBLISHED_AT }),
    });
    const kept = await mountPreview(again);
    again.getMenuPreview.mockRejectedValue(new Error("offline"));
    await publish(kept);
    await vi.waitFor(() => expect(inPanel(kept, "preview-error")).not.toBeNull());
    expect(text(q(kept, '[data-test="menu-status"]'))).toBe(`Live: version 2 · 1 hour ago`);
  });

  it("sends one publish while one is out", async () => {
    const out = deferred<Awaited<ReturnType<DashboardApi["publishMenu"]>>>();
    const client = api({ publishMenu: vi.fn(() => out.promise) });
    const el = await mountPreview(client);
    await publish(el);
    await publish(el);
    expect(client.publishMenu).toHaveBeenCalledTimes(1);
    out.resolve({ versionId: "v-lunch-3", number: 3, publishedAt: NEXT_PUBLISHED_AT });
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
        "Prices Burger €12.00 → €13.00 changed in Products, also on Dinner Menu",
      ),
    );
    expect(client.getMenuPreview.mock.calls.length).toBe(reads + 1);
    await publish(el);
    expect(client.publishMenu).toHaveBeenLastCalledWith("menu-lunch", "e".repeat(64));
  });

  it("names the set menu whose problems prevent publishing", async () => {
    const set = {
      id: "set-daily",
      name: "Daily menu",
      active: true,
      kind: "set_menu",
      setPrice: "14.00",
    };
    const client = api({
      listMenus: vi.fn().mockResolvedValue([...menus, set]),
      publishMenu: vi.fn().mockRejectedValue({
        code: "set_menu.not_publishable",
        status: 409,
        params: { menuId: set.id, count: 2 },
      }),
    });
    const el = await mountPreview(client);
    await publish(el);
    await vi.waitFor(() => {
      const result = text(inPanel(el, "result"));
      expect(result).toContain("Daily menu has 2 problems");
      expect(result).toContain("version 2 is still live");
    });
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
    expect(text(inPanel(el, "publish"))).toBe("Publish now");
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
    const published = deferred<Awaited<ReturnType<DashboardApi["publishMenu"]>>>();
    const client = api({ publishMenu: vi.fn(() => published.promise) });
    const el = await mountPreview(client);
    await publish(el);
    await click(el, "back");
    published.resolve({ versionId: "v-lunch-3", number: 3, publishedAt: NEXT_PUBLISHED_AT });
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
    const lunchOut = deferred<Awaited<ReturnType<DashboardApi["publishMenu"]>>>();
    const client = api({
      publishMenu: vi.fn((id: string) =>
        id === "menu-lunch"
          ? lunchOut.promise
          : Promise.resolve({ versionId: "v-d", number: 6, publishedAt: NEXT_PUBLISHED_AT }),
      ),
    });
    const el = await mountPreview(client);
    await publish(el);
    const button = () => inPanel(el, "publish") as HTMLElementTagNameMap["wt-button"] | null;
    expect(button()!.loading).toBe(true);
    history.pushState(null, "", "/menus/menu/menu-dinner/view/preview");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(button()?.loading).toBe(false));
    expect(text(button())).toBe("Publish now");
    await publish(el);
    expect(client.publishMenu).toHaveBeenLastCalledWith("menu-dinner", "c".repeat(64));
    await vi.waitFor(() =>
      expect(text(inPanel(el, "result"))).toBe("Dinner Menu version 6 is now live."),
    );
    history.back();
    await vi.waitFor(() => expect(button()?.loading).toBe(true));
    expect(text(button())).toBe("Publish now");
    expect(button()?.ariaDescription).toBe("Publishing Lunch Menu…");
    lunchOut.resolve({ versionId: "v-lunch-3", number: 3, publishedAt: NEXT_PUBLISHED_AT });
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
    history.pushState(null, "", "/menus/menu/menu-dinner/view/preview");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(inPanel(el, "no-changes")).not.toBeNull());
    lunchPreviewRead.resolve(lunchPreview());
    await new Promise((resolve) => setTimeout(resolve, 50));
    await el.updateComplete;
    expect(inPanel(el, "changes")).toBeNull();
    expect(inPanel(el, "warnings")).toBeNull();
    expect(text(inPanel(el, "publish"))).toBe("Publish now");
  });

  it("says there is nothing to publish when the menu matches its live version", async () => {
    const client = api({
      getMenuPreview: vi.fn().mockResolvedValue({
        ...lunchPreview(),
        changes: [],
        warnings: [],
        status: {
          state: "current",
          clashes: 0,
          version: 2,
          publishedAt: PUBLISHED_AT,
          hash: LUNCH_HASH,
        },
      } satisfies MenuPreview),
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

  async function wholeMenu(el: MenusScreen): Promise<string[]> {
    const tree = inPanel(el, "document")!.querySelector<MenuDocumentTree>(
      "dashboard-menu-document-tree",
    )!;
    await tree.updateComplete;
    const table = tree.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const all = table.shadowRoot!.querySelector<HTMLButtonElement>(".expand-all")!;
    if (all.textContent?.trim() === t("folders.expand_all")) all.click();
    await table.updateComplete;
    return [...table.shadowRoot!.querySelectorAll('[data-test="name"]')].map(text);
  }

  it("shows the whole menu as the publish would make it live, read-only, from the preview rather than the working structure", async () => {
    const el = await mountPreview();
    expect(text(inPanel(el, "document")!.querySelector("h2"))).toBe(
      "The menu as it will be published",
    );
    const tree = inPanel(el, "document")!.querySelector<MenuDocumentTree>(
      "dashboard-menu-document-tree",
    )!;
    expect(tree.document).toEqual(lunchDocument());
    expect(tree.view).toEqual({ kind: "customer", language: "es" });
    expect(await wholeMenu(el)).toEqual([
      "Burger para clientes",
      "Drinks para clientes",
      "Lemonade para clientes",
      "Chips para clientes",
    ]);
    expect((await wholeMenu(el)).join(" ")).not.toContain("Lager");
    expect((await wholeMenu(el)).join(" ")).not.toContain("Favourites");
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

describe("patching the live menu", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => setLocale("es-ES"));

  const PATCHED_AT = "2026-10-27T09:30:00.000Z";
  beforeEach(() => {
    clock.now = "2026-10-27T10:00:00.000Z";
    onTestFinished(() => {
      clock.now = "2026-09-26T11:30:00.000Z";
    });
  });
  const patched = {
    state: "changed" as const,
    clashes: 0,
    version: 3,
    publishedAt: PATCHED_AT,
    hash: "c".repeat(64),
  };

  const row = (el: MenusScreen, id = "menu-lunch") =>
    table(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
      `wt-row-actions:has([data-test="edit-${id}"])`,
    )!;
  const patch = (el: MenusScreen, id = "menu-lunch") =>
    row(el, id).querySelector<HTMLElement>(`[data-test="patch-${id}"]`);
  const dialog = (el: MenusScreen) =>
    q<HTMLElementTagNameMap["dashboard-menu-patch-dialog"]>(el, "dashboard-menu-patch-dialog")!;

  async function openPatch(el: MenusScreen, id = "menu-lunch") {
    await vi.waitFor(() => expect(patch(el, id)).not.toBeNull());
    row(el, id).show();
    await userEvent.click(patch(el, id)!);
    await vi.waitFor(() => expect(dialog(el).open).toBe(true));
  }

  function announcePatch(el: MenusScreen): void {
    dialog(el).dispatchEvent(new CustomEvent("wt-menu-patched", { bubbles: true, composed: true }));
  }

  it("offers Patch for live rows only and opens the chosen menu", async () => {
    const first = deferred<Record<string, MenuStatus>>();
    const client = api({
      getMenuStatuses: vi.fn().mockReturnValue(first.promise),
    });
    const el = await mount(client);
    expect(patch(el, "menu-dinner")).toBeNull();
    first.resolve({
      ...statuses(),
      "menu-lunch": { state: "unpublished", clashes: 0 },
    });
    await openPatch(el, "menu-dinner");
    expect(patch(el)).toBeNull();
    expect(dialog(el).menuId).toBe("menu-dinner");
    expect(dialog(el).menuName).toBe("Dinner Menu");
    expect(dialog(el).api).toBe(client);
    expect("takeawayVat" in dialog(el)).toBe(false);
  });

  it("offers no Patch when the list status read fails", async () => {
    const el = await mount(
      api({ getMenuStatuses: vi.fn().mockRejectedValue(new Error("offline")) }),
    );
    await vi.waitFor(() => expect(patch(el)).toBeNull());
    expect(patch(el, "menu-dinner")).toBeNull();
  });

  it.each([
    ["en", "/help/en/products#patch-live-menu"],
    ["es-ES", "/help/es/products#patch-live-menu"],
  ])("links to the %s guide from the Patch row", async (locale, href) => {
    setLocale(locale);
    const el = await mount(api());
    await vi.waitFor(() => expect(patch(el)).not.toBeNull());
    const tooltip = patch(el)!
      .closest("wt-menu-row")!
      .shadowRoot!.querySelector("wt-help-tooltip")!;
    expect(tooltip.getAttribute("guide-href")).toBe(href);
    expect(tooltip.getAttribute("aria-label")).toBe(t("menus.patch_live_help_label"));
  });

  it("keeps the filtered row and returns focus to its menu after patching", async () => {
    const initial = statuses();
    const current = { ...initial, "menu-lunch": { ...initial["menu-lunch"]!, state: "current" } };
    const client = api({ getMenuStatuses: vi.fn().mockResolvedValue(current) });
    const el = await mount(client);
    const filter = table(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      'wt-combobox[name="menu-status"]',
    )!;
    emit(filter, "wt-change", { value: "published" });
    await openPatch(el);
    const read = deferred<Record<string, MenuStatus>>();
    client.getMenuStatuses.mockReturnValue(read.promise);
    announcePatch(el);
    await el.updateComplete;
    expect(row(el)).not.toBeNull();
    const closed = new Promise<void>((resolve) =>
      dialog(el).addEventListener("wt-close", () => resolve(), { once: true }),
    );
    void dialog(el).shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
    await closed;
    await el.updateComplete;
    read.resolve({ ...initial, "menu-lunch": patched });
    await vi.waitFor(() =>
      expect(text(table(el).shadowRoot!.querySelector('[data-test="status-menu-lunch"]'))).toBe(
        "Published · 30 minutes ago",
      ),
    );
    expect(row(el).shadowRoot!.activeElement).toBe(row(el).shadowRoot!.querySelector("button"));
    expect(client.publishMenu).not.toHaveBeenCalled();
    expect(dialog(el).open).toBe(false);
    await openPatch(el);
  });

  it("reports a failed list read after a patch as a load failure", async () => {
    const client = api();
    const el = await mount(client);
    await openPatch(el);
    client.getMenuStatuses.mockRejectedValue(new Error("offline"));
    announcePatch(el);
    await vi.waitFor(() => expect(q(el, '[data-test="statuses-error"]')).not.toBeNull());
    expect(patch(el)).toBeNull();
    expect(q(el, '[data-test="member-error"]')).toBeNull();
  });

  it("leaves the list's Patch dialog closed when returning from an editor", async () => {
    const client = api();
    const el = await mount(client);
    await openPatch(el);
    const oldDialog = dialog(el);
    history.pushState(null, "", LUNCH_PATH);
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(text(q(el, "h1"))).toBe("Lunch Menu"));
    const listReads = client.getMenuStatuses.mock.calls.length;
    oldDialog.dispatchEvent(new CustomEvent("wt-menu-patched", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(client.getMenuStatuses).toHaveBeenCalledTimes(listReads);
    await click(el, "back");
    await vi.waitFor(() => expect(patch(el)).not.toBeNull());
    expect(dialog(el).open).toBe(false);
  });

  it("keeps the patch dialog open when a dialog inside it closes", async () => {
    const el = await mount(api());
    await openPatch(el);
    dialog(el).dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(dialog(el).open).toBe(true);
  });

  it("keeps the patch dialog's close inside the screen", async () => {
    const el = await mount(api());
    await openPatch(el);
    const outside = vi.fn();
    el.parentElement!.addEventListener("wt-close", outside);
    onTestFinished(() => el.parentElement?.removeEventListener("wt-close", outside));
    const closed = new Promise<void>((resolve) =>
      dialog(el).addEventListener("wt-close", () => resolve(), { once: true }),
    );
    void dialog(el).shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
    await closed;
    await el.updateComplete;
    expect(outside).not.toHaveBeenCalled();
  });

  it("shows the renumbered scheduled version on the Preview tab after a patch", async () => {
    const live = new LiveData();
    const edition = (versionId: string, number: number) => ({
      versionId,
      number,
      state: "queued" as const,
      activatesAt: "2030-01-01T11:00:00.000Z",
      queuedAt: "2026-10-26T08:00:00.000Z",
      cancelledAt: null,
      contentHash: "3".repeat(64),
      local: { date: "2030-01-01", time: "12:00", offset: "+01:00", repeated: false },
    });
    const client = api({
      liveData: live,
      getMenuPublications: vi.fn().mockResolvedValue({
        timeZone: "Europe/Madrid",
        live: null,
        editions: [edition("v-lunch-3", 3)],
      }),
    });
    const el = await mount(client, PREVIEW_PATH);
    const schedule = () =>
      q(el, "dashboard-menu-preview")!.shadowRoot!.querySelector<
        HTMLElementTagNameMap["dashboard-menu-publications"]
      >("dashboard-menu-publications")!;
    const version = (id: string) =>
      schedule()
        .shadowRoot!.querySelector('wt-data-table[data-test="editions"]')
        ?.shadowRoot?.querySelector(`[data-test="version-${id}"]`) ?? null;
    await vi.waitFor(() => expect(version("v-lunch-3")).not.toBeNull());
    client.getMenuPublications.mockResolvedValue({
      timeZone: "Europe/Madrid",
      live: null,
      editions: [edition("v-lunch-5", 5)],
    });
    live.invalidate([{ type: "menu_versions" }]);
    await vi.waitFor(() => expect(version("v-lunch-5")).not.toBeNull());
    expect(version("v-lunch-3")).toBeNull();
  });
});

describe("the Home page tab", () => {
  type Preview = HTMLElementTagNameMap["dashboard-device-home-preview"];

  function control(el: MenusScreen) {
    return q<HTMLElementTagNameMap["wt-segmented-control"]>(
      el,
      'wt-segmented-control[name="home-order"]',
    )!;
  }

  function preview(el: MenusScreen): Preview | null {
    return q<Preview>(el, "dashboard-device-home-preview");
  }

  /** Opens Lunch's Home page tab from its address and waits for its controls. */
  async function mountHome(client: Api = api()) {
    const el = await mount(client, HOME_PATH);
    await vi.waitFor(() => expect(control(el)).not.toBeNull());
    await control(el).updateComplete;
    return el;
  }

  it("puts the Home page tab between Structure and Preview, keeps it in the address, and reads the home and the preview only while it shows", async () => {
    const live = new LiveData();
    const client = api({ liveData: live });
    const el = await mount(client, LUNCH_PATH);
    const tabs = q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!;
    expect(tabs.items.map(({ key }) => key)).toEqual([
      "structure",
      "home",
      "preview",
      "customer-menu",
    ]);
    expect(tabs.items[1]!.label).toBe(t("menus.tab_home"));
    expect(client.getMenuHome).not.toHaveBeenCalled();
    expect(client.getMenuPreview).not.toHaveBeenCalled();
    await chooseTab(el, "home");
    expect(location.pathname).toBe(HOME_PATH);
    await vi.waitFor(() => expect(control(el)).not.toBeNull());
    expect(client.getMenuHome).toHaveBeenCalledWith("menu-lunch");
    expect(client.getMenuPreview).toHaveBeenCalledWith("menu-lunch");
    // The tab's state comes with the preview, as on the Preview tab, so no query of its own
    // repeats the read.
    await vi.waitFor(() => expect(preview(el)).not.toBeNull());
    const ownStatus = client.getMenuStatus.mock.calls.length;
    const shownPreviewReads = client.getMenuPreview.mock.calls.length;
    live.invalidate([{ type: "menus" }]);
    await vi.waitFor(() =>
      expect(client.getMenuPreview.mock.calls.length).toBe(shownPreviewReads + 1),
    );
    expect(client.getMenuStatus.mock.calls.length).toBe(ownStatus);
    await chooseTab(el, "structure");
    const homeReads = client.getMenuHome.mock.calls.length;
    const previewReads = client.getMenuPreview.mock.calls.length;
    live.invalidate([{ type: "menus" }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.getMenuHome.mock.calls.length).toBe(homeReads);
    expect(client.getMenuPreview.mock.calls.length).toBe(previewReads);
    history.back();
    await vi.waitFor(() => expect(tabs.value).toBe("home"));
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
    expect(control(el)).toBeNull();
    await click(el, "home-retry");
    await vi.waitFor(() => expect(control(el)).not.toBeNull());
    expect(q(el, '[data-test="home-load-error"]')).toBeNull();
  });

  it("says the home page is loading until it is read", async () => {
    const pending = deferred<MenuHome>();
    const client = api({ getMenuHome: vi.fn(() => pending.promise) });
    const el = await mount(client, HOME_PATH);
    await vi.waitFor(() => expect(q(el, '[data-test="home-loading"]')).not.toBeNull());
    expect(text(q(el, '[data-test="home-loading"]'))).toBe(t("home.loading"));
    expect(control(el)).toBeNull();
    pending.resolve(menuHome());
    await vi.waitFor(() => expect(control(el)).not.toBeNull());
  });

  it("never shows another menu's home after the person has gone to it", async () => {
    const lunchRead = deferred<MenuHome>();
    const dinner = emptyHome();
    dinner.order = "menu_first";
    const client = api({
      getMenuHome: vi.fn((id: string) =>
        id === "menu-lunch" ? lunchRead.promise : Promise.resolve(dinner),
      ),
    });
    const el = await mount(client, HOME_PATH);
    history.pushState(null, "", "/menus/menu/menu-dinner/view/home");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(client.getMenuHome).toHaveBeenCalledWith("menu-dinner"));
    await vi.waitFor(() => expect(control(el)?.value).toBe("menu_first"));
    lunchRead.resolve(menuHome());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(control(el).value).toBe("menu_first");
  });

  async function goToDinnerHome(el: MenusScreen, client: Api): Promise<void> {
    history.pushState(null, "", "/menus/menu/menu-dinner/view/home");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.waitFor(() => expect(client.getMenuHome).toHaveBeenCalledWith("menu-dinner"));
    await vi.waitFor(() => expect(control(el)?.value).toBe("menu_first"));
  }

  it.each(["save", "refusal"])(
    "keeps a late %s off a different menu's controls",
    async (outcome) => {
      const pending = deferred<Awaited<ReturnType<DashboardApi["saveMenuHome"]>>>();
      const client = api({
        getMenuHome: vi.fn(async () => ({
          ...menuHome(),
          order: "menu_first" as const,
        })),
      });
      const el = await mountHome(client);
      client.saveMenuHome.mockImplementationOnce(() => pending.promise);
      emit(control(el), "wt-change", { value: "home_first" });
      await el.updateComplete;
      q(el, '[data-test="home-save"]')!.click();
      expect(client.saveMenuHome).toHaveBeenCalledExactlyOnceWith("menu-lunch", {
        order: "home_first",
        shortcuts: menuHome().shortcuts.map(({ memberId, ref }) => ({ memberId, ref })),
      });
      await goToDinnerHome(el, client);
      const reads = client.getMenuHome.mock.calls.length;
      if (outcome === "save") pending.resolve({ ...menuHome(), dropped: [] });
      else pending.reject({ code: "server.internal" });
      await pending.promise.catch(() => undefined);
      await el.updateComplete;
      expect(control(el).disabled).toBe(false);
      expect(control(el).value).toBe("menu_first");
      expect(q(el, '[data-test="home-save"]')!.closest("wt-form-actions")!.error).toBeFalsy();
      expect(client.getMenuHome.mock.calls.length).toBe(reads);
    },
  );

  it("keeps the latest saved Home page when a Save and two reads answer out of order", async () => {
    const liveData = new LiveData();
    const menuWriteRevision = { epoch: "server", sequence: 1 };
    const client = api({ liveData, menuWriteRevision });
    const pending = deferred<Awaited<ReturnType<DashboardApi["saveMenuHome"]>>>();
    client.saveMenuHome.mockReturnValueOnce(pending.promise);
    const el = await mountHome(client);
    emit(control(el), "wt-change", { value: "menu_first" });
    await el.updateComplete;
    q(el, '[data-test="home-save"]')!.click();
    await vi.waitFor(() => expect(preview(el)?.busy).toBe(true));

    let sequence = 2;
    const newest = menuHome();
    newest.shortcuts[0]!.name = "New burger";
    client.getMenuRead.mockImplementation(async (id: string, parts: readonly MenuReadPart[]) => ({
      ...(await menuReadFixture(client, id, parts)),
      revision: { epoch: "server", sequence },
    }));
    client.getMenuHome.mockResolvedValue(newest);
    liveData.invalidate([{ type: "menus" }]);
    await vi.waitFor(() => expect(preview(el)!.shortcuts![0]!.name).toBe("New burger"));
    expect(control(el).value).toBe("menu_first");

    expect(preview(el)!.busy).toBe(true);

    const older = { ...menuHome(), order: "menu_first" as const };
    pending.resolve({ ...older, dropped: [] });
    await vi.waitFor(() => expect(preview(el)!.busy).toBe(false));
    expect(control(el).value).toBe("home_first");
    expect(preview(el)!.shortcuts![0]!.name).toBe("New burger");

    sequence = 1;
    client.getMenuHome.mockResolvedValue(older);
    client.getMenuPreview.mockResolvedValue(dinnerPreview());
    liveData.invalidate([{ type: "menus" }]);
    await vi.waitFor(() => expect(preview(el)!.document).toEqual(dinnerPreview().document));
    expect(control(el).value).toBe("home_first");
    expect(preview(el)!.shortcuts![0]!.name).toBe("New burger");
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
      write: "createMenu",
      path: "/menus",
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
      customerName: () =>
        inModal<HTMLElementTagNameMap["wt-input"]>(el, form.form, 'wt-input[name="names-es"]'),
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
    expect(save().disabled).toBe(true);
  });

  it.each(forms)(
    "$form focuses the name on an invalid Save, holds Save until it is fixed, and re-checks every change",
    async (form) => {
      const client = api();
      const { el, name, save, customerName } = await opened(form, client);
      await rename(el, customerName(), "Terraza");
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

  it.each(forms.filter(({ form }) => form === "menu-form"))(
    "$form focuses a refused name and leaves Save working",
    async (form) => {
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
    },
  );

  it.each(forms.filter(({ form }) => form === "menu-form"))(
    "$form leaves Save working after a refusal naming no field, and drops it on the next Save",
    async (form) => {
      const client = api({ [form.write]: vi.fn().mockRejectedValue({ code: "server.internal" }) });
      const { el, name, save, customerName } = await opened(form, client);
      await rename(el, customerName(), "Terraza");
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
    const { el, name, save, customerName } = await opened(form);
    await rename(el, customerName(), "Terraza");
    await rename(el, name(), "");
    save().click();
    await el.updateComplete;
    expect(name().error).toBe(t(form.required));
    await rename(el, customerName(), "");
    inModal(el, form.form, `[data-test="${form.form}-cancel"]`).click();
    await el.updateComplete;
    expect(modal(el, form.form).open).toBe(false);
    await form.open(el);
    await vi.waitFor(() => expect(modal(el, form.form).open).toBe(true));
    expect(name().error).toBe("");
    expect(await bottom(el, form.form)).toBe("");
    expect(save().disabled).toBe(true);
  });

  it.each(forms)("$form keeps no message once it is cancelled", async (form) => {
    const { el, name, save, customerName } = await opened(form);
    await rename(el, customerName(), "Terraza");
    await rename(el, name(), "");
    save().click();
    await el.updateComplete;
    expect(await bottom(el, form.form)).toBe(t("form.fix_fields"));
    await rename(el, customerName(), "");
    inModal(el, form.form, `[data-test="${form.form}-cancel"]`).click();
    await el.updateComplete;
    expect(modal(el, form.form).open).toBe(false);
    expect(await bottom(el, form.form)).toBe("");
  });
});

describe("the menus list just wider than its narrow layout", () => {
  it.each(["en-GB", "es-ES"])(
    "keeps every menu row's menu on screen and uncovered (600 px, %s)",
    async (locale) => {
      const longMenus: MenuSummary[] = [
        {
          id: "menu-lunch",
          name: "Weekday-lunch-menu-with-starters-main-and-cakes",
          active: true,
          kind: "menu",
          setPrice: null,
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
        const el = await mount(api({ listMenus: vi.fn().mockResolvedValue(longMenus) }));
        await vi.waitFor(async () => {
          await table(el).updateComplete;
          expect(table(el).shadowRoot.querySelectorAll("tbody tr")).toHaveLength(2);
          expect(
            [...table(el).shadowRoot.querySelectorAll("thead th")].map((th) => text(th)),
          ).toContain(t("menus.status"));
        });
        expectRowMenusOnScreen(table(el), longMenus.length, "wt-row-actions", false);
      } finally {
        setLocale(before);
        await page.viewport(width, height);
      }
    },
  );
});

it("saves the staged new section's names, image and colour in the same request as its placement", async () => {
  const client = api();
  const el = await mountLunch(client);
  await rowAction(el, "", "new-section");
  const details = {
    internalName: "Starters",
    names: { en: "To begin", es: "Para empezar" },
    image: "starters.png",
    color: "#aa3300",
  };
  emit(q(el, "dashboard-section-details-form")!, "wt-submit", details);
  await vi.waitFor(() => expect(modal(el, "new-section").open).toBe(false));
  expect(writeCalls(client)).toEqual([]);
  await saveStructure(el);
  const input = structureWrite(client);
  const section = input.sections.find(({ internalName }) => internalName === "Starters")!;
  expect(section).toEqual({ ...details, id: expect.any(String), members: [] });
  expect(input.rootMembers.at(-1)).toEqual({
    id: expect.any(String),
    ref: { kind: "section", sectionId: section.id },
  });
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
  await emptyAdd(el, "include-menu");
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
    expect(structure(el).nodes[0]).toMatchObject({
      ref: { kind: "section", sectionId: "drinks-root" },
      includedMenuId: "drinks",
      folder: { showAsFolder: true, overrides: {} },
    }),
  );
  expect(client.addSectionMember).not.toHaveBeenCalled();
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
  function includeClient(overrides: ApiOverrides = {}) {
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

  it("stages the chosen menu without a second action", async () => {
    const client = includeClient();
    const el = await mountLunch(client);
    await emptyAdd(el, "include-menu");
    const picker = inModal<Combobox>(el, "include", 'wt-combobox[name="included-menu"]');
    await chooseOption(picker, "wine-root");
    await vi.waitFor(() => expect(modal(el, "include").open).toBe(false));
    expect(writeCalls(client)).toEqual([]);
    expect(inModal(el, "include", '[data-test="include-save"]')).toBeNull();
    await saveStructure(el);
    expect(structureWrite(client).rootMembers).toEqual([
      {
        id: expect.any(String),
        ref: { kind: "section", sectionId: "wine-root" },
        folder: { showAsFolder: true, overrides: {} },
      },
    ]);
  });

  it("picks the menu from a required labelled dropdown, prompting a choice", async () => {
    const client = includeClient();
    const el = await mountLunch(client);
    await emptyAdd(el, "include-menu");
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
    expect(modal(el, "include").open).toBe(false);
    expect(structure(el).nodes[0]?.ref).toEqual({ kind: "section", sectionId: "wine-root" });
    expect(writeCalls(client)).toEqual([]);
  });

  it("closes an open list on Escape and leaves the dialog open", async () => {
    const el = await mountLunch(includeClient());
    await emptyAdd(el, "include-menu");
    const picker = inModal<Combobox>(el, "include", 'wt-combobox[name="included-menu"]');
    const list = picker.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
    expect(list.matches(":popover-open")).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(list.matches(":popover-open")).toBe(false);
    await el.updateComplete;
    expect(modal(el, "include").open).toBe(true);
    const closed = new Promise((resolve) =>
      modal(el, "include").addEventListener("wt-close", resolve, { once: true }),
    );
    await userEvent.keyboard("{Escape}");
    await closed;
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
    ["Evening", "/menus/menu/evening/view/structure"],
    ["Afternoon (1 clash)", "/menus/menu/afternoon/view/structure"],
  ]);
});

describe("review fix: inclusion target and validation", () => {
  function includeApi(overrides: ApiOverrides = {}) {
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

  it.each(["structure", "prices"] as const)(
    "keeps the last complete inclusion and the draft when its %s read is refused",
    async (refused) => {
      const live = new LiveData();
      const client = includeApi({ liveData: live });
      const getStructure = client.getMenuStructure.getMockImplementation()! as (
        id: string,
      ) => Promise<MenuStructure>;
      const getPrices = client.priceRows.getMockImplementation()!;
      let state = "initial";
      const source = () => ({
        ...lunchWith([productNode("m-wine-lager", "p-lager")]),
        root: {
          ...lunchWith([]).root,
          id: "wine-root",
          internalName: state === "initial" ? "Wines" : "Cellar",
        },
        rootSectionId: "wine-root",
      });
      client.getMenuStructure.mockImplementation(async (id: string) => {
        if (id !== "wine") return getStructure(id);
        if (state === "refused" && refused === "structure") throw { code: "connection.failed" };
        return source();
      });
      client.priceRows.mockImplementation(async (id: string) => {
        if (id === "wine" && state === "refused" && refused === "prices")
          throw { code: "connection.failed" };
        return getPrices(id);
      });
      const el = await mountLunch(client);
      await openInclude(el);
      const included = () =>
        structure(el).nodes.find(({ includedMenuId }) => includedMenuId === "wine");
      await vi.waitFor(() => expect(included()?.children?.[0]?.memberId).toBe("m-wine-lager"));
      const reads = client.getMenuRead.mock.calls.filter(([id]) => id === "wine").length;
      state = "refused";
      live.invalidate([{ type: "sections" }]);
      await vi.waitFor(() =>
        expect(
          client.getMenuRead.mock.calls.filter(([id]) => id === "wine").length,
        ).toBeGreaterThan(reads),
      );
      await new Promise(requestAnimationFrame);
      expect(included()?.internalName).toBe("Wines");
      expect(
        q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="structure-save"]')!.disabled,
      ).toBe(false);
      state = "recovered";
      live.invalidate([{ type: "sections" }]);
      await vi.waitFor(() => expect(included()?.internalName).toBe("Cellar"));
      expect(client.saveMenuStructure).not.toHaveBeenCalled();
    },
  );

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
  it("keeps an inclusion in its chosen section when a cycle is refused on Save", async () => {
    const client = includeApi({
      saveMenuStructure: vi.fn().mockRejectedValue({
        code: "menu_section.member_cycle",
        params: { field: "sections.0.members.3.ref" },
      }),
    });
    const el = await mountLunch(client);
    await editDrinks(el);
    await openInclude(el);
    expect(modal(el, "include").open).toBe(false);
    expect(writeCalls(client)).toEqual([]);
    const draft = structure(el).nodes[1]!.children!.at(-1)!;
    expect(draft.ref).toEqual({ kind: "section", sectionId: "wine-root" });
    await saveStructure(el);
    expect(structureWrite(client).sections[0]?.members.at(-1)?.id).toBe(draft.memberId);
    await vi.waitFor(() =>
      expect(text(rowOf(el, "m-drinks/" + draft.memberId))).toContain(
        codeMessage("menu_section.member_cycle"),
      ),
    );
    expect(
      q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="structure-save"]')!.disabled,
    ).toBe(false);
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
    placeableSetMenus: [],
    includable: [],
    includedBy: [],
  });
  async function rename(el: MenusScreen, id: string) {
    await table(el).updateComplete;
    table(el).shadowRoot!.querySelector<HTMLElement>(`[data-test="rename-${id}"]`)!.click();
    await el.updateComplete;
  }
  it("lets the manager try Rename again after the menu details failed to load", async () => {
    const client = api({
      getMenuStructure: vi
        .fn()
        .mockRejectedValueOnce({ code: "server.internal" })
        .mockResolvedValueOnce(details("lunch", "Lunch Menu")),
    });
    const el = await mount(client);
    await rename(el, "menu-lunch");
    await vi.waitFor(() => expect(q(el, '[data-test="load-error"]')).not.toBeNull());
    expect(modal(el, "menu-form").open).toBe(false);

    await click(el, "retry");
    await vi.waitFor(() => expect(q(el, '[data-test="load-error"]')).toBeNull());
    await rename(el, "menu-lunch");
    await vi.waitFor(() =>
      expect(modal(el, "menu-form").heading).toBe(
        t("menus.rename_heading").replace("{name}", "Lunch Menu"),
      ),
    );
    expect(
      inModal<HTMLElementTagNameMap["wt-input"]>(el, "menu-form", '[name="internalName"]').value,
    ).toBe("Lunch Menu");
  });

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
    "ignores an obsolete rename %s after Add menu",
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
    const { el } = await mountWidget<MenusScreen>(
      "dashboard-menus-screen",
      { api: client, now: () => new Date(clock.now) },
      theme,
    );
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
  const before = currentLocale();
  setLocale("en");
  onTestFinished(() => setLocale(before));
  const client = api({
    getMenuStatuses: vi.fn().mockResolvedValue({
      ...statuses(),
      "menu-lunch": { ...statuses()["menu-lunch"], clashes: 2 },
    }),
  });
  const el = await mount(client);
  await table(el).updateComplete;
  await vi.waitFor(() =>
    expect(text(table(el).shadowRoot.querySelector('[data-test="clashes-menu-lunch"]'))).toBe(
      "2 price clashes",
    ),
  );
});
describe("after the server comes back", () => {
  const down = { code: "connection.failed" };

  function failing(client: Api, ...names: (keyof Api)[]): () => void {
    const mocks = client as Record<keyof Api, ReturnType<typeof vi.fn>>;
    const reads = names.map((name) => [mocks[name], mocks[name].getMockImplementation()] as const);
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
      listMenus: vi.fn().mockResolvedValue(menus),
      listLibraryProducts: vi.fn().mockResolvedValue(products),
      listCategories: vi.fn().mockResolvedValue(categories),
    });
    const answer = failing(
      client,
      "listMenus",
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
    const answer = failing(client, "priceRows");
    const el = await mount(client, LUNCH_PATH);
    await vi.waitFor(() => expect(q(el, '[data-test="structure-error"]')).not.toBeNull());

    answer();
    live.refresh();

    await vi.waitFor(() => expect(structure(el)).not.toBeNull());
    expect(q(el, '[data-test="structure-error"]')).toBeNull();
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
    expect(
      q<HTMLElementTagNameMap["wt-segmented-control"]>(
        el,
        'wt-segmented-control[name="home-order"]',
      )?.value,
    ).toBe("home_first");
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

  it.each(["cancel", "save"] as const)(
    "returns focus to the section swatch after %s",
    async (action) => {
      const el = await mountLunch();
      await settleStructure(el);
      await userEvent.click(inStructure(el, '[data-test="color-m-drinks"]')!);
      await vi.waitFor(() => expect(modal(el, "new-section").open).toBe(true));
      const closed = dialogClosed(modal(el, "new-section"));
      if (action === "save") {
        type(inModal(el, "new-section", 'wt-input[name="name"]'), "Updated drinks");
        await el.updateComplete;
      }
      inModal(el, "new-section", `[data-test="new-section-${action}"]`).click();
      await closed;
      await vi.waitFor(() => expect(structure(el).busy).toBe(false));
      await afterDialogCloses(el);
      await settleStructure(el);
      expect(inStructure(el, '[data-test="color-m-drinks"]')!.matches(":focus")).toBe(true);
    },
  );

  it("paints the venue default on a product with nothing coloured above it, and follows a new default", async () => {
    const live = new LiveData();
    const client = api({
      liveData: live,
      listLibraryProducts: vi
        .fn()
        .mockResolvedValue(
          products.map((item) =>
            item.id === "p-burger" ? { ...item, categoryId: null, color: null } : item,
          ),
        ),
      getMenuSettings: vi
        .fn()
        .mockResolvedValue({ defaultProductVatClass: "general", defaultColor: "#b12525" }),
    });
    const el = await mountLunch(client);
    await settleStructure(el);
    const burgerChip = () =>
      inStructure(el, '[data-test="color-m-burger"] [part~="color-swatch"]')!;
    expect(getComputedStyle(burgerChip()).backgroundColor).toBe("rgb(177, 37, 37)");

    client.getMenuSettings.mockResolvedValue({
      defaultProductVatClass: "general",
      defaultColor: "#256bb1",
    });
    live.invalidate([{ type: "settings.menu" }]);
    await vi.waitFor(async () => {
      await settleStructure(el);
      expect(getComputedStyle(burgerChip()).backgroundColor).toBe("rgb(37, 107, 177)");
    });
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
    expect(q(el, '.heading [data-test="publish"]')).toBeNull();
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
    (["structure", "home", "shortcut"] as const).flatMap((view) =>
      (["before", "after"] as const).map((notification) => ({ view, notification })),
    ),
  )(
    "shares one HTTP menu read after an edit on $view when notified $notification the response",
    async ({ view, notification }) => {
      const fixture = api();
      let lunch = await fixture.getMenuStructure("menu-lunch");
      let home = menuHome();
      let sequence = 0;
      const reads: string[] = [];
      const writes: Array<{ path: string; body: unknown }> = [];
      const client = new DashboardApi("", async (path, init) => {
        if (init.method !== "GET") {
          sequence++;
          writes.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined });
          if (view === "structure")
            lunch = {
              ...lunch,
              nodes: lunch.nodes.filter(({ memberId }) => memberId !== "m-burger"),
            };
          else if (view === "shortcut")
            home = {
              ...home,
              shortcuts: home.shortcuts.filter(({ memberId }) => memberId !== "t-burger"),
            };
          else home = { ...home, order: "menu_first" };
          if (notification === "before") {
            client.liveData.invalidate([{ type: view === "home" ? "menus" : "section_members" }]);
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          const headers = {
            "x-waitron-menu-revision": JSON.stringify({ epoch: "test", sequence }),
          };
          return view === "structure"
            ? Response.json({ dropped: [] }, { headers })
            : Response.json({ ...home, dropped: [] }, { headers });
        }
        reads.push(path);
        const bodies: Record<string, () => unknown | Promise<unknown>> = {
          "/management-api/menus": () => menus,
          "/management-api/products": () => products,
          "/management-api/categories": () => categories,
          "/api/content-languages": () => ({ defaultLanguage: "es", languages: ["es", "en"] }),
          "/management-api/menus/status": () => statuses(),
          "/management-api/menus/menu-lunch/structure": () => lunch,
          "/management-api/menus/menu-lunch/prices": () => lunchPrices(),
          "/management-api/menus/menu-lunch/home": () => home,
          "/management-api/menus/menu-lunch/status": () => statuses()["menu-lunch"],
          "/management-api/menus/menu-lunch/preview": () => lunchPreview(),
        };
        const url = new URL(path, "http://localhost");
        if (url.pathname === "/management-api/menus/menu-lunch/read") {
          const entries = await Promise.all(
            url.searchParams.getAll("part").map(async (part) => {
              const read = bodies[`/management-api/menus/menu-lunch/${part}`];
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
      const homePreview = () =>
        q<HTMLElementTagNameMap["dashboard-device-home-preview"]>(
          el,
          "dashboard-device-home-preview",
        );
      await vi.waitFor(() => {
        expect(structure(el)).not.toBeNull();
        if (view === "structure") expect(rowOf(el, "m-burger")).not.toBeNull();
        else expect(q(el, 'wt-segmented-control[name="home-order"]')).not.toBeNull();
        if (view === "shortcut") expect(homePreview()?.shortcuts).toBeTruthy();
      });
      await structure(el).updateComplete;
      reads.length = 0;
      if (view === "structure") {
        emit(structure(el), "wt-member-remove", { path: [], memberId: "m-burger" });
        expect(writes).toEqual([]);
        await saveStructure(el);
      } else if (view === "shortcut") {
        emit(homePreview()!, "wt-shortcut-remove", { memberId: "t-burger" });
      } else {
        emit(q(el, 'wt-segmented-control[name="home-order"]')!, "wt-change", {
          value: "menu_first",
        });
      }
      if (view !== "structure") {
        expect(writes).toEqual([]);
        await el.updateComplete;
        q(el, '[data-test="home-save"]')!.click();
      }
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      // The stream notifies the screen of the accepted write's changed table.
      if (notification === "after")
        client.liveData.invalidate([{ type: view === "home" ? "menus" : "section_members" }]);
      await vi.waitFor(() => {
        if (view === "structure") {
          expect(structure(el).nodes.map(({ memberId }) => memberId)).toEqual([
            "m-drinks",
            "m-fav",
          ]);
          expect(structure(el).busy).toBe(false);
        } else if (view === "shortcut") {
          expect(homePreview()!.shortcuts!.map(({ memberId }) => memberId)).toEqual([
            "t-drinks",
            "t-chips",
          ]);
          expect(homePreview()!.busy).toBe(false);
        } else
          expect(
            q<HTMLElementTagNameMap["wt-segmented-control"]>(
              el,
              'wt-segmented-control[name="home-order"]',
            )!.value,
          ).toBe("menu_first");
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      const menuReads = reads.filter((path) =>
        path.startsWith("/management-api/menus/menu-lunch/"),
      );
      expect(writes[0]).toEqual(
        view === "structure"
          ? {
              path: "/management-api/menus/menu-lunch/structure",
              body: expect.objectContaining({
                rootMembers: [
                  { id: "m-drinks", ref: { kind: "section", sectionId: "s-drinks" } },
                  { id: "m-fav", ref: { kind: "section", sectionId: "s-fav" } },
                ],
              }),
            }
          : {
              path: "/management-api/menus/menu-lunch/home",
              body: {
                order: home.order,
                shortcuts: home.shortcuts.map(({ memberId, ref }) => ({ memberId, ref })),
              },
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

it("keeps the staged arrangement through a live read and shows the new arrangement after Cancel", async () => {
  const live = new LiveData();
  const client = api({ liveData: live });
  const host = await placementLeaveHost();
  const el = await mountLunch(client);
  await rowAction(el, "m-burger", "remove");
  await settleStructure(el);
  expect(topLevelKeys(el)).toEqual(["m-drinks", "m-fav"]);
  expect(q(el, '[data-test="unpublished-changes"]')).not.toBeNull();

  const [burger, drinks, favourites] = lunchNodes();
  client.getMenuStructure.mockResolvedValue(lunchWith([favourites!, burger!, drinks!]));
  client.getMenuStatus.mockResolvedValue({ state: "unpublished", clashes: 0 });
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() => expect(q(el, '[data-test="unpublished-changes"]')).toBeNull());
  await settleStructure(el);
  expect(topLevelKeys(el)).toEqual(["m-drinks", "m-fav"]);
  expect(host.leave.coordinator.isDirty([el])).toBe(true);

  await click(el, "structure-cancel");
  const question = host.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await vi.waitFor(() => expect(question.open).toBe(true));
  await userEvent.click(question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!);
  await vi.waitFor(() => expect(topLevelKeys(el)).toEqual(["m-fav", "m-burger", "m-drinks"]));
  expect(host.leave.coordinator.isDirty([el])).toBe(false);
});

for (const route of ["escape"] as const) {
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
    await userEvent.keyboard("{Escape}");
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
    await userEvent.keyboard("{Escape}");
    await host.updateComplete;
    await q.updateComplete;
    expect(q.open).toBe(true);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => modal(el, "add-products").open).toBe(false);
    expect(host.leave.coordinator.isDirty()).toBe(false);
  });
}
it("W69 Menu Add products reopened after Discard is a new picker, unchanged", async () => {
  const host = await placementLeaveHost();
  const el = await mountLunch(api());
  await editDrinks(el);
  await rowAction(el, "m-drinks", "open-add-products");
  const first = inModal<SectionAddProducts>(el, "add-products", "dashboard-section-add-products");
  await first.updateComplete;
  first.shadowRoot!.querySelector<HTMLInputElement>('input[value="p-chips"]')!.click();
  await first.updateComplete;
  first.querySelector<HTMLElement>("[data-test=add-products-cancel]")!.click();
  await host.updateComplete;
  const q = host.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  const closed = dialogClosed(modal(el, "add-products"));
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await closed;
  await rowAction(el, "m-drinks", "open-add-products");
  const second = inModal<SectionAddProducts>(el, "add-products", "dashboard-section-add-products");
  await second.updateComplete;
  expect(second).not.toBe(first);
  expect(
    second.shadowRoot!.querySelector<HTMLInputElement>('input[value="p-chips"]')!.checked,
  ).toBe(false);
  expect(host.leave.coordinator.isDirty()).toBe(false);
  const add =
    second.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=add]")!;
  expect(add.disabled).toBe(true);
  expect(add.variant).toBe("secondary");
});
it("W69 Menu Add products transfers dirty state from the picker to Structure", async () => {
  const host = await placementLeaveHost();
  const client = api();
  const el = await mountLunch(client);
  await editDrinks(el);
  await rowAction(el, "m-drinks", "open-add-products");
  const picker = inModal<SectionAddProducts>(el, "add-products", "dashboard-section-add-products");
  await picker.updateComplete;
  picker.shadowRoot!.querySelector<HTMLInputElement>('input[value="p-chips"]')!.click();
  await picker.updateComplete;
  await vi.waitFor(() => expect(host.leave.coordinator.isDirty([picker])).toBe(true));

  const closed = dialogClosed(modal(el, "add-products"));
  picker.shadowRoot!.querySelector<HTMLElement>("[data-test=add]")!.click();
  await closed;
  expect(host.leave.coordinator.isDirty([picker])).toBe(false);
  expect(host.leave.coordinator.isDirty([el])).toBe(true);
  expect(writeCalls(client)).toEqual([]);
  expect(structure(el).nodes[1]?.children?.at(-1)?.ref).toEqual({
    kind: "product",
    productId: "p-chips",
  });
  await saveStructure(el);
  await vi.waitFor(() => expect(host.leave.coordinator.isDirty()).toBe(false));
  expect(structureWrite(client).sections[0]?.members.at(-1)?.ref).toEqual({
    kind: "product",
    productId: "p-chips",
  });
});

it.each(["link", "keyboard", "address", "retry"])(
  "shows a clashing dish and its sections from the Preview %s",
  async (entry) => {
    const rows = lunchPrices();
    const lager = rows.find((row) => row.productId === "p-lager")!;
    const candidates = [
      { value: decimal("2.80"), place: { kind: "own_sections" }, source: { kind: "product" } },
      {
        value: decimal("3.00"),
        place: { kind: "menu", menuId: "drinks", menuName: "Drinks" },
        source: { kind: "own" },
      },
    ] as const;
    lager.combined = {
      ...lager.combined,
      price: { state: "clash", candidates: [...candidates] },
    };
    const value = lunchPreview();
    value.document = { ...value.document, menuId: "menu-lunch" };
    value.clashes = [
      { productId: "p-lager", variantId: null, field: "price", candidates: [...candidates] },
    ];
    const drinks = {
      ...drinksNode("included-drinks", "other-drinks-root"),
      includedMenuId: "drinks",
      ownerMenuId: "drinks",
      children: [productNode("other-lager", "p-lager")],
    };
    const client = api({
      priceRows: vi.fn(async (id: string) =>
        id === "drinks"
          ? [
              {
                ...lager,
                combined: combinedFixture("p-lager", "3.00", [], "3.00", "2.80", {}),
              },
            ]
          : rows,
      ),
      getMenuStructure: vi.fn(async (id: string) =>
        id === "drinks" ? lunchWith(drinks.children) : lunchWith([...lunchNodes(), drinks]),
      ),
      getMenuPreview: vi.fn(async () => value),
    });
    const destination = `${LUNCH_PATH}/filter/clashes`;
    const el = await mount(client, entry === "address" ? destination : PREVIEW_PATH);
    if (entry !== "address") {
      const link = await vi.waitFor(() => {
        const link = q(el, "dashboard-menu-preview")?.shadowRoot?.querySelector<HTMLAnchorElement>(
          '[data-test="clash-prices"]',
        );
        expect(link).toBeTruthy();
        return link!;
      });
      expect(link.getAttribute("href")).toBe(destination);
      if (entry === "retry") client.priceRows.mockRejectedValueOnce(new Error("down"));
      if (entry === "keyboard") {
        link.focus();
        await userEvent.keyboard("{Enter}");
      } else await userEvent.click(link);
      if (entry === "retry") {
        await vi.waitFor(() => expect(q(el, '[data-test="structure-error"]')).not.toBeNull());
        await click(el, "structure-retry");
      }
    }

    await vi.waitFor(() =>
      expect(
        structure(el).shadowRoot!.querySelector("wt-data-table")!.filterValues("price"),
      ).toEqual(["clashes"]),
    );
    expect(location.pathname).toBe(destination);
    await vi.waitFor(() => {
      expect(rowOf(el, "m-drinks")).not.toBeNull();
      expect(rowOf(el, "m-burger")).toBeNull();
    });
    await vi.waitFor(() => expect(rowOf(el, "m-drinks/m-beer/m-lager-2")).not.toBeNull());
    structure(el).shadowRoot!.querySelector("wt-data-table")!.chooseFilter("price", []);
    await vi.waitFor(() => expect(location.pathname).toBe(LUNCH_PATH));
    await vi.waitFor(() => expect(rowOf(el, "m-burger")).not.toBeNull());
  },
);

it.each([{ remembered: [] }, { remembered: ["own"] }])(
  "restores the remembered price filter $remembered after visiting a clash link",
  async ({ remembered }) => {
    const client = api();
    const el = await mountLunch(client);
    const priceTable = (screen: MenusScreen) =>
      structure(screen)?.shadowRoot?.querySelector("wt-data-table");
    await vi.waitFor(() => expect(priceTable(el)?.columns.length).toBeGreaterThan(0));
    priceTable(el)!.chooseFilter("price", remembered);

    const destination = `${LUNCH_PATH}/filter/clashes`;
    await visit(el, destination, "Lunch Menu");
    await vi.waitFor(() => expect(priceTable(el)?.filterValues("price")).toEqual(["clashes"]));
    priceTable(el)!.chooseFilter("available", ["yes"]);

    cleanupWidgets();
    const reopened = await mount(client, destination);
    await vi.waitFor(() =>
      expect(priceTable(reopened)?.filterValues("price")).toEqual(["clashes"]),
    );
    await visit(reopened, DINNER_PATH, "Dinner Menu");
    await vi.waitFor(() => {
      expect(priceTable(reopened)?.filterValues("price")).toEqual(remembered);
      expect(priceTable(reopened)?.filterValues("available")).toEqual(["yes"]);
    });
  },
);

it("remembers a manual price choice made after following a clash link", async () => {
  const el = await mount(api(), `${LUNCH_PATH}/filter/clashes`);
  const priceTable = () => structure(el)?.shadowRoot?.querySelector("wt-data-table");
  await vi.waitFor(() => expect(priceTable()?.filterValues("price")).toEqual(["clashes"]));
  priceTable()!.chooseFilter("price", ["own"]);
  await vi.waitFor(() => expect(location.pathname).toBe(LUNCH_PATH));
  await visit(el, DINNER_PATH, "Dinner Menu");
  await vi.waitFor(() => expect(priceTable()?.filterValues("price")).toEqual(["own"]));
});

it.each([
  ["/menus/filter/clashes", "/menus"],
  ["/menus/menu/menu-lunch/view/preview/filter/clashes", PREVIEW_PATH],
  [`${PRICES_PATH}/filter/clashes`, LUNCH_PATH],
])(
  "A349 removes a price-filter request that does not name a Structure destination: %s",
  async (path, wanted) => {
    await mount(api(), path);
    expect(location.pathname).toBe(wanted);
  },
);

it("A349 removes the explicit price-filter destination when returning to the menu list", async () => {
  const el = await mount(api(), `${LUNCH_PATH}/filter/clashes`);
  await click(el, "back");
  expect(location.pathname).toBe("/menus");
});

it.each(
  [390, 1280].flatMap((width) =>
    (["en-GB", "es-ES"] as const).flatMap((locale) =>
      (["light", "dark"] as const).map((theme) => ({ width, locale, theme })),
    ),
  ),
)("A461 visual Menus Structure $width $locale $theme", async ({ width, locale, theme }) => {
  registerIcons(DASHBOARD_ICONS);
  const before = currentLocale();
  setLocale(locale);
  onTestFinished(() => setLocale(before));
  await page.viewport(width, 844);
  onTestFinished(() => page.viewport(1280, 844));
  expect(window.innerWidth).toBe(width);
  const client = api({
    getMenuStructure: vi.fn().mockResolvedValue(
      lunchWith([
        productNode("m-burger", "p-burger"),
        { ...drinksNode("m-drinks"), internalName: "Drinks" },
        {
          ...drinksNode("long-copy", "s-long"),
          internalName: "Long section path " + "UnbrokenSection".repeat(8),
        },
      ]),
    ),
  });
  const el = await mount(client, LUNCH_PATH, theme);
  await vi.waitFor(() => expect(structure(el)).not.toBeNull());
  const settleView = async () => {
    await settleStructure(el);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  };
  const search = async (value: string) => {
    type(q(el, 'wt-input[name="structure-search"]')!, value);
    await settleStructure(el);
  };
  modeToggle(el).click();
  await settleStructure(el);
  await search("Lemonade");
  const boxes = allInStructure<HTMLInputElement>(el, "td.select input");
  expect(boxes.length).toBeGreaterThan(0);
  boxes[0]!.click();
  await settleView();
  await search("Drinks");
  expect(rowOf(el, "m-drinks")!.getAttribute("aria-expanded")).toBe("false");
  await settleView();
  await toggleRow(el, "m-drinks");
  expect(rowOf(el, "m-drinks/m-lemonade")).not.toBeNull();
  await settleView();
  await search("Burger");
  expect(structure(el).selected.length).toBe(1);
  await settleView();
  await search("zz-no-match");
  expect(allInStructure(el, "tbody tr[data-row-key]")).toHaveLength(0);
  await settleView();
  await search("");
  expect(structure(el).selected.length).toBe(1);
  expect(inStructure(el, '[part~="search-path"]')).toBeNull();
  await settleView();
});

it.each(["en", "es"])("A462 Structure has one Select mode in %s", async (locale) => {
  const before = currentLocale();
  setLocale(locale);
  onTestFinished(() => setLocale(before));
  const el = await mountLunch();
  const select = modeToggle(el);
  expect(select.getAttribute("aria-label")).toBe(locale === "es" ? "Seleccionar" : "Select");
  expect(q(el, '[data-test="reorder"]')).toBeNull();
  await userEvent.click(select);
  await settleStructure(el);
  expect(structure(el).selecting).toBe(true);
  expect(structure(el).reordering).toBe(true);
  expect(inStructure(el, '[data-test="select-m-burger"]')).not.toBeNull();
  expect(inStructure(el, '[data-test="drag-m-burger"]')).not.toBeNull();
  inStructure<HTMLInputElement>(el, '[data-test="select-m-burger"]')!.click();
  await settleStructure(el);
  expect(structure(el).selected).toEqual(["m-burger"]);
  q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="selection-done"]')!.click();
  await settleStructure(el);
  expect(structure(el).selected).toEqual([]);
  expect(structure(el).selecting).toBe(false);
  expect(structure(el).reordering).toBe(true);
  expect(inStructure(el, '[data-test="select-m-burger"]')).toBeNull();
  expect(inStructure(el, '[data-test="drag-m-burger"]')).not.toBeNull();
  expect(el.shadowRoot!.activeElement).toBe(modeHost(el));
  expect(modeHost(el).shadowRoot!.activeElement).toBe(select);
});

it("A462 Structure root updates editor without reopening the root", async () => {
  const shownKeys = (el: MenusScreen) =>
    allInStructure(el, "tbody tr[data-row-key]").map((row) => row.dataset.rowKey);
  const live = new LiveData();
  const client = api({ liveData: live });
  const el = await mountLunch(client);
  await editDrinks(el);
  await toggleRow(el, "m-drinks/m-beer");
  expect(currentPlace(el)).toBe("Lunch Menu › Drinks › Beer");
  const chevron = inStructure<HTMLButtonElement>(el, 'tr[data-row-key="root"] .tree-toggle');
  expect(chevron).not.toBeNull();
  chevron!.click();
  await settleStructure(el);
  expect(currentPlace(el)).toBe("Lunch Menu");
  expect(shownKeys(el)).toEqual(["root"]);
  expect(structure(el).current).toEqual([]);
  client.getMenuStructure.mockResolvedValue(lunchWith(lunchNodes().slice(1)));
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() => expect(client.getMenuStructure).toHaveBeenCalledTimes(2));
  await settleStructure(el);
  expect(shownKeys(el)).toEqual(["root"]);
  expect(structure(el).current).toEqual([]);
  inStructure<HTMLButtonElement>(el, 'tr[data-row-key="root"] .tree-toggle')!.click();
  await settleStructure(el);
  expect(shownKeys(el)).toEqual(["root", "m-drinks", "m-fav"]);
});

it.each(
  [390, 1280].flatMap((width) =>
    (["en", "es"] as const).flatMap((locale) =>
      (["light", "dark"] as const).map((theme) => ({ width, locale, theme })),
    ),
  ),
)("A462 Structure visual $width $locale $theme", async ({ width, locale, theme }) => {
  registerIcons(DASHBOARD_ICONS);
  const before = currentLocale();
  const previousTheme = document.documentElement.getAttribute("data-theme");
  setLocale(locale);
  document.documentElement.setAttribute("data-theme", theme);
  onTestFinished(() => {
    setLocale(before);
    if (previousTheme === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", previousTheme);
  });
  await page.viewport(width, 844);
  onTestFinished(() => page.viewport(1280, 844));
  expect(window.innerWidth).toBe(width);
  const el = await mount(api(), LUNCH_PATH, theme);
  await vi.waitFor(() => expect(structure(el)).not.toBeNull());
  const capture = async (state: string) => {
    await settleStructure(el);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    expect(document.scrollingElement!.scrollWidth).toBeLessThanOrEqual(width);
    const color = getComputedStyle(inStructure(el, '[data-test="root-name"]')!).color;
    expect(color).toBe(theme === "dark" ? "rgb(236, 238, 242)" : "rgb(35, 31, 32)");
    await expectNoA11yViolations(el.parentElement!);
    await page.screenshot({
      element: el,
      path: `__screenshots__/a462-task5/structure-${width}-${locale}-${theme}-${state}.png`,
    });
  };
  const select = modeToggle(el);
  select.focus();
  await userEvent.keyboard("{Enter}");
  await settleStructure(el);
  expect(structure(el).selecting).toBe(true);
  expect(structure(el).reordering).toBe(true);
  await capture("select");
  await editDrinks(el);
  await toggleRow(el, "m-drinks/m-beer");
  inStructure<HTMLButtonElement>(el, 'tr[data-row-key="root"] .tree-toggle')!.focus();
  await userEvent.keyboard("{Enter}");
  await settleStructure(el);
  expect(currentPlace(el)).toBe("Lunch Menu");
  expect(allInStructure(el, "tbody tr[data-row-key]").map((row) => row.dataset.rowKey)).toEqual([
    "root",
  ]);
  await capture("closed");
  const live = new LiveData();
  const client = api({ liveData: live });
  cleanupWidgets();
  const empty = await mount(client, LUNCH_PATH, theme);
  await vi.waitFor(() => expect(structure(empty)).not.toBeNull());
  client.getMenuStructure.mockResolvedValue(lunchWith([]));
  live.invalidate([{ type: "section_members" }]);
  await vi.waitFor(() => expect(structure(empty).nodes).toEqual([]));
  await settleStructure(empty);
  expect(structure(empty).selecting).toBe(false);
  expect(inStructure(empty, '[part~="drag-grip"]')).toBeNull();
  await expectNoA11yViolations(empty.parentElement!);
  await page.screenshot({
    element: empty,
    path: `__screenshots__/a462-task5/structure-${width}-${locale}-${theme}-empty.png`,
  });
});

describe("a name put into a sentence", () => {
  beforeEach(() => {
    const before = currentLocale();
    setLocale("en");
    onTestFinished(() => setLocale(before));
  });

  /** Lunch's structure with Drinks, wherever it sits, given `name` and `extra` below it. */
  function renameDrinks(client: Api, name: string, extra: MenuStructureNode[] = []): void {
    const read = client.getMenuStructure.getMockImplementation() as (
      id: string,
    ) => Promise<MenuStructure>;
    const rename = (nodes: MenuStructureNode[]): MenuStructureNode[] =>
      nodes.map((node) =>
        node.ref.kind === "section" && node.ref.sectionId === "s-drinks"
          ? { ...node, internalName: name, children: [...rename(node.children ?? []), ...extra] }
          : node.children
            ? { ...node, children: rename(node.children) }
            : node,
      );
    client.getMenuStructure.mockImplementation(async (id: string) => {
      const snapshot = await read(id);
      return { ...snapshot, nodes: rename(snapshot.nodes) };
    });
  }

  it("asks to remove a section whose name holds a replacement pattern as written", async () => {
    const client = api();
    renameDrinks(client, "Drinks $& {name}");
    const el = await mountLunch(client);
    await rowAction(el, "m-drinks", "delete");
    expect(text(modal(el, "delete-section").querySelector("p"))).toBe(
      "Remove Drinks $& {name} and its contents from this menu? Its products stay in the library.",
    );
  });

  it("heads the rename window with a menu name holding a replacement pattern as written", async () => {
    const client = api({
      listMenus: vi
        .fn()
        .mockResolvedValue(
          menus.map((menu) => (menu.id === "menu-lunch" ? { ...menu, name: "Lunch $&" } : menu)),
        ),
    });
    const el = await mount(client);
    await inTable(el, "rename-menu-lunch");
    expect(modal(el, "menu-form").heading).toBe("Rename Lunch $&");
  });

  it("heads the new-section window with a list name holding a replacement pattern as written", async () => {
    const client = api();
    renameDrinks(client, "Drinks $&");
    const el = await mountLunch(client);
    await rowAction(el, "m-drinks", "new-section");
    expect(modal(el, "new-section").heading).toBe("Add section to Drinks $&");
  });

  it("heads the add-products window with a list name holding a replacement pattern as written", async () => {
    const client = api();
    renameDrinks(client, "Drinks $&");
    const el = await mountLunch(client);
    await rowAction(el, "m-drinks", "open-add-products");
    expect(modal(el, "add-products").heading).toBe("Add products to Drinks $&");
  });

  it("says a list holding a replacement pattern was taken away as written", async () => {
    const live = new LiveData();
    const client = api({ liveData: live });
    renameDrinks(client, "Drinks $&");
    const el = await mountLunch(client);
    await toggleRow(el, "m-drinks");
    await vi.waitFor(() => expect(currentPlace(el)).toBe("Lunch Menu › Drinks $&"));
    await rowAction(el, "m-drinks", "new-section");
    await takeDrinksOff(el, client, live);
    await vi.waitFor(() => expect(modal(el, "new-section").open).toBe(false));
    expect(text(q(el, '[data-test="member-error"]'))).toBe(
      "Another change took Drinks $& away from where you were editing it, so its window was closed.",
    );
  });
});

it.each(
  [390, 1280].flatMap((width) =>
    (["en-GB", "es-ES"] as const).flatMap((locale) =>
      (["light", "dark"] as const).map((theme) => [width, locale, theme] as const),
    ),
  ),
)(
  "A728 Structure Select paints its pressed icon at %i px (%s, %s)",
  async (width, locale, theme) => {
    registerIcons(DASHBOARD_ICONS);
    const originalLocale = currentLocale();
    setLocale(locale);
    onTestFinished(() => setLocale(originalLocale));
    const original = [window.innerWidth, window.innerHeight] as const;
    await page.viewport(width, 844);
    onTestFinished(() => page.viewport(...original));
    expect(window.innerWidth).toBe(width);
    const el = await mountLunch();
    el.parentElement!.setAttribute("data-theme", theme);
    el.parentElement!.style.background = "var(--wt-color-bg)";
    const primary = document.createElement("span");
    primary.style.color = "var(--wt-color-primary-text)";
    el.parentElement!.append(primary);
    const button = modeToggle(el);
    const icon = button.querySelector("wt-icon")!;
    await icon.updateComplete;
    expect(icon.shadowRoot!.querySelector("path")).not.toBeNull();
    expect(getComputedStyle(icon).color).toBe(getComputedStyle(button).color);
    await userEvent.click(button);
    await vi.waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    await page.screenshot({
      path: `__screenshots__/a728/structure-${width}-${locale}-${theme}.png`,
    });
    expect(getComputedStyle(button).color).toBe(getComputedStyle(primary).color);
    expect(getComputedStyle(icon).color).toBe(getComputedStyle(button).color);
  },
);

const retirementLooks = (["en-GB", "es-ES"] as const).flatMap((locale) =>
  (["light", "dark"] as const).flatMap((theme) =>
    [390, 1280].map((width) => ({ locale, theme, width })),
  ),
);
it.each(retirementLooks)(
  "A182 LOOK retained menu Home page $locale $theme $width",
  async ({ locale, theme, width }) => {
    const previous = currentLocale();
    try {
      setLocale(locale);
      await page.viewport(width, 900);
      const el = await mount(api(), HOME_PATH, theme);
      await expect.poll(() => q(el, 'wt-segmented-control[name="home-order"]')).not.toBeNull();
      await expect.poll(() => q(el, "dashboard-device-home-preview")).not.toBeNull();
      expect(window.innerWidth).toBe(width);
      await page.screenshot({
        path: `__screenshots__/a182-menu-home/${locale}-${theme}-${width}.png`,
      });
      q(el, "dashboard-device-home-preview")!.scrollIntoView();
      await page.screenshot({
        path: `__screenshots__/a182-menu-home/${locale}-${theme}-${width}-bottom.png`,
      });
    } finally {
      setLocale(previous);
      await page.viewport(1280, 768);
    }
  },
);

it("drags a Structure row under held headings with its preview at the pointer", async () => {
  await page.viewport(1280, 800);
  onTestFinished(() => page.viewport(1280, 844));
  const client = api();
  const el = await mountLunch(client);
  await settleStructure(el);
  const host = el.parentElement!;
  host.style.cssText = "height:600px;container-type:size;margin-top:40px";
  host.style.setProperty("--wt-table-max", "210px");
  const widget = structure(el);
  const table = widget.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  const scroll = table.shadowRoot!.querySelector<HTMLElement>(".scroll")!;
  expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
  const from = inStructure<HTMLButtonElement>(el, '[data-test="drag-m-burger"]')!;
  from.scrollIntoView({ block: "nearest" });
  const start = from.getBoundingClientRect();
  const send = (type: string, x: number, y: number) =>
    from.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerId: 73,
        clientX: x,
        clientY: y,
      }),
    );
  send("pointerdown", start.left + 8, start.top + start.height / 2);
  const target = rowOf(el, "m-drinks")!.querySelector<HTMLElement>('[data-test="name"]')!;
  target.scrollIntoView({ block: "nearest" });
  const point = target.getBoundingClientRect();
  const x = point.left + 8,
    y = point.top + point.height / 2;
  send("pointermove", x, y);
  await widget.updateComplete;
  const ghost = widget.shadowRoot!.querySelector<HTMLElement>('[data-test="drag-ghost"]')!;
  expect(ghost.textContent).toContain("Burger");
  const rect = ghost.getBoundingClientRect();
  const style = getComputedStyle(ghost);
  expect(rect.left).toBeCloseTo(x + parseFloat(style.marginLeft), 0);
  expect(rect.top).toBeCloseTo(y + parseFloat(style.marginTop), 0);
  send("pointerup", x, y);
  await settleStructure(el);
  expect(topLevelKeys(el)).toEqual(["m-drinks", "m-fav"]);
  expect(structure(el).nodes[0]?.children?.at(-1)?.memberId).toBe("m-burger");
  await vi.waitFor(() => expect(rowOf(el, "m-drinks/m-burger")).not.toBeNull());
  expect(currentPlace(el)).toBe("Lunch Menu › Drinks");
  expect(writeCalls(client)).toEqual([]);
  expect(widget.shadowRoot!.querySelector('[data-test="drag-ghost"]')).toBeNull();
});

it.each(
  [390, 600, 700, 1280].flatMap((width) => ["en-GB", "es-ES"].map((locale) => ({ width, locale }))),
)(
  "fits menu names, status and live time before Actions ($width px, $locale)",
  async ({ width, locale }) => {
    await at([width, 844], locale, async () => {
      const el = await mount(
        api({
          listMenus: vi.fn().mockResolvedValue([
            {
              ...menus[0]!,
              name: "Weekday lunch from Monday to Friday with cakes and drinks included",
            },
            menus[1]!,
          ]),
        }),
      );
      await vi.waitFor(() => {
        const root = table(el).shadowRoot;
        expect(root.querySelectorAll("tbody tr")).toHaveLength(2);
        const scroll = root.querySelector<HTMLElement>(".scroll")!;
        expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
        expect(table(el).hasAttribute("wrap-to-fit")).toBe(true);
        expect([...root.querySelectorAll("thead th")].map((th) => text(th))).not.toContain(
          "Changes",
        );
        for (const row of root.querySelectorAll("tbody tr")) {
          const pinned = row.querySelector('td[data-pinned="end"]')!.getBoundingClientRect().left;
          for (const content of row.querySelectorAll(
            '[part~="name-text"], [part~="status"], [part~="time"]',
          )) {
            const range = document.createRange();
            range.selectNodeContents(content);
            for (const line of range.getClientRects())
              expect(line.right).toBeLessThanOrEqual(pinned + 1);
          }
        }
      });
    });
  },
);

it("marks Delete as destructive and removes the chosen menu after confirmation", async () => {
  const listMenus = vi.fn().mockResolvedValue(menus);
  const client = api({
    listMenus,
    getMenuDeleteImpact: vi
      .fn()
      .mockResolvedValue({ periods: [], dependants: [], defaultChoices: null, productCount: 0 }),
    deleteMenu: vi.fn(async () => {
      listMenus.mockResolvedValue(menus.filter(({ id }) => id !== "menu-lunch"));
    }),
  });
  const el = await mount(client);
  await table(el).updateComplete;
  const deleteAction = table(el).shadowRoot.querySelector<HTMLElementTagNameMap["wt-button"]>(
    '[data-test="delete-menu-lunch"]',
  )!;
  expect(deleteAction.variant).toBe("danger");
  expect(deleteAction.previousElementSibling?.tagName).toBe("HR");
  await inTable(el, "delete-menu-lunch");
  const dialog = el.shadowRoot!.querySelector("dashboard-menu-delete-dialog")!;
  expect(dialog.menu.id).toBe("menu-lunch");
  await vi.waitFor(() => expect(client.getMenuDeleteImpact).toHaveBeenCalledWith("menu-lunch"));
  const confirm =
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="delete"]')!;
  await vi.waitFor(() => expect(confirm.disabled).toBe(false));
  await userEvent.click(page.elementLocator(confirm.shadowRoot!.querySelector("button")!));
  await vi.waitFor(() =>
    expect(table(el).shadowRoot.querySelector('tr[data-row-key="menu-lunch"]')).toBeNull(),
  );
  expect(client.deleteMenu).toHaveBeenCalledWith("menu-lunch", { replacements: {} });
});

it("shows status checking while the Published filter is waiting for statuses", async () => {
  const el = await mount(api({ getMenuStatuses: vi.fn(() => new Promise(() => {})) }));
  const list = table(el);
  list.querySelector('wt-combobox[name="menu-status"]')!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "published" },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() =>
    expect(text(list.shadowRoot.querySelector(".empty"))).toContain(t("menus.status_loading")),
  );
});

it("starts on All and offers only the current menu status filters", async () => {
  const draft = { ...menus[0]!, id: "menu-draft", name: "Spring draft" };
  const clash = { ...menus[0]!, id: "menu-clash", name: "Late lunch" };
  const set = { ...menus[0]!, id: "menu-set", name: "Daily set", kind: "set_menu" };
  const el = await mount(
    api({
      listMenus: vi.fn().mockResolvedValue([...menus, draft, clash, set]),
      getMenuStatuses: vi.fn().mockResolvedValue({
        ...statuses(),
        [draft.id]: { state: "unpublished", clashes: 0 },
        [clash.id]: { ...statuses()["menu-dinner"], clashes: 1 },
      }),
    }),
  );
  const rows = () =>
    [...table(el).shadowRoot.querySelectorAll("tr[data-row-key]")]
      .map((r) => r.getAttribute("data-row-key"))
      .sort();
  await vi.waitFor(() =>
    expect(rows()).toEqual(["menu-clash", "menu-dinner", "menu-draft", "menu-lunch"]),
  );
  table(el).shadowRoot.querySelector<HTMLButtonElement>(".filters-trigger")!.click();
  await el.updateComplete;
  const filter = table(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    'wt-combobox[name="menu-status"]',
  );
  expect(filter).not.toBeNull();
  expect(filter!.value).toBe("all");
  expect(filter!.options.map(({ value }) => value)).toEqual(["all", "published", "attention"]);
  const choose = (value: string) =>
    filter!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  for (const [value, expected] of [
    ["published", ["menu-clash", "menu-dinner", "menu-lunch"]],
    ["attention", ["menu-clash", "menu-draft", "menu-lunch"]],
  ] as const) {
    choose(value);
    await vi.waitFor(() => expect(rows()).toEqual(expected));
  }
  const root = table(el).shadowRoot;
  expect(text(root.querySelector(".filters-trigger"))).toContain("1");
  root.querySelector<HTMLButtonElement>(".filters-clear-all")!.click();
  await vi.waitFor(() =>
    expect(rows()).toEqual(["menu-clash", "menu-dinner", "menu-draft", "menu-lunch"]),
  );
  expect(filter!.value).toBe("all");
});
