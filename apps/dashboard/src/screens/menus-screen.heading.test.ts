import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import { page } from "vitest/browser";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  menuDocument,
  mountWidget,
} from "../widgets/test-helpers.js";
import { MenusScreen } from "./menus-screen.js";
import type {
  CatalogueSummary,
  DashboardApi,
  MenuPreview,
  MenuStatus,
  MenuStructureNode,
  Product,
} from "../api/client.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { formatIsoMinute } from "../date-utils.js";

afterEach(cleanupWidgets);
beforeEach(() => sessionStorage.clear());
beforeEach(() => history.replaceState(null, "", "/manage/menus"));
beforeEach(() => {
  const before = currentLocale();
  setLocale("en");
  onTestFinished(() => setLocale(before));
});

const LIST_PATH = "/manage/menus";
const LUNCH_PATH = "/manage/menus/menu/menu-lunch/view/structure";
const PREVIEW_PATH = "/manage/menus/menu/menu-lunch/view/preview";
const PRICES_PATH = "/manage/menus/menu/menu-lunch/view/prices";
const PUBLISHED_AT = "2026-09-26T10:15:00.000Z";
const LIVE_WORDS = `(Live: version 2 · ${formatIsoMinute(PUBLISHED_AT)})`;

const burger = {
  id: "p-burger",
  name: "Burger",
  customerName: { es: "Hamburguesa" },
  kitchenName: "BURGER COCINA",
  categoryId: null,
  active: true,
  variants: [],
} as unknown as Product;

const nodes: MenuStructureNode[] = [
  { memberId: "m-burger", ref: { kind: "product", productId: "p-burger" } },
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

const CHANGED: MenuStatus = {
  state: "changed",
  clashes: 0,
  version: 2,
  publishedAt: PUBLISHED_AT,
  hash: "a".repeat(64),
};

function api(
  status: () => Promise<MenuStatus> = async () => CHANGED,
  menus: CatalogueSummary[] = [
    { id: "menu-lunch", name: "Lunch Menu", active: true, version: 1 },
    { id: "menu-dinner", name: "Dinner Menu", active: true, version: 1 },
  ],
): DashboardApi {
  const preview: MenuPreview = {
    live: null,
    clashes: [],
    hash: "b".repeat(64),
    changes: [],
    warnings: [],
    status: CHANGED,
    document: menuDocument([], {}),
  };
  return {
    listCatalogues: vi.fn().mockResolvedValue(menus),
    listLibraryProducts: vi.fn().mockResolvedValue([burger]),
    listCategories: vi.fn().mockResolvedValue([]),
    getCatalogueSettings: vi
      .fn()
      .mockResolvedValue({ defaultProductVatClass: "general", defaultColor: null }),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
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
    getMenuStatuses: vi.fn().mockResolvedValue({ "menu-lunch": CHANGED }),
    getMenuStatus: vi.fn(status),
    getMenuPreview: vi.fn(async () => ({ ...preview, status: await status() })),
    getMenuPrices: vi.fn().mockResolvedValue([]),
    getMenuPublications: vi
      .fn()
      .mockResolvedValue({ timeZone: "Europe/Madrid", live: null, editions: [] }),
  } as unknown as DashboardApi;
}

async function mount(client: DashboardApi = api(), path = LUNCH_PATH): Promise<MenusScreen> {
  history.replaceState(null, "", path);
  const { el } = await mountWidget<MenusScreen>("dashboard-menus-screen", { api: client });
  await vi.waitFor(() => {
    if (el.shadowRoot!.querySelector('[data-test="loading"], [data-test="structure-loading"]'))
      throw new Error("loading");
  });
  await el.updateComplete;
  return el;
}

function q<T extends Element = HTMLElement>(el: MenusScreen, selector: string): T | null {
  return el.shadowRoot!.querySelector<T>(selector);
}

function text(node: Element | null): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Every element matching `selector` in `root` and in every shadow root under it. */
function deepAll(root: ParentNode, selector: string): Element[] {
  const found = [...root.querySelectorAll(selector)];
  for (const host of root.querySelectorAll("*"))
    if (host.shadowRoot) found.push(...deepAll(host.shadowRoot, selector));
  return found;
}

/** The colour `token` resolves to where the screen is mounted, read off a probe painted with it. */
function resolved(el: MenusScreen, token: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  el.parentElement!.appendChild(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}

function trail(el: MenusScreen): HTMLElement {
  return q(el, '[data-test="menu-breadcrumb"]')!;
}

function menusLink(el: MenusScreen): HTMLAnchorElement {
  return q<HTMLAnchorElement>(el, '[data-test="menu-breadcrumb"] a')!;
}

/** Records whether each click reaching the window was prevented, then stops the test page itself
 * from navigating. */
function watchClicks(): boolean[] {
  const seen: boolean[] = [];
  const watch = (event: Event) => {
    seen.push(event.defaultPrevented);
    event.preventDefault();
  };
  window.addEventListener("click", watch);
  onTestFinished(() => window.removeEventListener("click", watch));
  return seen;
}

const MODIFIERS = ["ctrlKey", "metaKey", "shiftKey", "altKey"] as const;

function modifiedClick(target: Element, modifier: (typeof MODIFIERS)[number]): void {
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, [modifier]: true }),
  );
}

