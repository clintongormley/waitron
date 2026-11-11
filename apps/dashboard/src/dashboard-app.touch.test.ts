import { afterEach, expect, it } from "vitest";
import { cdp, page } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { DashboardApp } from "./dashboard-app.js";
import type { DashboardApi } from "./api/client.js";
import { setLocale } from "./i18n/t.js";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "./icons.js";

registerIcons(DASHBOARD_ICONS);

afterEach(() => {
  cleanupWidgets();
  sessionStorage.clear();
  localStorage.clear();
  setLocale("es-ES");
});

function touchApi(overrides: Record<string, unknown> = {}): DashboardApi {
  return {
    getGoogleConfig: async () => ({ configured: false }),
    getMe: async () => ({
      personId: "p1",
      role: "manager",
      email: "manager@example.com",
      locale: null,
      venueLocale: "es-ES",
      sessionDefault: "es-ES",
      venueName: "Deli Test SL",
      onboardingIntent: "prepare",
      permissions: [],
      modules: [],
    }),
    getVenueTheme: async () => ({ hash: "waitron", css: "", logo: null }),
    getLegalAbout: async () => ({ release: null, build: "test" }),
    getContentLanguages: async () => ({ defaultLanguage: "es", languages: ["es"] }),
    listAlerts: async () => ({ visible: false, alerts: [] }),
    getDiskStop: async () => ({ stopped: false, deleted: null }),
    getSalesOverview: async () => ({
      businessDay: "2026-08-30",
      takings: { tenderTotal: "0.00", tipTotal: "0.00", grossTotal: "0.00" },
      closureSummary: {
        billsClosed: { count: 0, total: "0.00" },
        toBePaidByTransfer: "0.00",
        received: "0.00",
      },
      counts: { sales: 0, corrections: 0, voids: 0 },
      openTables: { open: 0, total: 0 },
      topSellers: [],
    }),
    getOverdueOrders: async () => ({ orders: [] }),
    ...overrides,
  } as unknown as DashboardApi;
}

it("keeps touch nav rows at 44px and their chevrons visible without hover", async () => {
  await page.viewport(390, 844);
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  expect(matchMedia("(hover: none)").matches).toBe(true);
  const api = touchApi();
  const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=nav-overview]")).not.toBeNull();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!.click();
  await el.updateComplete;
  const headers = el.shadowRoot!.querySelectorAll<HTMLElement>("button.nav-group");
  expect(headers.length).toBeGreaterThan(0);
  for (const header of headers) {
    expect(header.matches(":hover")).toBe(false);
    expect(header.matches(":focus-visible")).toBe(false);
    expect(header.getBoundingClientRect().height).toBe(44);
    expect(getComputedStyle(header.querySelector(".chevron")!).opacity).toBe("1");
  }
  expect(
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-overview]")!.getBoundingClientRect()
      .height,
  ).toBe(44);
});

async function dragUp(x: number, y: number, distance: number): Promise<void> {
  const session = cdp();
  const frame = window.frameElement!.getBoundingClientRect();
  const scale = frame.width / innerWidth;
  const point = (dy: number) => ({ x: frame.left + x * scale, y: frame.top + (y - dy) * scale });
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(0)] });
  try {
    for (let step = 1; step <= 12; step++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [point((distance * step) / 12)],
      });
      await new Promise(requestAnimationFrame);
    }
  } finally {
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
}

function scrollEnd(element: HTMLElement): Promise<void> {
  return new Promise((resolve) =>
    element.addEventListener("scrollend", () => resolve(), { once: true }),
  );
}

