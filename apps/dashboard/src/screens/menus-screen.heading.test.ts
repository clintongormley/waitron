import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { NavigationGuard } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import { page, userEvent } from "vitest/browser";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  menuDocument,
  menuReadFixture,
  mountWidget,
} from "../widgets/test-helpers.js";
import { MenusScreen } from "./menus-screen.js";
import type { DashboardApi, MenuPreview, MenuStatus, Product } from "../api/client.js";
import type { MenuReadPart, MenuSummary, MenuStructureNode } from "../api/menu-api.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";

afterEach(cleanupWidgets);
beforeEach(() => sessionStorage.clear());
beforeEach(() => history.replaceState(null, "", "/menus"));
beforeEach(() => {
  const before = currentLocale();
  setLocale("en");
  onTestFinished(() => setLocale(before));
});

const LIST_PATH = "/menus";
const LUNCH_PATH = "/menus/menu/menu-lunch/view/structure";
const PREVIEW_PATH = "/menus/menu/menu-lunch/view/preview";
const PUBLISHED_AT = "2026-09-26T10:15:00.000Z";
/** The screen's clock, 1 hour 15 minutes after PUBLISHED_AT. */
const NOW = "2026-09-26T11:30:00.000Z";
const LIVE_WORDS = "Live: version 2 · 1 hour ago";

const burger = {
  id: "p-burger",
  name: "Burger",
  customerName: { es: "Hamburguesa" },
  kitchenName: "BURGER KITCHEN",
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
  menus: MenuSummary[] = [
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
  ],
): DashboardApi {
  const preview: MenuPreview = {
    setMenuProblems: [],
    live: null,
    clashes: [],
    hash: "b".repeat(64),
    changes: [],
    warnings: [],
    status: CHANGED,
    document: menuDocument([], {}),
  };
  return {
    listMenus: vi.fn().mockResolvedValue(menus),
    listLibraryProducts: vi.fn().mockResolvedValue([burger]),
    listCategories: vi.fn().mockResolvedValue([]),
    getMenuSettings: vi
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
    getMenuRead(id: string, parts: readonly MenuReadPart[]) {
      return menuReadFixture(this as DashboardApi, id, parts);
    },
    getMenuPreview: vi.fn(async () => ({ ...preview, status: await status() })),
    getMenuPublications: vi
      .fn()
      .mockResolvedValue({ timeZone: "Europe/Madrid", live: null, editions: [] }),
  } as unknown as DashboardApi;
}

async function mount(
  client: DashboardApi = api(),
  path = LUNCH_PATH,
  waitForStructure = true,
): Promise<MenusScreen> {
  history.replaceState(null, "", path);
  const { el } = await mountWidget<MenusScreen>("dashboard-menus-screen", {
    api: client,
    now: () => new Date(NOW),
  });
  await vi.waitFor(() => {
    if (
      el.shadowRoot!.querySelector(
        waitForStructure
          ? '[data-test="loading"], [data-test="structure-loading"]'
          : '[data-test="loading"]',
      )
    )
      throw new Error("loading");
  });
  await el.updateComplete;
  return el;
}