describe("the menu editor's heading", () => {
  it("puts a path landmark holding one link, Menus ›, above the menu's name, left-aligned, at normal text size in the link colour", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    onTestFinished(() => page.viewport(width, height));
    await page.viewport(1280, 900);
    const el = await mount();
    const nav = trail(el);
    expect(nav.tagName).toBe("NAV");
    expect(nav.getAttribute("aria-label")).toBe(t("menus.menu_trail"));
    expect(t("menus.menu_trail")).toBe("Path to this menu");
    const links = nav.querySelectorAll("a");
    expect(links).toHaveLength(1);
    const link = links[0]!;
    expect(text(link)).toBe(t("menus.title"));
    expect(text(link)).toBe("Menus");
    expect(text(nav.querySelector(".sep"))).toBe("›");
    expect(nav.querySelector(".sep")!.getAttribute("aria-hidden")).toBe("true");
    expect(link.getAttribute("href")).toBe(LIST_PATH);
    expect(link.dataset.test).toBe("back");
    const style = getComputedStyle(link);
    expect(style.textDecorationLine).toContain("underline");
    expect(style.color).toBe(resolved(el, "--wt-color-primary-text"));
    expect(style.fontSize).toBe(getComputedStyle(el).fontSize);
    expect(getComputedStyle(nav.querySelector(".sep")!).color).toBe(
      resolved(el, "--wt-color-primary-text"),
    );

    const headings = el.shadowRoot!.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    const h1 = headings[0]!;
    expect(text(h1)).toBe("Lunch Menu");
    expect(nav.contains(h1)).toBe(false);
    const a = nav.getBoundingClientRect();
    const b = h1.getBoundingClientRect();
    expect(a.bottom, "the path sits above the name").toBeLessThanOrEqual(b.top + 1);
    expect(Math.abs(link.getBoundingClientRect().left - b.left)).toBeLessThanOrEqual(1);
  });

  it("draws the menu's name at the size of the Menus list's heading", async () => {
    const list = await mount(api(), LIST_PATH);
    await vi.waitFor(() => expect(q(list, '[data-test="menus"]')).not.toBeNull());
    const listSize = getComputedStyle(q(list, "h1")!).fontSize;
    cleanupWidgets();
    const el = await mount();
    expect(text(q(el, "h1"))).toBe("Lunch Menu");
    expect(getComputedStyle(q(el, "h1")!).fontSize).toBe(listSize);
  });

  it("names the path and its link in Spanish", async () => {
    setLocale("es-ES");
    const el = await mount();
    expect(trail(el).getAttribute("aria-label")).toBe("Ruta hasta esta carta");
    expect(text(menusLink(el))).toBe("Cartas");
  });

  it("adds no other heading naming the menu, and names its landmark unlike any other", async () => {
    const el = await mount();
    await vi.waitFor(() => expect(q(el, "dashboard-menu-structure-table")).not.toBeNull());
    const tabs = q(el, "wt-tabs")!;
    const outside = deepAll(el.shadowRoot!, "h1, h2, h3, h4, h5, h6, [role='heading']").filter(
      (heading) => !tabs.contains(heading),
    );
    expect(outside.filter((heading) => text(heading) === "Lunch Menu")).toHaveLength(1);
    const name = trail(el).getAttribute("aria-label");
    expect(name).toBeTruthy();
    // The path is the page's one navigation landmark, and nothing else that is named (the tree's
    // table, the tabs) carries its name.
    expect(deepAll(el.shadowRoot!, "nav, [role='navigation']")).toEqual([trail(el)]);
    const others = deepAll(el.shadowRoot!, "[aria-label]")
      .filter((named) => named !== trail(el))
      .map((named) => named.getAttribute("aria-label"));
    expect(others).toContain(t("menus.tree_heading"));
    expect(others).not.toContain(name);
  });

  it("goes back to the menus list on a plain click on Menus, keeping the browser from following the link", async () => {
    const seen = watchClicks();
    const el = await mount();
    menusLink(el).click();
    await el.updateComplete;
    expect(seen).toEqual([true]);
    expect(location.pathname).toBe(LIST_PATH);
    await vi.waitFor(() => expect(q(el, '[data-test="menus"]')).not.toBeNull());
    expect(q(el, '[data-test="menu-breadcrumb"]')).toBeNull();
  });

  it.each(MODIFIERS)("leaves a click on Menus with %s held to the browser", async (modifier) => {
    const seen = watchClicks();
    const el = await mount();
    modifiedClick(menusLink(el), modifier);
    await el.updateComplete;
    expect(seen).toEqual([false]);
    expect(location.pathname).toBe(LUNCH_PATH);
    expect(text(q(el, "h1"))).toBe("Lunch Menu");
  });

  /** The Preview tab's button in the editor's tab row. */
  function previewTab(el: MenusScreen): HTMLButtonElement {
    return q(el, "wt-tabs")!.shadowRoot!.querySelector<HTMLButtonElement>(
      '[role="tab"][data-key="preview"]',
    )!;
  }

  it("marks the Preview tab with a star while the menu has unpublished changes, and draws no link for them", async () => {
    const el = await mount();
    await vi.waitFor(() => expect(previewTab(el).querySelector(".mark")).not.toBeNull());
    expect(text(previewTab(el))).toBe("Preview*");
    expect(previewTab(el).getAttribute("aria-label")).toBe("Preview, unpublished changes");
    expect(deepAll(el.shadowRoot!, '[data-test="status-changes"]')).toEqual([]);
    expect(text(q(el, '[data-test="menu-status"]'))).not.toContain("Unpublished changes");
    expect(q(el, '[data-test="menu-status"] a')).toBeNull();
  });

  it("names the starred Preview tab in Spanish", async () => {
    setLocale("es-ES");
    const el = await mount();
    await vi.waitFor(() => expect(previewTab(el).querySelector(".mark")).not.toBeNull());
    expect(text(previewTab(el))).toBe("Vista previa*");
    expect(previewTab(el).getAttribute("aria-label")).toBe("Vista previa, cambios sin publicar");
  });

  it.each([
    ["Structure", LUNCH_PATH],
    ["Preview", PREVIEW_PATH],
  ])("draws the starred Preview tab in the primary colour on the %s tab", async (_tab, path) => {
    const el = await mount(api(), path);
    await vi.waitFor(() => expect(previewTab(el).querySelector(".mark")).not.toBeNull());
    expect(getComputedStyle(previewTab(el)).color).toBe(resolved(el, "--wt-color-primary-text"));
  });

  it("sits the live version in brackets beside the name, on the heading's line, in normal text", async () => {
    const width = window.innerWidth,
      height = window.innerHeight;
    onTestFinished(() => page.viewport(width, height));
    await page.viewport(1280, 900);
    const el = await mount();
    await vi.waitFor(() => expect(text(q(el, '[data-test="menu-status"]'))).toBe(LIVE_WORDS));
    const words = q(el, '[data-test="menu-status"]')!;
    const h1 = q(el, "h1")!;
    expect(h1.contains(words)).toBe(false);
    expect(text(h1)).toBe("Lunch Menu");
    const a = h1.getBoundingClientRect();
    const b = words.getBoundingClientRect();
    expect(a.top < b.bottom && b.top < a.bottom, "the name and its version share a line").toBe(
      true,
    );
    expect(b.left).toBeGreaterThanOrEqual(a.right);
    const style = getComputedStyle(words);
    expect(style.fontSize).toBe(getComputedStyle(el).fontSize);
    expect(style.fontWeight).toBe("400");
    expect(style.color).toBe(resolved(el, "--wt-color-text-muted"));
  });

  it("words the live version in Spanish", async () => {
    setLocale("es-ES");
    const el = await mount();
    await vi.waitFor(() =>
      expect(text(q(el, '[data-test="menu-status"]'))).toBe(
        `(Publicada: versión 2 · ${formatIsoMinute(PUBLISHED_AT)})`,
      ),
    );
  });

  const never = () => new Promise<MenuStatus>(() => undefined);
  it.each([
    [
      "published and current",
      async (): Promise<MenuStatus> => ({ ...CHANGED, state: "current" }),
      `(Live: version 2 · ${formatIsoMinute(PUBLISHED_AT)})`,
    ],
    [
      "never published",
      async (): Promise<MenuStatus> => ({ state: "unpublished", clashes: 0 }),
      "(Unpublished)",
    ],
    ["still being checked", never, "(Checking…)"],
    [
      "not checkable",
      async (): Promise<MenuStatus> => Promise.reject(new Error("offline")),
      "(Could not be checked)",
    ],
  ])("leaves the Preview tab unstarred while the menu is %s", async (_state, status, words) => {
    const el = await mount(api(status));
    await vi.waitFor(() => expect(text(q(el, '[data-test="menu-status"]'))).toBe(words));
    expect(q(el, '[data-test="menu-status"] a')).toBeNull();
    expect(previewTab(el).querySelector(".mark")).toBeNull();
    expect(previewTab(el).hasAttribute("aria-label")).toBe(false);
    expect(text(previewTab(el))).toBe("Preview");
  });

  it("keeps the star on the Preview tab while it is the tab shown", async () => {
    const el = await mount(api(), PREVIEW_PATH);
    await vi.waitFor(() => expect(text(q(el, '[data-test="menu-status"]'))).toBe(LIVE_WORDS));
    expect(q(el, '[data-test="menu-status"] a')).toBeNull();
    expect(previewTab(el).getAttribute("aria-selected")).toBe("true");
    expect(text(previewTab(el))).toBe("Preview*");
  });

  const clashWords = (el: MenusScreen) =>
    q(el, '[data-test="menu-clashes"] [data-test="status-clashes"]');
  it.each([
    ["Prices", PRICES_PATH, "en", 1, "Publishing waits on 1 clash"],
    ["Prices", PRICES_PATH, "en", 3, "Publishing waits on 3 clashes"],
    ["Prices", PRICES_PATH, "es-ES", 1, "No se puede publicar hasta resolver 1 conflicto"],
    ["Prices", PRICES_PATH, "es-ES", 3, "No se puede publicar hasta resolver 3 conflictos"],
    ["Preview", PREVIEW_PATH, "en", 1, "Publishing waits on 1 clash"],
    ["Preview", PREVIEW_PATH, "en", 3, "Publishing waits on 3 clashes"],
    ["Preview", PREVIEW_PATH, "es-ES", 1, "No se puede publicar hasta resolver 1 conflicto"],
    ["Preview", PREVIEW_PATH, "es-ES", 3, "No se puede publicar hasta resolver 3 conflictos"],
  ])(
    "says on the %s tab at %s, in %s, that publishing waits on %i clash(es), in red",
    async (_tab, path, locale, clashes, words) => {
      setLocale(locale);
      const el = await mount(
        api(async () => ({ ...CHANGED, clashes })),
        path,
      );
      await vi.waitFor(() => expect(clashWords(el)).not.toBeNull());
      expect(text(clashWords(el))).toBe(words);
      expect(text(q(el, '[data-test="menu-clashes"]'))).toBe(words);
      expect(text(q(el, '[data-test="menu-status"]'))).not.toContain(words);
      expect(getComputedStyle(clashWords(el)!).color).toBe(resolved(el, "--wt-color-danger"));
    },
  );

  it.each([
    ["Structure", LUNCH_PATH],
    ["Preview", PREVIEW_PATH],
  ])(
    "makes the clash words a link to the Prices tab on the %s tab, underlined in red",
    async (_tab, path) => {
      const el = await mount(
        api(async () => ({ ...CHANGED, clashes: 2 })),
        path,
      );
      await vi.waitFor(() => expect(clashWords(el)).not.toBeNull());
      const link = clashWords(el)!;
      expect(link.tagName).toBe("A");
      expect(link.getAttribute("href")).toBe(PRICES_PATH);
      expect(text(link)).toBe("Publishing waits on 2 clashes");
      const style = getComputedStyle(link);
      expect(style.textDecorationLine).toContain("underline");
      expect(style.color).toBe(resolved(el, "--wt-color-danger"));
    },
  );

  it("draws the clash words as plain words on the Prices tab, which they would only open again", async () => {
    const el = await mount(
      api(async () => ({ ...CHANGED, clashes: 2 })),
      PRICES_PATH,
    );
    await vi.waitFor(() => expect(clashWords(el)).not.toBeNull());
    expect(text(clashWords(el))).toBe("Publishing waits on 2 clashes");
    expect(clashWords(el)!.closest("a")).toBeNull();
    expect(clashWords(el)!.querySelector("a")).toBeNull();
  });

  it("opens the Prices tab on a plain click on the clash words", async () => {
    const seen = watchClicks();
    const el = await mount(api(async () => ({ ...CHANGED, clashes: 2 })));
    await vi.waitFor(() => expect(clashWords(el)).not.toBeNull());
    clashWords(el)!.click();
    await el.updateComplete;
    expect(seen).toEqual([true]);
    expect(location.pathname).toBe(PRICES_PATH);
    expect(q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!.value).toBe("prices");
  });

  it.each(MODIFIERS)(
    "leaves a click on the clash words with %s held to the browser",
    async (modifier) => {
      const seen = watchClicks();
      const el = await mount(api(async () => ({ ...CHANGED, clashes: 2 })));
      await vi.waitFor(() => expect(clashWords(el)).not.toBeNull());
      modifiedClick(clashWords(el)!, modifier);
      await el.updateComplete;
      expect(seen).toEqual([false]);
      expect(location.pathname).toBe(LUNCH_PATH);
      expect(q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!.value).toBe("structure");
    },
  );

  it.each([
    ["Prices", PRICES_PATH],
    ["Preview", PREVIEW_PATH],
  ])("says nothing about clashes on the %s tab while none is left", async (_tab, path) => {
    const el = await mount(api(), path);
    await vi.waitFor(() => expect(text(q(el, '[data-test="menu-status"]'))).toBe(LIVE_WORDS));
    expect(clashWords(el)).toBeNull();
    expect(q(el, '[data-test="menu-clashes"]')).toBeNull();
  });

  it("reads the clashes again on the Prices tab when a price override changes", async () => {
    let clashes = 0;
    const client = api(async () => ({ ...CHANGED, clashes }));
    const live = new LiveData();
    // A live re-read asks for every part in one request, as the server's read route answers it.
    Object.assign(client, {
      liveData: live,
      getMenuRead: async (id: string, parts: readonly ("structure" | "status")[]) =>
        Object.fromEntries(
          await Promise.all(
            parts.map(async (part) => [
              part,
              {
                status: 200,
                body: await (part === "status"
                  ? client.getMenuStatus(id)
                  : client.getMenuStructure(id)),
              },
            ]),
          ),
        ),
    });
    const el = await mount(client, PRICES_PATH);
    await vi.waitFor(() => expect(text(q(el, '[data-test="menu-status"]'))).toBe(LIVE_WORDS));
    clashes = 2;
    live.invalidate([{ type: "menu_item_variant_overrides" }]);
    await vi.waitFor(() => expect(text(clashWords(el))).toBe("Publishing waits on 2 clashes"));
    clashes = 0;
    const reads = vi.mocked(client.getMenuStatus).mock.calls.length;
    // A table no read on this screen depends on. A re-read starts in a microtask (`#schedule`,
    // packages/dashboard-kit/src/live-data.ts), so one would have started by the next task.
    live.invalidate([{ type: "printers" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(vi.mocked(client.getMenuStatus).mock.calls.length).toBe(reads);
    expect(text(clashWords(el))).toBe("Publishing waits on 2 clashes");
    live.invalidate([{ type: "menu_items" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vi.mocked(client.getMenuStatus).mock.calls.length).toBeGreaterThan(reads);
    await vi.waitFor(() => expect(clashWords(el)).toBeNull());
    expect(text(q(el, '[data-test="menu-status"]'))).toBe(LIVE_WORDS);
  });

  /** Mounts a menu named `name` at phone width, putting the viewport back afterwards. */
  async function onPhone(name: string): Promise<MenusScreen> {
    const width = window.innerWidth,
      height = window.innerHeight;
    onTestFinished(() => page.viewport(width, height));
    await page.viewport(390, 844);
    return mount(api(undefined, [{ id: "menu-lunch", name, active: true, version: 1 }]));
  }

  it("keeps the path above a long menu name inside a phone's width without scrolling sideways", async () => {
    const name = "The weekend brunch and late lunch menu served on the terrace until four";
    const el = await onPhone(name);
    const heading = q(el, "h1")!;
    expect(text(heading)).toBe(name);
    expect(document.scrollingElement!.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    const h1 = heading.getBoundingClientRect();
    const path = trail(el).getBoundingClientRect();
    expect(h1.right).toBeLessThanOrEqual(window.innerWidth);
    expect(path.right).toBeLessThanOrEqual(window.innerWidth);
    expect(h1.top, "the name sits under the path").toBeGreaterThanOrEqual(path.bottom - 1);
  });

  it("breaks a menu name in one word longer than the phone is wide inside the heading", async () => {
    const el = await onPhone(`Terraza${"brunch".repeat(12)}`);
    const tree = q<HTMLElementTagNameMap["dashboard-menu-structure-table"]>(
      el,
      "dashboard-menu-structure-table",
    )!;
    await tree.updateComplete;
    await tree.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "wt-data-table",
    )!.updateComplete;
    expect(document.scrollingElement!.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    const heading = q(el, "h1")!;
    expect(heading.scrollWidth).toBeLessThanOrEqual(heading.clientWidth);
    expect(heading.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
  });
});

it.each(["light", "dark"] as const)(
  "drops an unverified Preview clash count after a failed live read and restores a fresh count (%s)",
  async (theme) => {
    const live = new LiveData();
    let clashes = 2;
    let failed = false;
    const client = api(async () => {
      if (failed) throw { code: "server.internal" };
      return { ...CHANGED, clashes };
    });
    Object.assign(client, {
      liveData: live,
      getMenuRead: async (id: string, parts: readonly ("structure" | "preview")[]) => {
        if (failed) throw { code: "server.internal" };
        return Object.fromEntries(
          await Promise.all(
            parts.map(async (part) => [
              part,
              {
                status: 200,
                body: await (part === "preview"
                  ? client.getMenuPreview(id)
                  : client.getMenuStructure(id)),
              },
            ]),
          ),
        );
      },
    });
    history.replaceState(null, "", PREVIEW_PATH);
    const { el, host } = await mountWidget<MenusScreen>(
      "dashboard-menus-screen",
      { api: client },
      theme,
    );
    const heading = () => text(q(el, '[data-test="menu-status"]'));
    const clashLine = () => text(q(el, '[data-test="menu-clashes"]'));
    await vi.waitFor(() => expect(clashLine()).toBe("Publishing waits on 2 clashes"));
    failed = true;
    live.invalidate([{ type: "products" }]);
    const panel = () => q(el, "dashboard-menu-preview")!.shadowRoot!;
    await vi.waitFor(() =>
      expect(panel().querySelector('[data-test="preview-error"]')).not.toBeNull(),
    );
    expect(q(el, '[data-test="status-clashes"]')).toBeNull();
    expect(heading()).toBe(LIVE_WORDS);
    expect(text(panel().querySelector('[data-test="preview-error"]'))).toBe(
      "The changes could not be worked out.",
    );
    await expectNoA11yViolations(host);
    failed = false;
    clashes = 3;
    live.invalidate([{ type: "products" }]);
    await vi.waitFor(() => expect(clashLine()).toBe("Publishing waits on 3 clashes"));
    expect(panel().querySelector('[data-test="preview-error"]')).toBeNull();
    await expectNoA11yViolations(host);
  },
);
