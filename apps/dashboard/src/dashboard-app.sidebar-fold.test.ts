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

const panel = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=strip-panel]");
const panelPages = (el: DashboardApp) => [
  ...panel(el)!.querySelectorAll<HTMLButtonElement>("button.nav-item"),
];
const layout = (el: DashboardApp) => el.shadowRoot!.querySelector<HTMLElement>(".layout")!;

/** Mounts unfolded, reads a section's pages as the full sidebar lists them, then folds. */
async function mountFoldedReading(group: string, me: Record<string, unknown> = {}) {
  const mounted = await mountApp(me);
  const pages = [
    ...sidebar(mounted.el).querySelectorAll<HTMLButtonElement>(
      `#nav-group-panel-${group} .nav-item`,
    ),
  ].map((item) => ({
    test: item.dataset.test!.replace(/^nav-/, ""),
    label: item.textContent!.trim(),
  }));
  toggle(mounted.el).click();
  await mounted.el.updateComplete;
  expectFolded(mounted.el, true);
  return { ...mounted, pages };
}

describe("a section with several pages opens a panel beside its icon", () => {
  it("listing the section's name and its pages in order, the strip staying folded and nothing stored", async () => {
    await atSize(1280, 800, async () => {
      const { el, pages } = await mountFoldedReading("team");
      expect(pages.length).toBeGreaterThan(1);
      const team = stripButton(el, "team");
      expect(team.getAttribute("aria-expanded")).toBe("false");
      expect(panel(el)).toBeNull();
      localStorage.removeItem(FOLDED_KEY);

      await userEvent.click(team);
      await el.updateComplete;
      expect(panel(el)).not.toBeNull();
      expect(team.getAttribute("aria-expanded")).toBe("true");
      expect(team.getAttribute("aria-controls")).toBe(panel(el)!.id);
      expect(panel(el)!.id).not.toBe("");
      expect(panel(el)!.querySelector(".strip-panel-label")!.textContent!.trim()).toBe(
        t("nav.group.team"),
      );
      expect(
        panelPages(el).map((item) => ({
          test: item.dataset.test!.replace(/^strip-panel-/, ""),
          label: item.textContent!.trim(),
        })),
      ).toEqual(pages);
      expect(el.shadowRoot!.activeElement).toBe(team);
      expectFolded(el, true);
      expect(localStorage.getItem(FOLDED_KEY)).toBeNull();
      // A one-page section's icon is a plain button, not a disclosure.
      expect(stripButton(el, "purchasing").hasAttribute("aria-expanded")).toBe(false);
      expect(stripButton(el, "purchasing").hasAttribute("aria-controls")).toBe(false);
    });
  });

  it("with the section name styled as a sidebar header and the current page marked as in the sidebar", async () => {
    await atSize(1280, 800, async () => {
      const { el, host } = await mountFoldedReading("reports");
      host.style.setProperty("--wt-color-primary-text", "rgb(4, 5, 6)");
      host.style.setProperty("--wt-color-primary", "rgb(7, 8, 9)");
      await userEvent.click(stripButton(el, "reports"));
      await el.updateComplete;
      const label = panel(el)!.querySelector<HTMLElement>(".strip-panel-label")!;
      expect(getComputedStyle(label).textTransform).toBe("uppercase");
      expect(getComputedStyle(label).color).toBe("rgb(4, 5, 6)");
      panelPages(el)[0]!.click();
      await el.updateComplete;
      await userEvent.click(stripButton(el, "reports"));
      await el.updateComplete;
      const [current, other] = panelPages(el);
      expect(current!.getAttribute("aria-current")).toBe("page");
      expect(getComputedStyle(current!).borderInlineStartColor).toBe("rgb(7, 8, 9)");
      expect(getComputedStyle(current!).color).toBe("rgb(4, 5, 6)");
      expect(other!.hasAttribute("aria-current")).toBe(false);
    });
  });

  it("with its top at the icon's top and past the strip's edge, on its first frame", async () => {
    await atSize(1280, 800, async () => {
      // High in the strip, so nothing lifts its panel to keep it inside the layout.
      const { el } = await mountFoldedReading("reports");
      const reports = stripButton(el, "reports");
      reports.click();
      await el.updateComplete;
      const measure = () => {
        const box = panel(el)!.getBoundingClientRect();
        expect(box.bottom).toBeLessThan(layout(el).getBoundingClientRect().bottom);
        expect(Math.abs(box.top - reports.getBoundingClientRect().top)).toBeLessThanOrEqual(1);
        expect(box.left).toBeGreaterThanOrEqual(sidebar(el).getBoundingClientRect().right);
        expect(box.width).toBeGreaterThan(0);
        const hit = el.shadowRoot!.elementFromPoint(box.left + box.width / 2, box.top + 4);
        expect(panel(el)!.contains(hit)).toBe(true);
      };
      measure();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      measure();
    });
  });

  it("kept within the layout when its icon is low in the window", async () => {
    await atSize(1280, 600, async () => {
      const { el } = await mountFoldedReading("configuration");
      const settings = stripButton(el, "configuration");
      const bottom = layout(el).getBoundingClientRect().bottom;
      expect(settings.getBoundingClientRect().bottom).toBeLessThanOrEqual(bottom);
      settings.click();
      await el.updateComplete;
      const box = panel(el)!.getBoundingClientRect();
      expect(panelPages(el).length).toBeGreaterThan(4);
      // It would run past the layout if it hung from the icon.
      expect(settings.getBoundingClientRect().top + box.height).toBeGreaterThan(bottom);
      expect(box.bottom).toBeLessThanOrEqual(bottom + 0.5);
      expect(box.top).toBeGreaterThanOrEqual(layout(el).getBoundingClientRect().top - 0.5);
    });
  });

  it("picking a page opens it and closes the panel, the strip staying folded and nothing stored", async () => {
    await atSize(1280, 800, async () => {
      const { el } = await mountFoldedReading("team");
      localStorage.removeItem(FOLDED_KEY);
      await userEvent.click(stripButton(el, "team"));
      await el.updateComplete;
      await userEvent.click(
        panel(el)!.querySelector<HTMLButtonElement>("[data-test=strip-panel-approvals]")!,
      );
      await expect
        .poll(() => el.shadowRoot!.querySelector("dashboard-approvals-screen"))
        .not.toBeNull();
      await el.updateComplete;
      expect(panel(el)).toBeNull();
      expect(stripButton(el, "team").getAttribute("aria-expanded")).toBe("false");
      expect(stripButton(el, "team").getAttribute("aria-current")).toBe("true");
      expectFolded(el, true);
      expect(localStorage.getItem(FOLDED_KEY)).toBeNull();
    });
  });

  it("Escape closes it from a page and from its icon, putting focus on the icon and nothing else", async () => {
    await atSize(1280, 800, async () => {
      const { el } = await mountFoldedReading("team");
      const team = stripButton(el, "team");
      team.focus();
      await userEvent.keyboard("{Enter}");
      await el.updateComplete;
      expect(el.shadowRoot!.activeElement).toBe(panelPages(el)[0]);
      let reachedLayout = false;
      const watch = (event: KeyboardEvent) => {
        if (event.key === "Escape") reachedLayout = true;
      };
      el.shadowRoot!.querySelector(".shell")!.addEventListener("keydown", watch as EventListener);
      await userEvent.keyboard("{Escape}");
      await el.updateComplete;
      expect(panel(el)).toBeNull();
      expect(el.shadowRoot!.activeElement).toBe(team);
      expect(reachedLayout).toBe(false);

      await userEvent.keyboard("{Enter}");
      await el.updateComplete;
      team.focus();
      expect(panel(el)).not.toBeNull();
      await userEvent.keyboard("{Escape}");
      await el.updateComplete;
      expect(panel(el)).toBeNull();
      expect(el.shadowRoot!.activeElement).toBe(team);
      expect(reachedLayout).toBe(false);
    });
  });

  it("Enter on its icon opens it with focus on the first page, and Tab past the last page closes it", async () => {
    await atSize(1280, 800, async () => {
      const { el } = await mountFoldedReading("team");
      stripButton(el, "team").focus();
      await userEvent.keyboard("{Enter}");
      await el.updateComplete;
      const pages = panelPages(el);
      expect(el.shadowRoot!.activeElement).toBe(pages[0]);
      pages.at(-1)!.focus();
      await userEvent.tab();
      await el.updateComplete;
      expect(panel(el)).toBeNull();
      expect(stripButton(el, "team").getAttribute("aria-expanded")).toBe("false");
    });
  });

  it("Space on its icon opens it too, and clicking the icon again closes it", async () => {
    await atSize(1280, 800, async () => {
      const { el } = await mountFoldedReading("team");
      stripButton(el, "team").focus();
      await userEvent.keyboard(" ");
      await el.updateComplete;
      expect(panel(el)).not.toBeNull();
      await userEvent.click(stripButton(el, "team"));
      await el.updateComplete;
      expect(panel(el)).toBeNull();
    });
  });

  it("a click on the main content closes it; a click inside it does not", async () => {
    await atSize(1280, 800, async () => {
      const { el } = await mountFoldedReading("team");
      await userEvent.click(stripButton(el, "team"));
      await el.updateComplete;
      await userEvent.click(panel(el)!.querySelector<HTMLElement>(".strip-panel-label")!);
      await el.updateComplete;
      expect(panel(el)).not.toBeNull();
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>(".main")!, {
        position: { x: 700, y: 300 },
      });
      await el.updateComplete;
      expect(panel(el)).toBeNull();
    });
  });

  it("opening another section's panel leaves only that one", async () => {
    await atSize(1280, 800, async () => {
      const { el } = await mountFoldedReading("team");
      await userEvent.click(stripButton(el, "team"));
      await el.updateComplete;
      await userEvent.click(stripButton(el, "configuration"));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelectorAll("[data-test=strip-panel]").length).toBe(1);
      expect(stripButton(el, "configuration").getAttribute("aria-controls")).toBe(panel(el)!.id);
      expect(stripButton(el, "team").getAttribute("aria-expanded")).toBe("false");
      expect(stripButton(el, "configuration").getAttribute("aria-expanded")).toBe("true");
    });
  });

  it("narrowing to a phone closes it, and it does not come back in the drawer or on widening", async () => {
    const before = { width: window.innerWidth, height: window.innerHeight };
    try {
      await page.viewport(1280, 800);
      const { el } = await mountFoldedReading("team");
      await userEvent.click(stripButton(el, "team"));
      await el.updateComplete;
      expect(panel(el)).not.toBeNull();
      await page.viewport(390, 844);
      await expect.poll(() => panel(el)).toBeNull();
      toggle(el).click();
      await el.updateComplete;
      expect(panel(el)).toBeNull();
      toggle(el).click();
      await page.viewport(1280, 800);
      await expect.poll(() => sidebar(el).classList.contains("folded")).toBe(true);
      expect(panel(el)).toBeNull();
    } finally {
      await page.viewport(before.width, before.height);
    }
  });

  it("unfolding the sidebar closes it", async () => {
    await atSize(1280, 800, async () => {
      const { el } = await mountFoldedReading("team");
      await userEvent.click(stripButton(el, "team"));
      await el.updateComplete;
      // A scripted click, so no pointerdown outside the panel closes it first.
      toggle(el).click();
      await el.updateComplete;
      expect(panel(el)).toBeNull();
      toggle(el).click();
      await el.updateComplete;
      expectFolded(el, true);
      expect(panel(el)).toBeNull();
    });
  });

  it("for staff, the Overview icon opens a panel of their two pages", async () => {
    await atSize(1280, 800, async () => {
      localStorage.setItem(FOLDED_KEY, "true");
      const { el } = await mountApp({
        role: "staff",
        permissions: ["sale.take_payment"],
        modules: [],
      });
      await userEvent.click(stripButton(el, "overview"));
      await el.updateComplete;
      expect(panelPages(el).map((item) => item.dataset.test)).toEqual([
        "strip-panel-my-schedule",
        "strip-panel-orders",
      ]);
      expect(panel(el)!.querySelector(".strip-panel-label")!.textContent!.trim()).toBe(
        t("nav.overview"),
      );
    });
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

  it("has no accessibility violations with a section's panel open", async () => {
    await atSize(1280, 800, async () => {
      localStorage.setItem(FOLDED_KEY, "true");
      const { el, host } = await mountApp({}, theme);
      await userEvent.click(stripButton(el, "team"));
      await el.updateComplete;
      expect(panel(el)).not.toBeNull();
      await expectNoA11yViolations(host);
    });
  });
});
