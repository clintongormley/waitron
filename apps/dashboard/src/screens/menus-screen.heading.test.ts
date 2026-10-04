import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, menuDocument, mountWidget } from "../widgets/test-helpers.js";
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
const PUBLISHED_AT = "2026-09-26T10:15:00.000Z";
const CHANGED_LINE = `Unpublished changes · Live: version 2 · ${formatIsoMinute(PUBLISHED_AT)}`;

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
    getMenuPreview: vi.fn().mockResolvedValue(preview),
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

function statusLink(el: MenusScreen): HTMLAnchorElement | null {
  return q<HTMLAnchorElement>(el, '[data-test="menu-status"] [data-test="status-changes"]');
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
  it("leads with a path landmark holding one link, Menus, then the menu's name on the same line", async () => {
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
    expect(link.getAttribute("href")).toBe(LIST_PATH);
    expect(link.dataset.test).toBe("back");
    const style = getComputedStyle(link);
    expect(style.textDecorationLine).toContain("underline");
    expect(style.color).toBe(resolved(el, "--wt-color-primary-text"));

    const headings = el.shadowRoot!.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    const h1 = headings[0]!;
    expect(text(h1)).toBe("Lunch Menu");
    expect(nav.contains(h1)).toBe(false);
    const a = link.getBoundingClientRect();
    const b = h1.getBoundingClientRect();
    expect(a.top < b.bottom && b.top < a.bottom, "the link and the name share a line").toBe(true);
    expect(a.right).toBeLessThanOrEqual(b.left);
  });

  it("names the path and its link in Spanish", async () => {
    setLocale("es-ES");
    const el = await mount();
    expect(trail(el).getAttribute("aria-label")).toBe("Ruta hasta esta carta");
    expect(text(menusLink(el))).toBe("Cartas");
  });

  it("adds no other heading naming the menu, and names its landmark unlike any other", async () => {
    const el = await mount();
    // The in-panel breadcrumb is still on the Structure tab, so the names are compared with it there.
    expect(q(el, '[data-test="breadcrumb"]')).not.toBeNull();
    const tabs = q(el, "wt-tabs")!;
    const outside = deepAll(el.shadowRoot!, "h1, h2, h3, h4, h5, h6, [role='heading']").filter(
      (heading) => !tabs.contains(heading),
    );
    expect(outside.filter((heading) => text(heading) === "Lunch Menu")).toHaveLength(1);
    const name = trail(el).getAttribute("aria-label");
    const others = deepAll(el.shadowRoot!, "nav, [role='navigation']")
      .filter((landmark) => landmark !== trail(el))
      .map((landmark) => landmark.getAttribute("aria-label"));
    expect(others.length).toBeGreaterThan(0);
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

  it("makes Unpublished changes a link to the Preview tab, worded as before", async () => {
    const el = await mount();
    await vi.waitFor(() => expect(statusLink(el)).not.toBeNull());
    const link = statusLink(el)!;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(PREVIEW_PATH);
    expect(text(link)).toBe("Unpublished changes");
    expect(text(q(el, '[data-test="menu-status"]'))).toBe(CHANGED_LINE);
    const style = getComputedStyle(link);
    expect(style.textDecorationLine).toContain("underline");
    expect(style.color).toBe(resolved(el, "--wt-color-primary-text"));
  });

  it("keeps the state line's height when its label becomes a link, while giving the link a tap target's height", async () => {
    const plain = await mount(api(async () => ({ ...CHANGED, state: "current" })));
    await vi.waitFor(() => expect(q(plain, '[data-test="menu-status"] .time')).not.toBeNull());
    const plainHeight = q(plain, '[data-test="menu-status"]')!.getBoundingClientRect().height;
    cleanupWidgets();
    const el = await mount();
    await vi.waitFor(() => expect(statusLink(el)).not.toBeNull());
    expect(q(el, '[data-test="menu-status"]')!.getBoundingClientRect().height).toBe(plainHeight);
    const tapMin = parseFloat(getComputedStyle(el).getPropertyValue("--wt-tap-min"));
    expect(statusLink(el)!.getBoundingClientRect().height).toBeGreaterThanOrEqual(tapMin);
  });

  it("opens the Preview tab on a plain click on Unpublished changes", async () => {
    const seen = watchClicks();
    const el = await mount();
    await vi.waitFor(() => expect(statusLink(el)).not.toBeNull());
    statusLink(el)!.click();
    await el.updateComplete;
    expect(seen).toEqual([true]);
    expect(location.pathname).toBe(PREVIEW_PATH);
    expect(q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!.value).toBe("preview");
  });

  it.each(MODIFIERS)(
    "leaves a click on Unpublished changes with %s held to the browser",
    async (modifier) => {
      const seen = watchClicks();
      const el = await mount();
      await vi.waitFor(() => expect(statusLink(el)).not.toBeNull());
      modifiedClick(statusLink(el)!, modifier);
      await el.updateComplete;
      expect(seen).toEqual([false]);
      expect(location.pathname).toBe(LUNCH_PATH);
      expect(q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!.value).toBe("structure");
    },
  );

  const never = () => new Promise<MenuStatus>(() => undefined);
  it.each([
    [
      "published and current",
      async (): Promise<MenuStatus> => ({ ...CHANGED, state: "current" }),
      `Published · Version 2 · ${formatIsoMinute(PUBLISHED_AT)}`,
    ],
    [
      "never published",
      async (): Promise<MenuStatus> => ({ state: "unpublished", clashes: 0 }),
      "Unpublished",
    ],
    ["still being checked", never, "Checking…"],
    [
      "not checkable",
      async (): Promise<MenuStatus> => Promise.reject(new Error("offline")),
      "Could not be checked",
    ],
  ])("draws no link while the menu is %s", async (_state, status, words) => {
    const el = await mount(api(status));
    await vi.waitFor(() => expect(text(q(el, '[data-test="menu-status"]'))).toBe(words));
    expect(q(el, '[data-test="menu-status"] a')).toBeNull();
  });

  it("draws no link on the Preview tab, which it would only open again", async () => {
    const el = await mount(api(), PREVIEW_PATH);
    await vi.waitFor(() => expect(text(q(el, '[data-test="menu-status"]'))).toBe(CHANGED_LINE));
    expect(q(el, '[data-test="menu-status"] a')).toBeNull();
  });

  /** Mounts a menu named `name` at phone width, putting the viewport back afterwards. */
  async function onPhone(name: string): Promise<MenusScreen> {
    const width = window.innerWidth,
      height = window.innerHeight;
    onTestFinished(() => page.viewport(width, height));
    await page.viewport(390, 844);
    return mount(api(undefined, [{ id: "menu-lunch", name, active: true, version: 1 }]));
  }

  it("wraps the path and a long menu name at phone width without scrolling sideways", async () => {
    const name = "The weekend brunch and late lunch menu served on the terrace until four";
    const el = await onPhone(name);
    const heading = q(el, "h1")!;
    expect(text(heading)).toBe(name);
    expect(document.scrollingElement!.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    const h1 = heading.getBoundingClientRect();
    const path = trail(el).getBoundingClientRect();
    expect(h1.right).toBeLessThanOrEqual(window.innerWidth);
    expect(path.right).toBeLessThanOrEqual(window.innerWidth);
    expect(h1.top, "the name wraps onto the line under the path").toBeGreaterThanOrEqual(
      path.bottom - 1,
    );
  });

  // The Structure tab's list panel, which Task 4 of W88 replaces, still widens the page for such a
  // word on its own, so this holds the heading alone.
  it("breaks a menu name in one word longer than the phone is wide inside the heading", async () => {
    const el = await onPhone(`Terraza${"brunch".repeat(12)}`);
    const heading = q(el, "h1")!;
    expect(heading.scrollWidth).toBeLessThanOrEqual(heading.clientWidth);
    expect(heading.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
  });
});
