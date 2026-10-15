import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { registerIcons, type WtIcon } from "@waitron/ui";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  mountWidget,
  type Theme,
} from "./widgets/test-helpers.js";
import { DashboardApp } from "./dashboard-app.js";
import type { DashboardApi } from "./api/client.js";
import { DASHBOARD_ICONS } from "./icons.js";
import { setLocale, t } from "./i18n/t.js";

const SECTION_ICONS = {
  reports: "section-reports",
  service: "section-service",
  menu: "section-menu",
  operations: "section-operations",
  team: "section-team",
  purchasing: "section-purchasing",
  configuration: "gear",
} as const;

beforeEach(() => registerIcons(DASHBOARD_ICONS));

afterEach(() => {
  cleanupWidgets();
  sessionStorage.clear();
  localStorage.clear();
  setLocale("es-ES");
});

const FOLDED_KEY = "waitron-dashboard-sidebar-folded";

/** By default a manager with the bookings module, so every headed section has a page to show. */
function stubApi(me: Record<string, unknown> = {}): DashboardApi {
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
      permissions: ["booking.manage"],
      modules: ["bookings"],
      ...me,
    }),
    getContentLanguages: async () => ({ defaultLanguage: "es", languages: ["es"] }),
    listAlerts: async () => ({ visible: false, alerts: [] }),
    getSalesOverview: async () => ({
      businessDay: "2026-08-30",
      takings: { tenderTotal: "0.00", tipTotal: "0.00", grossTotal: "0.00" },
      counts: { sales: 0, corrections: 0, voids: 0 },
      openTables: { open: 0, total: 0 },
      topSellers: [],
    }),
    getOverdueOrders: async () => ({ orders: [] }),
  } as unknown as DashboardApi;
}

async function mountApp(me: Record<string, unknown> = {}, theme?: Theme) {
  const mounted = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi(me) }, theme);
  await expect
    .poll(() =>
      mounted.el.shadowRoot!.querySelector(
        "aside.sidebar :is([data-test=nav-overview], [data-test=nav-my-schedule], [data-test^=strip-])",
      ),
    )
    .not.toBeNull();
  await mounted.el.updateComplete;
  return mounted;
}

/** Sets the window's size for the body and puts the old one back after it, pass or fail. */
async function atSize(width: number, height: number, body: () => Promise<void>): Promise<void> {
  const before = { width: window.innerWidth, height: window.innerHeight };
  try {
    await page.viewport(width, height);
    expect(window.innerWidth).toBe(width);
    await body();
  } finally {
    await page.viewport(before.width, before.height);
  }
}

it("draws each headed section icon on its header, from a registered path", async () => {
  const { el } = await mountApp();
  const headers = [...el.shadowRoot!.querySelectorAll<HTMLElement>("button.nav-group")];
  expect(headers.map((header) => header.dataset.test)).toEqual(
    Object.keys(SECTION_ICONS).map((id) => `nav-group-${id}`),
  );
  for (const [id, name] of Object.entries(SECTION_ICONS)) {
    const header = el.shadowRoot!.querySelector(`[data-test=nav-group-${id}]`)!;
    const icon = header.querySelector<WtIcon>("wt-icon.group-icon");
    expect(icon?.getAttribute("name"), id).toBe(name);
    await icon!.updateComplete;
    const d = icon!.shadowRoot!.querySelector("svg path")?.getAttribute("d");
    expect(d, id).toBe(DASHBOARD_ICONS[name]);
    expect(d, id).toBeTruthy();
  }
});