it.each<[number, number, "capped" | "page", number]>([
  [375, 667, "capped", 3],
  [390, 844, "capped", 6],
  [1280, 800, "capped", 6],
  [667, 375, "page", 0],
  [844, 390, "page", 0],
])(
  "at %i×%i Structure native drags follow %s scrolling and leave the other container still",
  async (width, height, mode, wholeRows) => {
    await page.viewport(width, height);
    history.replaceState(null, "", "/manage/menus/menu/menu-lunch/view/structure");
    const products = Array.from({ length: 40 }, (_, index) => ({
      id: `p${index}`,
      name: `Product ${index}`,
      primaryCategoryId: null,
      categoryId: null,
      active: true,
      catalogueId: "menu-lunch",
      modifiers: [],
      customerName: { en: `Guest ${index}` },
      kitchenName: `Kitchen ${index}`,
      unitId: "u",
      unit: {
        id: "u",
        staffName: "Each",
        staffAbbreviation: "ea",
        name: { en: "Each" },
        abbreviation: { en: "ea" },
        precision: 0,
      },
      description: null,
      dietaryDeclarations: [],
      pricingUnit: "each",
      unitPrice: "2.00",
      vatClass: "reduced",
      available: true,
      ordering: "public",
      allergens: null,
      dietOverride: null,
      manualAllergens: null,
      image: null,
      variants: [],
    }));
    const structure = {
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
      nodes: products.map((product, index) => ({
        memberId: `m${index}`,
        ref: { kind: "product", productId: product.id },
      })),
    };
    const status = {
      state: "unchanged",
      clashes: 0,
      version: 1,
      publishedAt: "2026-11-09T12:00:00.000Z",
      hash: "a".repeat(64),
    };
    const api = touchApi({
      getMe: async () => ({
        personId: "p1",
        role: "manager",
        email: "manager@example.com",
        locale: "en-GB",
        venueLocale: "en-GB",
        sessionDefault: "en-GB",
        venueName: "Deli Test SL",
        onboardingIntent: "prepare",
        permissions: ["catalogue.manage", "catalogue.view"],
        modules: ["catalogue"],
      }),
      listCatalogues: async () => [
        { id: "menu-lunch", name: "Lunch Menu", active: true, version: 1 },
      ],
      listLibraryProducts: async () => products,
      listCategories: async () => [],
      getCatalogueSettings: async () => ({ defaultProductVatClass: "general", defaultColor: null }),
      getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
      getMenuStructure: async () => structure,
      getMenuStatus: async () => status,
      getMenuStatuses: async () => ({ "menu-lunch": status }),
      getMenuRead: async () => ({
        structure: { status: 200, body: structure },
        status: { status: 200, body: status },
      }),
      getMenuPublications: async () => ({ timeZone: "Europe/Madrid", live: null, editions: [] }),
    });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api });
    host.style.height = `${height}px`;
    const tableLocator = page.getByRole("treegrid");
    await expect.element(tableLocator).toBeVisible();
    const table = tableLocator.element().getRootNode() as ShadowRoot;
    const scroll = table.querySelector<HTMLElement>(".scroll")!;
    const main = el.shadowRoot!.querySelector<HTMLElement>(".main")!;
    await expect.poll(() => table.querySelectorAll("tbody tr").length).toBe(41);
    if (mode === "page") {
      const row = table.querySelectorAll("tbody tr")[1]!.getBoundingClientRect();
      const positioned = scrollEnd(main);
      main.scrollTop += row.top - main.getBoundingClientRect().top - 80;
      await positioned;
    }
    const beforeRows = main.scrollTop;
    const row = table.querySelectorAll("tbody tr")[1]!.getBoundingClientRect();
    if (mode === "page") {
      const startY = Math.min(
        row.bottom - 4,
        scroll.getBoundingClientRect().bottom - 4,
        height - 12,
      );
      expect(startY).toBeGreaterThan(row.top);
      const pageStopped = scrollEnd(main);
      await dragUp(row.left + 100, startY, 100);
      await expect.poll(() => main.scrollTop).toBeGreaterThan(beforeRows);
      await pageStopped;
      expect(scroll.scrollTop).toBe(0);
      return;
    }
    const rowsStopped = scrollEnd(scroll);
    await dragUp(row.left + 100, Math.min(row.bottom - 4, height - 12), 100);
    await expect.poll(() => scroll.scrollTop).toBeGreaterThan(0);
    await rowsStopped;
    expect(main.scrollTop).toBe(beforeRows);
    const rowsReset = scrollEnd(scroll);
    scroll.scrollTop = 0;
    await rowsReset;
    const heading = el
      .shadowRoot!.querySelector("dashboard-menus-screen")!
      .shadowRoot!.querySelector("h1")!
      .getBoundingClientRect();
    const pageStopped = scrollEnd(main);
    await dragUp(heading.left + heading.width / 2, heading.bottom - 2, 200);
    await expect.poll(() => main.scrollTop).toBeGreaterThan(0);
    await pageStopped;
    expect(scroll.scrollTop).toBe(0);
    const head = table.querySelector("thead")!.getBoundingClientRect();
    const foot = Math.min(
      scroll.getBoundingClientRect().bottom,
      main.getBoundingClientRect().bottom,
    );
    const visible = [...table.querySelectorAll("tbody tr")].slice(1).filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top >= head.bottom - 1 && rect.bottom <= foot + 1;
    });
    expect(visible.length).toBeGreaterThanOrEqual(wholeRows);
  },
);