function q<T extends Element = HTMLElement>(el: MenusScreen, selector: string): T | null {
  return el.shadowRoot!.querySelector<T>(selector);
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
  it("puts a path landmark holding one link, Menus ›, beside the menu's name at normal text size in the link colour", async () => {
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
    expect(a.top).toBeLessThan(b.bottom);
    expect(a.bottom).toBeGreaterThan(b.top);
    expect(a.right).toBeLessThanOrEqual(b.left);
  });

  it("draws the menu's name at the size of the Menus list's heading", async () => {
    const [width, height] = [window.innerWidth, window.innerHeight];
    onTestFinished(() => page.viewport(width, height));
    await page.viewport(1280, 900);
    const list = await mount(api(), LIST_PATH);
    await vi.waitFor(() => expect(q(list, '[data-test="menus"]')).not.toBeNull());
    const listHeading = q(list, "h1")!;
    const listSize = getComputedStyle(listHeading).fontSize;
    const listHeight = listHeading.parentElement!.getBoundingClientRect().height;
    cleanupWidgets();
    const el = await mount();
    expect(text(q(el, "h1"))).toBe("Lunch Menu");
    expect(getComputedStyle(q(el, "h1")!).fontSize).toBe(listSize);
    expect(q(el, ".heading")!.getBoundingClientRect().height).toBeCloseTo(listHeight, 0);
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

  it.each([
    ["en", "Unpublished changes", "Review and publish", "Preview"],
    ["es-ES", "Cambios sin publicar", "Revisar y publicar", "Vista previa"],
  ])(
    "shows unpublished changes and opens Preview from the heading in %s",
    async (locale, cue, action, tab) => {
      setLocale(locale);
      const el = await mount();
      await vi.waitFor(() => expect(text(q(el, '[data-test="unpublished-changes"]'))).toBe(cue));
      expect(text(previewTab(el))).toBe(tab);
      const review = q(el, '.heading [data-test="review-publish"]')!;
      expect(text(review)).toBe(action);
      expect(review.getAttribute("variant")).toBe("primary");
      review.focus();
      await userEvent.keyboard("{Enter}");
      await vi.waitFor(() => expect(location.pathname).toBe(PREVIEW_PATH));
      await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(q(el, "h1")));
    },
  );

  it("sits the live version beside the name, on the heading's line, in normal text", async () => {
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
      expect(text(q(el, '[data-test="menu-status"]'))).toBe("Publicada: versión 2 · hace 1 hora"),
    );
  });

  const never = () => new Promise<MenuStatus>(() => undefined);
  it.each([
    [
      "published and current",
      async (): Promise<MenuStatus> => ({ ...CHANGED, state: "current" }),
      LIVE_WORDS,
    ],
    ["still being checked", never, "Checking…"],
    [
      "not checkable",
      async (): Promise<MenuStatus> => Promise.reject(new Error("offline")),
      "Could not be checked",
    ],
  ])(
    "offers no review or unpublished-change cue while the menu is %s",
    async (_state, status, words) => {
      const el = await mount(api(status), LUNCH_PATH, status !== never);
      await vi.waitFor(() => expect(text(q(el, '[data-test="menu-status"]'))).toBe(words));
      expect(q(el, '[data-test="menu-status"] a')).toBeNull();
      expect(q(el, '[data-test="review-publish"]')).toBeNull();
      expect(q(el, '[data-test="unpublished-changes"]')).toBeNull();
    },
  );

  it.each([
    ["holding products and sections", nodes],
    ["holding nothing at all", []],
  ])("offers review without a change cue on a menu never published, %s", async (_, held) => {
    const client = api(async () => ({ state: "unpublished", clashes: 0 }));
    vi.mocked(client.getMenuStructure).mockResolvedValue({
      ...(await client.getMenuStructure("menu-lunch")),
      nodes: held,
    });
    const el = await mount(client);
    await vi.waitFor(() => expect(text(q(el, '[data-test="menu-status"]'))).toBe("Unpublished"));
    expect(q(el, '[data-test="review-publish"]')).not.toBeNull();
    expect(q(el, '[data-test="unpublished-changes"]')).toBeNull();
  });

  it.each([
    [390, "en"],
    [390, "es-ES"],
    [1280, "en"],
    [1280, "es-ES"],
  ] as const)(
    "puts Publish later before Publish now in the heading at %i px in %s",
    async (width, locale) => {
      const [beforeWidth, beforeHeight] = [window.innerWidth, window.innerHeight];
      onTestFinished(() => page.viewport(beforeWidth, beforeHeight));
      await page.viewport(width, 900);
      setLocale(locale);
      const el = await mount(api(), PREVIEW_PATH);
      const later = () => q(el, '.heading [data-test="schedule-open"]');
      await vi.waitFor(() => expect(text(later())).toBe(t("menu_publications.schedule")));
      const now = q(el, '.heading [data-test="publish"]')!;
      expect(text(now)).toBe(t("menu_preview.publish"));
      const a = later()!.getBoundingClientRect();
      const b = now.getBoundingClientRect();
      expect(a.right).toBeLessThanOrEqual(b.left);
      expect(a.top).toBeLessThan(b.bottom);
      expect(b.top).toBeLessThan(a.bottom);
      expect(q(el, '[data-test="review-publish"]')).toBeNull();
      const schedule = q(el, "dashboard-menu-preview")!.shadowRoot!.querySelector(
        "dashboard-menu-publications",
      )!;
      await page.elementLocator(later()!).click();
      const dialog = schedule.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
        '[data-test="schedule-dialog"]',
      );
      await vi.waitFor(() => expect(dialog?.open).toBe(true));
      const closed = new Promise<void>((resolve) =>
        dialog!.addEventListener("wt-close", () => resolve(), { once: true }),
      );
      void dialog!.requestClose("cancel");
      await closed;
      await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(later()));
    },
  );

  it.each([false, true])(
    "restores focus after a live refresh and Escape (read failed: %s)",
    async (failedFirst) => {
      const live = new LiveData();
      const client = api();
      const publishMenu = vi.fn();
      let failed = false;
      const getMenuRead = vi.fn(async (id: string) => {
        if (failed) throw { code: "server.internal" };
        return {
          structure: { status: 200, body: await client.getMenuStructure(id) },
          preview: { status: 200, body: await client.getMenuPreview(id) },
        };
      });
      Object.assign(client, { liveData: live, getMenuRead, publishMenu });
      const el = await mount(client, PREVIEW_PATH);
      const later = () => q(el, '[data-test="schedule-open"]');
      await vi.waitFor(() => expect(later()).not.toBeNull());
      const opener = later()!;
      opener.focus();
      await userEvent.keyboard("{Enter}");
      const preview = q<HTMLElementTagNameMap["dashboard-menu-preview"]>(
        el,
        "dashboard-menu-preview",
      )!;
      const publications = preview.shadowRoot!.querySelector("dashboard-menu-publications")!;
      const dialog = () =>
        publications.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
          '[data-test="schedule-dialog"]',
        );
      await vi.waitFor(() => expect(dialog()?.open).toBe(true));
      if (failedFirst) {
        failed = true;
        live.invalidate([{ type: "menu_items" }]);
        await vi.waitFor(() => expect(later()).toBeNull());
        failed = false;
      }
      const old = preview.preview;
      live.invalidate([{ type: "menu_items" }]);
      await vi.waitFor(() => {
        expect(preview.preview).not.toBe(old);
        expect(later()).not.toBeNull();
      });
      await publications.updateComplete;
      const closed = new Promise<void>((resolve) =>
        dialog()!.addEventListener("wt-close", () => resolve(), { once: true }),
      );
      await userEvent.keyboard("{Escape}");
      await closed;
      await vi.waitFor(() =>
        expect(el.shadowRoot!.activeElement).toBe(failedFirst ? q(el, "h1") : later()),
      );
      await userEvent.keyboard("{Enter}");
      if (!failedFirst) {
        expect(later()).toBe(opener);
        await vi.waitFor(() => expect(dialog()?.open).toBe(true));
      }
      expect(publishMenu).not.toHaveBeenCalled();
    },
  );

  const clash: MenuPreview["clashes"][number] = {
    productId: "p-burger",
    variantId: null,
    field: "price",
    candidates: [],
  };
  const problem: MenuPreview["setMenuProblems"][number] = {
    menuId: "daily",
    name: "Daily menu",
    problems: [{ kind: "no_lines" }],
  };
  it.each([
    ["a set menu has problems", { setMenuProblems: [problem] }],
    ["prices clash", { clashes: [clash], status: { ...CHANGED, clashes: 1 } }],
  ] satisfies [string, Partial<MenuPreview>][])(
    "keeps both publish actions disabled when %s",
    async (_, blockers) => {
      const client = api();
      const read = client.getMenuPreview;
      client.getMenuPreview = async (id) => ({ ...(await read(id)), ...blockers });
      const el = await mount(client, PREVIEW_PATH);
      for (const action of ["schedule-open", "publish"]) {
        const button = () => q<HTMLElementTagNameMap["wt-button"]>(el, `[data-test="${action}"]`);
        await vi.waitFor(() => expect(button()?.disabled).toBe(true));
        expect(button()?.ariaDescription).toBe("See Fix before publishing in Preview.");
      }
      expect(q(el, '[data-test="menu-clashes"]')).toBeNull();
    },
  );

  const clashWords = (el: MenusScreen) =>
    q(el, '[data-test="menu-clashes"] [data-test="status-clashes"]');
  it.each([
    ["en", 1, "Publishing waits on 1 clash"],
    ["en", 3, "Publishing waits on 3 clashes"],
    ["es-ES", 1, "No se puede publicar hasta resolver 1 conflicto"],
    ["es-ES", 3, "No se puede publicar hasta resolver 3 conflictos"],
  ])(
    "says how many clashes block publishing on Structure in %s (%i)",
    async (locale, clashes, words) => {
      setLocale(locale);
      const el = await mount(
        api(async () => ({ ...CHANGED, clashes })),
        LUNCH_PATH,
      );
      await vi.waitFor(() => expect(clashWords(el)).not.toBeNull());
      expect(text(clashWords(el))).toBe(words);
      expect(text(q(el, '[data-test="menu-clashes"]'))).toBe(words);
      expect(text(q(el, '[data-test="menu-status"]'))).not.toContain(words);
      expect(getComputedStyle(clashWords(el)!).color).toBe(resolved(el, "--wt-color-danger"));
    },
  );

  it("links to filtered Structure in underlined red on the Structure tab", async () => {
    const el = await mount(
      api(async () => ({ ...CHANGED, clashes: 2 })),
      LUNCH_PATH,
    );
    await vi.waitFor(() => expect(clashWords(el)).not.toBeNull());
    const link = clashWords(el)!;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(`${LUNCH_PATH}/filter/clashes`);
    expect(text(link)).toBe("Publishing waits on 2 clashes");
    const style = getComputedStyle(link);
    expect(style.textDecorationLine).toContain("underline");
    expect(style.color).toBe(resolved(el, "--wt-color-danger"));
  });

  it("reapplies the clash filter after clearing it without discarding a draft", async () => {
    const el = await mount(api(async () => ({ ...CHANGED, clashes: 2 })));
    await vi.waitFor(() => expect(clashWords(el)).not.toBeNull());
    const tree = q<HTMLElementTagNameMap["dashboard-menu-structure-table"]>(
      el,
      "dashboard-menu-structure-table",
    )!;
    const table = tree.shadowRoot!.querySelector("wt-data-table")!;
    tree.dispatchEvent(
      new CustomEvent("wt-structure-price", {
        detail: { productId: burger.id, value: "12.00" },
        bubbles: true,
      }),
    );
    const save = () => q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="structure-save"]')!;
    await vi.waitFor(() => expect(save().disabled).toBe(false));

    const request = vi.fn();
    const guard = new NavigationGuard(window, { isDirty: () => true, request });
    onTestFinished(() => guard.dispose());
    for (let click = 0; click < 2; click++) {
      await userEvent.click(clashWords(el)!);
      await vi.waitFor(() => expect(table.filterValues("price")).toEqual(["clashes"]));
      expect(location.pathname).toBe(`${LUNCH_PATH}/filter/clashes`);
      expect(save().disabled).toBe(false);
      table.chooseFilter("price", []);
      await vi.waitFor(() => expect(location.pathname).toBe(LUNCH_PATH));
    }
    expect(request).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "keeps the current section when opening clashes (guard present: %s)",
    async (guarded) => {
      const sectionPath = `${LUNCH_PATH}/section/m-drinks`;
      const el = await mount(
        api(async () => ({ ...CHANGED, clashes: 2 })),
        sectionPath,
      );
      if (guarded) {
        const guard = new NavigationGuard(window, { isDirty: () => false, request: vi.fn() });
        onTestFinished(() => guard.dispose());
      }
      await vi.waitFor(() => expect(location.pathname).toBe(sectionPath));
      await userEvent.click(clashWords(el)!);
      await vi.waitFor(() => expect(location.pathname).toBe(`${sectionPath}/filter/clashes`));
      await userEvent.click(clashWords(el)!);
      const table = q<HTMLElementTagNameMap["dashboard-menu-structure-table"]>(
        el,
        "dashboard-menu-structure-table",
      )!.shadowRoot!.querySelector("wt-data-table")!;
      await vi.waitFor(() => expect(table.filterValues("price")).toEqual(["clashes"]));
      expect(location.pathname).toBe(`${sectionPath}/filter/clashes`);
    },
  );

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
    ["Structure", LUNCH_PATH],
    ["Preview", PREVIEW_PATH],
  ])("says nothing about clashes on the %s tab while none is left", async (_tab, path) => {
    const el = await mount(api(), path);
    await vi.waitFor(() => expect(text(q(el, '[data-test="menu-status"]'))).toBe(LIVE_WORDS));
    expect(clashWords(el)).toBeNull();
    expect(q(el, '[data-test="menu-clashes"]')).toBeNull();
  });

  it("reads the clashes again on Structure when a price override changes", async () => {
    let clashes = 0;
    const client = api(async () => ({ ...CHANGED, clashes }));
    const live = new LiveData();
    Object.assign(client, { liveData: live });
    const el = await mount(client, LUNCH_PATH);
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

  it.each([
    ["en", "normal"],
    ["es-ES", "normal"],
    ["es-ES", "0.15em"],
  ] as const)(
    "keeps all four menu tabs reachable at 390 px in %s with %s letter spacing",
    async (locale, letterSpacing) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      onTestFinished(() => page.viewport(width, height));
      await page.viewport(390, 900);
      setLocale(locale);
      const el = await mount();
      const tabs = q<HTMLElementTagNameMap["wt-tabs"]>(el, "wt-tabs")!;
      const strip = tabs.shadowRoot!.querySelector<HTMLElement>('[role="tablist"]')!;
      const buttons = [...strip.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
      for (const button of buttons) button.style.letterSpacing = letterSpacing;
      expect(buttons).toHaveLength(4);
      if (letterSpacing === "0.15em") {
        expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth);
      }
      expect(new Set(buttons.map((button) => button.getBoundingClientRect().top)).size).toBe(1);
      for (const button of buttons) {
        expect(button.clientWidth).toBeGreaterThanOrEqual(44);
        expect(button.scrollWidth, button.innerText).toBeLessThanOrEqual(button.clientWidth);
      }
      buttons[0]!.focus();
      await userEvent.keyboard("{End}");
      const customerTab = page.getByRole("tab", { name: t("menus.tab_customer_menu") });
      expect(tabs.shadowRoot!.activeElement).toBe(customerTab.element());
      await vi.waitFor(() => {
        expect(customerTab.element().getBoundingClientRect().right).toBeLessThanOrEqual(
          strip.getBoundingClientRect().right + 1,
        );
      });
      if (letterSpacing === "0.15em") expect(strip.scrollLeft).toBeGreaterThan(0);
    },
  );

  /** Mounts a menu named `name` at phone width, putting the viewport back afterwards. */
  async function onPhone(name: string, phoneWidth = 390): Promise<MenusScreen> {
    const width = window.innerWidth,
      height = window.innerHeight;
    onTestFinished(() => page.viewport(width, height));
    await page.viewport(phoneWidth, 844);
    return mount(
      api(undefined, [{ id: "menu-lunch", name, active: true, kind: "menu", setPrice: null }]),
    );
  }

  it.each([
    ["en", 390],
    ["es-ES", 390],
    ["es-ES", 360],
  ] as const)(
    "puts Review and publish beside the live version below the title in %s at %i px",
    async (locale, phoneWidth) => {
      setLocale(locale);
      const el = await onPhone("Casa Delgado", phoneWidth);
      el.now = () => new Date("2026-09-26T10:43:00.000Z");
      await el.updateComplete;
      await vi.waitFor(() => expect(q(el, '[data-test="review-publish"]')).not.toBeNull());
      const name = q(el, "h1")!.getBoundingClientRect();
      const review = q<HTMLElement>(el, '[data-test="review-publish"]')!;
      const action = review.getBoundingClientRect();
      const live = q(el, '[data-test="menu-status"]')!.getBoundingClientRect();
      expect(action.top).toBeGreaterThanOrEqual(name.bottom);
      expect(action.left).toBeGreaterThan(live.right);
      expect(action.top).toBeLessThan(live.bottom);
      expect(action.right).toBeLessThanOrEqual(window.innerWidth);
      expect(action.height).toBe(44);
      const version = q(el, ".heading-status .version")!;
      const time = q(el, ".heading-status .time")!;
      const lines = (element: Element) =>
        new Set(Array.from(element.getClientRects(), (rect) => rect.top)).size;
      expect(lines(version)).toBe(1);
      expect(lines(time)).toBe(1);
      expect(version.getBoundingClientRect().right).toBeLessThan(action.left);
      expect(time.getBoundingClientRect().right).toBeLessThan(action.left);
      q(el, "wt-relative-time")!.shadowRoot!.querySelector("button")!.focus();
      await userEvent.keyboard("{Tab}");
      expect(el.shadowRoot!.activeElement).toBe(review);
    },
  );

  it.each(["Lunch", "The weekend brunch and late lunch menu served on the terrace until four"])(
    "puts the status under %s inside a phone's width",
    async (name) => {
      const el = await onPhone(name);
      const heading = q(el, "h1")!;
      expect(text(heading)).toBe(name);
      // The tree turns narrow a frame after it is drawn, and the page is measured as the person sees it.
      const tree = q(el, "dashboard-menu-structure-table")!.shadowRoot!.querySelector(
        "wt-data-table",
      )!;
      await vi.waitFor(() => expect(tree.hasAttribute("narrow")).toBe(true));
      expect(document.scrollingElement!.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      const h1 = heading.getBoundingClientRect();
      const path = trail(el).getBoundingClientRect();
      expect(h1.right).toBeLessThanOrEqual(window.innerWidth);
      expect(path.right).toBeLessThanOrEqual(window.innerWidth);
      const live = q(el, '[data-test="menu-status"]')!.getBoundingClientRect();
      expect(live.top).toBeGreaterThanOrEqual(h1.bottom - 1);
      expect(live.right).toBeLessThanOrEqual(window.innerWidth);
    },
  );

  it("breaks a menu name in one word longer than the phone is wide inside the heading", async () => {
    const el = await onPhone(`Terrace${"brunch".repeat(12)}`);
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
    const read = client.getMenuPreview;
    client.getMenuPreview = async (id) => {
      const preview = await read(id);
      return {
        ...preview,
        clashes: Array.from({ length: clashes }, (_, index) => ({
          productId: `p-${index}`,
          variantId: null,
          field: "price" as const,
          candidates: [],
        })),
      };
    };
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
      { api: client, now: () => new Date(NOW) },
      theme,
    );
    const heading = () => text(q(el, '[data-test="menu-status"]'));
    const panel = () => q(el, "dashboard-menu-preview")!.shadowRoot!;
    const blockerHeading = () => text(panel().querySelector("#publish-blockers-heading"));
    await vi.waitFor(() => expect(blockerHeading()).toBe("Fix before publishing (2)"));
    failed = true;
    live.invalidate([{ type: "products" }]);
    await vi.waitFor(() =>
      expect(panel().querySelector('[data-test="preview-error"]')).not.toBeNull(),
    );
    expect(blockerHeading()).toBe("");
    expect(heading()).toBe(LIVE_WORDS);
    expect(text(panel().querySelector('[data-test="preview-error"]'))).toBe(
      "The changes could not be worked out.",
    );
    await expectNoA11yViolations(host);
    failed = false;
    clashes = 3;
    live.invalidate([{ type: "products" }]);
    await vi.waitFor(() => expect(blockerHeading()).toBe("Fix before publishing (3)"));
    expect(panel().querySelector('[data-test="preview-error"]')).toBeNull();
    await expectNoA11yViolations(host);
  },
);