it("draws the section icons in the text colour, not the header label's primary colour", async () => {
  const { el, host } = await mountApp();
  host.style.setProperty("--wt-color-text", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-primary-text", "rgb(4, 5, 6)");
  for (const id of Object.keys(SECTION_ICONS)) {
    const header = el.shadowRoot!.querySelector<HTMLElement>(`[data-test=nav-group-${id}]`)!;
    const icon = header.querySelector<HTMLElement>("wt-icon.group-icon")!;
    expect(getComputedStyle(icon).color, id).toBe("rgb(1, 2, 3)");
    expect(getComputedStyle(header.querySelector(".nav-group-label")!).color, id).toBe(
      "rgb(4, 5, 6)",
    );
  }
});

const sidebar = (el: DashboardApp) => el.shadowRoot!.querySelector<HTMLElement>("aside.sidebar")!;
const strip = (el: DashboardApp) => [
  ...sidebar(el).querySelectorAll<HTMLButtonElement>("button.strip-button"),
];
const stripButton = (el: DashboardApp, id: string) =>
  sidebar(el).querySelector<HTMLButtonElement>(`[data-test=strip-${id}]`)!;
const toggle = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!;

function expectFolded(el: DashboardApp, folded: boolean): void {
  expect(sidebar(el).classList.contains("folded")).toBe(folded);
  if (folded) {
    expect(sidebar(el).querySelector("[data-test=nav-overview]")).toBeNull();
    expect(strip(el).length).toBeGreaterThan(0);
  } else {
    expect(sidebar(el).querySelector("[data-test=nav-overview]")).not.toBeNull();
    expect(strip(el)).toEqual([]);
  }
}

describe("with no stored choice, the window's width decides whether the sidebar opens folded", () => {
  for (const [width, folded] of [
    [1280, false],
    [1100, false],
    [1024, true],
    [769, true],
  ] as const) {
    it(`${width} px opens ${folded ? "folded" : "unfolded"}`, async () => {
      await atSize(width, 800, async () => {
        const { el } = await mountApp();
        expectFolded(el, folded);
      });
    });
  }
});

it("a stored choice wins over the window's width", async () => {
  await atSize(1024, 768, async () => {
    localStorage.setItem(FOLDED_KEY, "false");
    const { el } = await mountApp();
    expectFolded(el, false);
  });
  cleanupWidgets();
  await atSize(1280, 800, async () => {
    localStorage.setItem(FOLDED_KEY, "true");
    const { el } = await mountApp();
    expectFolded(el, true);
  });
});

it("on a wide screen the toggle shows, folds and unfolds the sidebar, and stores each choice", async () => {
  await atSize(1280, 800, async () => {
    const { el } = await mountApp();
    const box = toggle(el).getBoundingClientRect();
    expect(getComputedStyle(toggle(el)).display).not.toBe("none");
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    expect(toggle(el).getAttribute("aria-label")).toBe(t("nav.toggle"));
    expect(toggle(el).getAttribute("aria-expanded")).toBe("true");

    toggle(el).click();
    await el.updateComplete;
    expectFolded(el, true);
    expect(toggle(el).getAttribute("aria-expanded")).toBe("false");
    expect(localStorage.getItem(FOLDED_KEY)).toBe("true");
    expect(el.shadowRoot!.querySelector(".layout")!.classList.contains("drawer-open")).toBe(false);

    toggle(el).click();
    await el.updateComplete;
    expectFolded(el, false);
    expect(toggle(el).getAttribute("aria-expanded")).toBe("true");
    expect(localStorage.getItem(FOLDED_KEY)).toBe("false");
  });
});

it("on a phone the toggle opens the drawer with the full sidebar, whatever is stored", async () => {
  await atSize(390, 844, async () => {
    localStorage.setItem(FOLDED_KEY, "true");
    const { el } = await mountApp();
    expect(toggle(el).getAttribute("aria-expanded")).toBe("false");
    toggle(el).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".layout")!.classList.contains("drawer-open")).toBe(true);
    expect(toggle(el).getAttribute("aria-expanded")).toBe("true");
    expectFolded(el, false);
    expect(sidebar(el).hasAttribute("inert")).toBe(false);
    expect(localStorage.getItem(FOLDED_KEY)).toBe("true");
  });
});

it("the strip lists each section with a page the person may open, in order, named by the section", async () => {
  await atSize(1280, 800, async () => {
    localStorage.setItem(FOLDED_KEY, "true");
    const { el } = await mountApp();
    const sections = ["overview", ...Object.keys(SECTION_ICONS)];
    expect(strip(el).map((button) => button.dataset.test)).toEqual([
      "strip-search",
      ...sections.map((id) => `strip-${id}`),
    ]);
    expect(stripButton(el, "search").getAttribute("aria-label")).toBe(t("nav.search"));
    expect(stripButton(el, "overview").getAttribute("aria-label")).toBe(t("nav.overview"));
    for (const id of Object.keys(SECTION_ICONS) as (keyof typeof SECTION_ICONS)[]) {
      const button = stripButton(el, id);
      const icon = SECTION_ICONS[id];
      expect(button.getAttribute("aria-label"), id).toBe(t(`nav.group.${id}`));
      expect(button.querySelector("wt-icon")!.getAttribute("name"), id).toBe(icon);
    }
    expect(stripButton(el, "overview").querySelector("wt-icon")!.getAttribute("name")).toBe(
      "section-overview",
    );
    expect(stripButton(el, "search").querySelector("wt-icon")!.getAttribute("name")).toBe("search");
    expect(sidebar(el).querySelector("nav")!.getAttribute("aria-label")).toBe(t("nav.sections"));
  });
});

it("the strip leaves out a section with no page the person may open", async () => {
  await atSize(1280, 800, async () => {
    localStorage.setItem(FOLDED_KEY, "true");
    const { el } = await mountApp({ modules: [], permissions: [] });
    expect(stripButton(el, "menu")).not.toBeNull();
    expect(stripButton(el, "service")).toBeNull();
  });
});

it("a staff session's strip holds only Overview, with no magnifier", async () => {
  await atSize(1280, 800, async () => {
    localStorage.setItem(FOLDED_KEY, "true");
    const { el } = await mountApp({
      role: "staff",
      permissions: ["sale.take_payment"],
      modules: [],
    });
    expect(strip(el).map((button) => button.dataset.test)).toEqual(["strip-overview"]);
  });
});

it("the current section is marked by the highlight alone, its icon staying the text colour", async () => {
  await atSize(1280, 800, async () => {
    localStorage.setItem(FOLDED_KEY, "true");
    const { el, host } = await mountApp();
    host.style.setProperty("--wt-color-primary", "rgb(11, 12, 13)");
    host.style.setProperty("--wt-color-primary-text", "rgb(14, 15, 16)");
    host.style.setProperty("--wt-color-surface-lifted", "rgb(21, 22, 23)");
    host.style.setProperty("--wt-color-surface", "rgb(24, 25, 26)");
    host.style.setProperty("--wt-color-text", "rgb(31, 32, 33)");
    const current = stripButton(el, "overview");
    const other = stripButton(el, "reports");
    expect(current.getAttribute("aria-current")).toBe("true");
    const style = getComputedStyle(current);
    expect(style.borderInlineStartColor).toBe("rgb(11, 12, 13)");
    expect(style.borderInlineStartWidth).toBe("3px");
    expect(style.backgroundColor).toBe("rgb(21, 22, 23)");
    expect(getComputedStyle(current.querySelector("wt-icon")!).color).toBe("rgb(31, 32, 33)");

    expect(other.hasAttribute("aria-current")).toBe(false);
    const otherStyle = getComputedStyle(other);
    expect(otherStyle.borderInlineStartColor).not.toBe("rgb(11, 12, 13)");
    expect(otherStyle.backgroundColor).not.toBe("rgb(21, 22, 23)");
    expect(getComputedStyle(other.querySelector("wt-icon")!).color).toBe("rgb(31, 32, 33)");

    // The shared icon button colours an open one's icon; a section's icon never is.
    current.setAttribute("aria-expanded", "true");
    expect(getComputedStyle(current.querySelector("wt-icon")!).color).toBe("rgb(31, 32, 33)");
    expect(getComputedStyle(current).backgroundColor).toBe("rgb(21, 22, 23)");
  });
});

it("a one-page section's icon opens its page and the strip stays folded", async () => {
  await atSize(1280, 800, async () => {
    localStorage.setItem(FOLDED_KEY, "true");
    const { el } = await mountApp();
    stripButton(el, "purchasing").click();
    await expect
      .poll(() => el.shadowRoot!.querySelector("dashboard-purchases-screen"))
      .not.toBeNull();
    await el.updateComplete;
    expectFolded(el, true);
    expect(stripButton(el, "purchasing").getAttribute("aria-current")).toBe("true");
    expect(stripButton(el, "overview").hasAttribute("aria-current")).toBe(false);
    expect(localStorage.getItem(FOLDED_KEY)).toBe("true");
  });
});

it("a section with several pages unfolds the sidebar with that section open, storing nothing", async () => {
  await atSize(1280, 800, async () => {
    localStorage.setItem(FOLDED_KEY, "true");
    const { el } = await mountApp();
    stripButton(el, "team").click();
    await el.updateComplete;
    expectFolded(el, false);
    expect(
      sidebar(el).querySelector("[data-test=nav-group-team]")!.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      sidebar(el).querySelector("[data-test=nav-group-menu]")!.getAttribute("aria-expanded"),
    ).toBe("false");
    expect(localStorage.getItem(FOLDED_KEY)).toBe("true");
  });
});

describe("a strip button's tooltip shows its section's name beside it", () => {
  for (const how of ["hover", "focus"] as const) {
    it(`on ${how}`, async () => {
      await atSize(1280, 800, async () => {
        localStorage.setItem(FOLDED_KEY, "true");
        const { el } = await mountApp();
        const button = stripButton(el, "reports");
        const tooltip = button.querySelector<HTMLElement>(".icon-tooltip")!;
        expect(getComputedStyle(tooltip).display).toBe("none");
        if (how === "hover") await userEvent.hover(button);
        else await userEvent.tab(); // reaches the first strip button
        if (how === "focus") {
          for (let i = 0; i < 10 && el.shadowRoot!.activeElement !== button; i++)
            await userEvent.tab();
          expect(el.shadowRoot!.activeElement).toBe(button);
        }
        expect(getComputedStyle(tooltip).display).not.toBe("none");
        expect(tooltip.getAttribute("aria-hidden")).toBe("true");
        expect(tooltip.textContent!.trim()).toBe(t("nav.group.reports"));
        const tip = tooltip.getBoundingClientRect();
        const box = button.getBoundingClientRect();
        expect(tip.left).toBeGreaterThanOrEqual(box.right);
        expect(tip.top).toBeLessThan(box.bottom);
        expect(tip.bottom).toBeGreaterThan(box.top);
        // Nothing clips or covers it: its own middle is what the page shows there.
        const hit = el.shadowRoot!.elementFromPoint(
          (tip.left + tip.right) / 2,
          (tip.top + tip.bottom) / 2,
        );
        expect(tooltip.contains(hit)).toBe(true);
      });
    });
  }
});

it("the magnifier unfolds the sidebar, stores that, and puts the cursor in the search box", async () => {
  await atSize(1280, 800, async () => {
    localStorage.setItem(FOLDED_KEY, "true");
    const { el } = await mountApp();
    stripButton(el, "search").click();
    await el.updateComplete;
    expectFolded(el, false);
    expect(localStorage.getItem(FOLDED_KEY)).toBe("false");
    const search = sidebar(el).querySelector<HTMLElement>("wt-input[data-test=nav-search]")!;
    await expect.poll(() => el.shadowRoot!.activeElement).toBe(search);
    expect(search.shadowRoot!.activeElement).toBeInstanceOf(HTMLInputElement);
  });
});

describe.each(["light", "dark"] as const)("the folded strip (%s theme)", (theme) => {
  it("has no accessibility violations", async () => {
    await atSize(1280, 800, async () => {
      localStorage.setItem(FOLDED_KEY, "true");
      const { el, host } = await mountApp({}, theme);
      expectFolded(el, true);
      await expectNoA11yViolations(host);
    });
  });
});
