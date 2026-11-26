import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
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
  team: "section-team",
  menu: "section-menu",
  operations: "section-operations",
  hardware: "section-hardware",
  purchasing: "section-purchasing",
  configuration: "section-system",
} as const;

beforeEach(() => registerIcons(DASHBOARD_ICONS));

const initialUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  history.replaceState(null, "", initialUrl);
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
      roleIds: ["manager"],
      email: "manager@example.com",
      locale: null,
      venueLocale: "es-ES",
      sessionDefault: "es-ES",
      venueName: "Deli Test SL",
      onboardingIntent: "prepare",
      permissions: [
        "booking.manage",
        "venue.view",
        "menu.manage",
        "hardware.manage",
        "system.manage",
      ],
      modules: ["bookings"],
      ...me,
    }),
    getVenueTheme: async () => ({ hash: "waitron", css: "", logo: null }),
    getLegalAbout: async () => ({ release: null, build: "test" }),
    getContentLanguages: async () => ({ defaultLanguage: "es", languages: ["es"] }),
    listAlerts: async () => ({ visible: false, alerts: [] }),
    getDiskStop: async () => ({ stopped: false, deleted: null }),
    getSalesOverview: async () => ({
      businessDay: "2026-08-30",
      takings: { tenderTotal: "0.00", tipTotal: "0.00", grossTotal: "0.00" },
      departmentTakings: [],
      closureSummary: {
        billsClosed: { count: 0, total: "0.00" },
        deferredPayments: "0.00",
        received: "0.00",
      },
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

it("places 18px icons 12px before the full sidebar labels", async () => {
  await atSize(1280, 800, async () => {
    const { el } = await mountApp();
    for (const id of Object.keys(SECTION_ICONS)) {
      const header = el.shadowRoot!.querySelector(`[data-test=nav-group-${id}]`)!;
      const icon = header.querySelector<HTMLElement>(".group-icon")!.getBoundingClientRect();
      const label = header.querySelector<HTMLElement>(".nav-group-label")!.getBoundingClientRect();
      const previous = header.previousElementSibling!;
      const above = previous.hasAttribute("hidden") ? previous.previousElementSibling! : previous;
      expect
        .soft(header.getBoundingClientRect().top - above.getBoundingClientRect().bottom, id)
        .toBe(8);
      expect.soft(icon.width, id).toBe(18);
      expect.soft(label.left - icon.right, id).toBe(12);
      expect((icon.top + icon.bottom) / 2, id).toBeCloseTo((label.top + label.bottom) / 2, 0);
    }
    for (const icon of el.shadowRoot!.querySelectorAll<HTMLElement>(".pinned-icon")) {
      expect.soft(icon.getBoundingClientRect().width).toBe(18);
      expect.soft(getComputedStyle(icon).marginInlineEnd).toBe("12px");
    }
  });
});

it("gives top-level labels the weight of section names and keeps the current page teal", async () => {
  await atSize(1280, 800, async () => {
    const { el, host } = await mountApp();
    host.style.setProperty("--wt-color-text", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-color-primary-text", "rgb(4, 5, 6)");
    const overview = el.shadowRoot!.querySelector("[data-test=nav-overview]")!;
    const bookings = el.shadowRoot!.querySelector("[data-test=nav-bookings]")!;
    expect(overview.getAttribute("aria-current")).toBe("page");
    expect.soft(getComputedStyle(overview).color).toBe("rgb(4, 5, 6)");
    expect.soft(getComputedStyle(bookings).color).toBe("rgb(1, 2, 3)");
    expect(getComputedStyle(bookings).fontWeight).toBe("600");
  });
});

it.each(["light", "dark"] as const)(
  "paints the current page's band at rest in %s",
  async (theme) => {
    await atSize(1280, 800, async () => {
      history.replaceState(null, "", "/devices");
      const { el, host } = await mountApp({}, theme);
      const current = sidebar(el).querySelector("[data-test=nav-devices]")!;
      const idle = current.parentElement!.querySelector(".nav-item:not([aria-current])")!;
      await commands.parkPointer();
      expect(current.matches(":hover")).toBe(false);
      expect(current.getAttribute("aria-current")).toBe("page");
      const raisedSurface = document.createElement("div");
      raisedSurface.style.backgroundColor = "var(--wt-color-surface-raised)";
      host.append(raisedSurface);
      expect(getComputedStyle(current).backgroundColor).toBe(
        getComputedStyle(raisedSurface).backgroundColor,
      );
      expect(getComputedStyle(idle).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    });
  },
);

it("leaves 12px between Bookings and the visible divider", async () => {
  await atSize(1280, 800, async () => {
    const { el } = await mountApp();
    const pinned = el.shadowRoot!.querySelector("#nav-group-panel-overview")!;
    const bookings = pinned.querySelector("[data-test=nav-bookings]")!;
    const divider = getComputedStyle(pinned);
    expect(divider.borderBlockEndWidth).toBe("1px");
    expect(pinned.getBoundingClientRect().bottom - bookings.getBoundingClientRect().bottom).toBe(
      13,
    );
  });
});

it("keeps the section name close to its first page and leaves a larger gap before the next section", async () => {
  await atSize(1280, 800, async () => {
    const { el } = await mountApp();
    const root = el.shadowRoot!;
    const hardware = root.querySelector<HTMLButtonElement>("[data-test=nav-group-hardware]")!;
    hardware.click();
    await el.updateComplete;
    const pages = root.querySelector("#nav-group-panel-hardware")!;
    const nextHeading = root.querySelector("[data-test=nav-group-purchasing] .nav-group-label")!;
    const textTop = (element: Element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().top;
    };
    const first = textTop(pages.firstElementChild!);
    const last = textTop(pages.lastElementChild!);
    const heading = textTop(hardware.querySelector(".nav-group-label")!);
    const withinSection = first - heading;
    const betweenSections = textTop(nextHeading) - last;
    expect.soft(Math.abs(withinSection - 32)).toBeLessThan(2);
    expect(Math.abs(betweenSections - 44)).toBeLessThan(2);
  });
});

it("brightens icons on hover or for the current section, even when it is closed", async () => {
  await atSize(1280, 800, async () => {
    await commands.parkPointer();
    history.replaceState(null, "", "/devices");
    const { el, host } = await mountApp({ locale: "en-GB" });
    host.style.setProperty("--wt-color-text", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-color-text-muted", "rgb(4, 5, 6)");
    const current = el.shadowRoot!.querySelector<HTMLButtonElement>(
      "[data-test=nav-group-hardware]",
    )!;
    const other = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-group-menu]")!;
    const bookings = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-bookings]")!;
    for (const row of [other, bookings]) {
      expect.soft(getComputedStyle(row.querySelector("wt-icon")!).color).toBe("rgb(4, 5, 6)");
      await userEvent.hover(row);
      expect.soft(getComputedStyle(row.querySelector("wt-icon")!).color).toBe("rgb(1, 2, 3)");
    }
    const label = getComputedStyle(current.querySelector(".nav-group-label")!);
    expect.soft(label.color).toBe("rgb(1, 2, 3)");
    expect.soft(label.textTransform).toBe("none");
    expect.soft(label.letterSpacing).toBe("normal");
    expect.soft(label.fontSize).toBe("14px");
    expect.soft(label.fontWeight).toBe("600");
    expect(current.getAttribute("aria-expanded")).toBe("true");
    current.click();
    await el.updateComplete;
    expect(current.getAttribute("aria-expanded")).toBe("false");
    expect(getComputedStyle(current.querySelector("wt-icon")!).color).toBe("rgb(1, 2, 3)");
    const search = el.shadowRoot!.querySelector("[data-test=nav-search]")!;
    search.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Printers" } }));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=nav-devices]")).toBeNull();
    const searchHeadingIcon = el.shadowRoot!.querySelector(
      "[data-test=nav-group-hardware] wt-icon",
    )!;
    expect(getComputedStyle(searchHeadingIcon).color).toBe("rgb(1, 2, 3)");
    search.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Products" } }));
    await el.updateComplete;
    const searchHeading = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-group-menu]")!;
    await userEvent.hover(searchHeading);
    expect(searchHeading.matches(":hover")).toBe(true);
    expect(getComputedStyle(searchHeading.querySelector("wt-icon")!).color).toBe("rgb(4, 5, 6)");
  });
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

it("a window too short for the strip, such as a phone held sideways, scrolls it to its last icon", async () => {
  await atSize(844, 390, async () => {
    const { el } = await mountApp();
    expectFolded(el, true);
    const aside = el.shadowRoot!.querySelector<HTMLElement>("aside.sidebar")!;
    expect(aside.scrollHeight).toBeGreaterThan(aside.clientHeight);
    const last = stripButton(el, "configuration");
    last.scrollIntoView({ block: "end" });
    const box = aside.getBoundingClientRect();
    const button = last.getBoundingClientRect();
    expect(button.bottom).toBeLessThanOrEqual(box.bottom + 1);
    expect(button.top).toBeGreaterThanOrEqual(box.top);
    expect(el.shadowRoot!.elementFromPoint(button.left + 2, button.top + 2)).toBe(last);
  });
});

it("in a strip that scrolls, a section's panel shows beside the strip, its first page uncovered", async () => {
  await atSize(844, 390, async () => {
    const { el } = await mountApp();
    const team = stripButton(el, "team");
    team.scrollIntoView({ block: "end" });
    await userEvent.click(team);
    await el.updateComplete;
    const shown = el.shadowRoot!.querySelector<HTMLElement>("[data-test=strip-panel]")!;
    const box = shown.getBoundingClientRect();
    const aside = el
      .shadowRoot!.querySelector<HTMLElement>("aside.sidebar")!
      .getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(aside.right - 1);
    const first = shown.querySelector<HTMLElement>(".nav-item")!.getBoundingClientRect();
    const hit = el.shadowRoot!.elementFromPoint(first.left + 4, (first.top + first.bottom) / 2);
    expect(shown.contains(hit)).toBe(true);
  });
});

it("in a window too short for it, the System panel stays within the layout beside its icon and scrolls", async () => {
  await atSize(844, 390, async () => {
    const { el } = await mountApp({
      permissions: [
        "venue.view",
        "hardware.manage",
        "system.manage",
        "node.manage",
        "person.manage",
        "report.view",
      ],
    });
    expectFolded(el, true);
    const settings = stripButton(el, "configuration");
    settings.scrollIntoView({ block: "end" });
    await userEvent.click(settings);
    await el.updateComplete;
    const shown = el.shadowRoot!.querySelector<HTMLElement>("[data-test=strip-panel]")!;
    const area = el.shadowRoot!.querySelector<HTMLElement>(".layout")!.getBoundingClientRect();
    const box = shown.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(area.top - 0.5);
    expect(box.bottom).toBeLessThanOrEqual(area.bottom + 0.5);
    expect(box.left).toBeGreaterThanOrEqual(sidebar(el).getBoundingClientRect().right - 1);
    const icon = settings.getBoundingClientRect();
    expect(box.top).toBeLessThanOrEqual(icon.top);
    expect(box.bottom).toBeGreaterThanOrEqual(icon.bottom);
    expect(shown.scrollHeight).toBeGreaterThan(shown.clientHeight);
    const last = [...shown.querySelectorAll<HTMLElement>(".nav-item")].at(-1)!;
    last.scrollIntoView({ block: "nearest" });
    const target = last.getBoundingClientRect();
    expect(target.bottom).toBeLessThanOrEqual(area.bottom + 0.5);
    const hit = el.shadowRoot!.elementFromPoint(target.left + 4, (target.top + target.bottom) / 2);
    expect(last.contains(hit)).toBe(true);
  });
});

it("scrolling the strip closes an open panel, which would otherwise stay where its icon was", async () => {
  await atSize(844, 390, async () => {
    const { el } = await mountApp();
    const aside = sidebar(el);
    await userEvent.click(stripButton(el, "team"));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-test=strip-panel]")).not.toBeNull();
    const top = aside.scrollTop;
    aside.scrollTop = top > 20 ? top - 40 : top + 40;
    expect(aside.scrollTop).not.toBe(top);
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=strip-panel]")).toBeNull();
    expect(stripButton(el, "team").getAttribute("aria-expanded")).toBe("false");
  });
});

it("in a scrolling strip, a panel opened by Enter just after focus scrolled the strip stays open", async () => {
  await atSize(844, 390, async () => {
    const { el } = await mountApp();
    const aside = sidebar(el);
    expect(aside.scrollTop).toBe(0);
    const settings = stripButton(el, "configuration");
    settings.focus();
    expect(aside.scrollTop).toBeGreaterThan(0);
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const shown = el.shadowRoot!.querySelector<HTMLElement>("[data-test=strip-panel]");
    expect(shown).not.toBeNull();
    expect(shown!.contains(el.shadowRoot!.activeElement)).toBe(true);
  });
});

it("in a scrolling strip, tabbing to the last page of a panel that scrolls leaves it open", async () => {
  await atSize(844, 300, async () => {
    const { el } = await mountApp();
    stripButton(el, "configuration").focus();
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;
    const shown = el.shadowRoot!.querySelector<HTMLElement>("[data-test=strip-panel]")!;
    expect(shown.scrollHeight).toBeGreaterThan(shown.clientHeight);
    const pages = [...shown.querySelectorAll<HTMLElement>(".nav-item")];
    expect(pages.at(-1)!.getBoundingClientRect().bottom).toBeGreaterThan(
      shown.getBoundingClientRect().bottom,
    );
    expect(el.shadowRoot!.activeElement).toBe(pages[0]);
    for (let i = 1; i < pages.length; i++) await userEvent.tab();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(el.shadowRoot!.querySelector("[data-test=strip-panel]")).toBe(shown);
    expect(shown.scrollTop).toBeGreaterThan(0);
    expect(el.shadowRoot!.activeElement).toBe(pages.at(-1));
  });
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
    const sections = ["overview", "bookings", ...Object.keys(SECTION_ICONS)];
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
      const symbol = button.querySelector("wt-icon")!;
      expect(symbol.getAttribute("name"), id).toBe(icon);
      expect.soft(symbol.getBoundingClientRect().width, id).toBe(20);
      expect.soft(button.getBoundingClientRect().height, id).toBe(44);
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
    const { el } = await mountApp({ modules: [], permissions: ["venue.view"] });
    expect(stripButton(el, "menu")).not.toBeNull();
    expect(stripButton(el, "bookings")).toBeNull();
  });
});

it("opens Bookings directly from the strip when the session may open it", async () => {
  await atSize(1280, 800, async () => {
    localStorage.setItem(FOLDED_KEY, "true");
    const { el } = await mountApp();
    const bookings = stripButton(el, "bookings");
    expect(bookings.getAttribute("aria-label")).toBe("Reservas");
    const icon = bookings.querySelector<WtIcon>("wt-icon")!;
    expect(icon.getAttribute("name")).toBe("event");
    await icon.updateComplete;
    expect(icon.shadowRoot!.querySelector("svg path")?.getAttribute("d")).toBeTruthy();
    expect(bookings.hasAttribute("aria-expanded")).toBe(false);
    bookings.click();
    await expect.poll(() => location.pathname).toBe("/bookings");
    expect(bookings.getAttribute("aria-current")).toBe("page");
    expect(panel(el)).toBeNull();
    expectFolded(el, true);
  });
});

it("a staff session's strip holds only Overview, with no magnifier", async () => {
  await atSize(1280, 800, async () => {
    localStorage.setItem(FOLDED_KEY, "true");
    const { el } = await mountApp({
      roleIds: ["staff"],
      permissions: ["payment.take"],
      modules: [],
    });
    expect(strip(el).map((button) => button.dataset.test)).toEqual(["strip-overview"]);
  });
});

it("a session holding only invoice.inspect has a strip of its one section, with no magnifier", async () => {
  await atSize(1280, 800, async () => {
    localStorage.setItem(FOLDED_KEY, "true");
    const { el } = await mountApp({
      roleIds: ["tax-inspector"],
      permissions: ["invoice.inspect"],
      modules: [],
    });
    expect(strip(el).map((button) => button.dataset.test)).toEqual(["strip-reports"]);
  });
});

it("highlights the current strip section and leaves idle icons muted", async () => {
  await atSize(1280, 800, async () => {
    localStorage.setItem(FOLDED_KEY, "true");
    const { el, host } = await mountApp();
    host.style.setProperty("--wt-color-primary", "rgb(11, 12, 13)");
    host.style.setProperty("--wt-color-primary-text", "rgb(14, 15, 16)");
    host.style.setProperty("--wt-color-surface-lifted", "rgb(21, 22, 23)");
    host.style.setProperty("--wt-color-surface", "rgb(24, 25, 26)");
    host.style.setProperty("--wt-color-text", "rgb(31, 32, 33)");
    host.style.setProperty("--wt-color-text-muted", "rgb(34, 35, 36)");
    const current = stripButton(el, "overview");
    const other = stripButton(el, "reports");
    expect(current.getAttribute("aria-current")).toBe("page");
    const style = getComputedStyle(current);
    expect(style.borderInlineStartColor).toBe("rgb(11, 12, 13)");
    expect(style.borderInlineStartWidth).toBe("3px");
    expect(style.backgroundColor).toBe("rgb(21, 22, 23)");
    expect(getComputedStyle(current.querySelector("wt-icon")!).color).toBe("rgb(31, 32, 33)");

    expect(other.hasAttribute("aria-current")).toBe(false);
    const otherStyle = getComputedStyle(other);
    expect(otherStyle.borderInlineStartColor).not.toBe("rgb(11, 12, 13)");
    expect(otherStyle.backgroundColor).not.toBe("rgb(21, 22, 23)");
    expect(getComputedStyle(other.querySelector("wt-icon")!).color).toBe("rgb(34, 35, 36)");

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
  it("keeps the open section's tile visible after the pointer leaves its icon", async () => {
    await atSize(1280, 800, async () => {
      const { el, host } = await mountFoldedReading("menu");
      host.style.setProperty("--wt-color-surface", "rgb(21, 22, 23)");
      const menu = stripButton(el, "menu");
      expect(menu.hasAttribute("aria-current")).toBe(false);
      await userEvent.click(menu);
      await el.updateComplete;
      await commands.parkPointer();
      expect(menu.matches(":hover")).toBe(false);
      expect(menu.getAttribute("aria-expanded")).toBe("true");
      expect.soft(getComputedStyle(menu).backgroundColor).toBe("rgb(21, 22, 23)");

      await userEvent.click(menu);
      await el.updateComplete;
      await commands.parkPointer();
      expect(menu.getAttribute("aria-expanded")).toBe("false");
      expect(getComputedStyle(menu).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    });
  });

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
      host.style.setProperty("--wt-color-text", "rgb(1, 2, 3)");
      await userEvent.click(stripButton(el, "reports"));
      await el.updateComplete;
      const label = panel(el)!.querySelector<HTMLElement>(".strip-panel-label")!;
      expect.soft(getComputedStyle(label).textTransform).toBe("none");
      expect.soft(getComputedStyle(label).letterSpacing).toBe("normal");
      expect.soft(getComputedStyle(label).color).toBe("rgb(1, 2, 3)");
      expect(getComputedStyle(panelPages(el)[0]!).paddingInlineStart).toBe("12px");
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
    await atSize(1280, 650, async () => {
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

  it("picking the page already showing closes it too, putting focus on its icon", async () => {
    await atSize(1280, 800, async () => {
      const { el } = await mountFoldedReading("team");
      await userEvent.click(stripButton(el, "team"));
      await el.updateComplete;
      await userEvent.click(
        panel(el)!.querySelector<HTMLButtonElement>("[data-test=strip-panel-approvals]")!,
      );
      await expect
        .poll(() => el.shadowRoot!.querySelector("dashboard-approvals-screen"))
        .not.toBeNull();
      await userEvent.click(stripButton(el, "team"));
      await el.updateComplete;
      const current = panel(el)!.querySelector<HTMLButtonElement>(
        "[data-test=strip-panel-approvals]",
      )!;
      expect(current.getAttribute("aria-current")).toBe("page");
      await userEvent.click(current);
      await el.updateComplete;
      expect(panel(el)).toBeNull();
      expect(stripButton(el, "team").getAttribute("aria-expanded")).toBe("false");
      expect(el.shadowRoot!.querySelector("dashboard-approvals-screen")).not.toBeNull();
      expect(el.shadowRoot!.activeElement).toBe(stripButton(el, "team"));
    });
  });

  it("its icon names the panel it controls only while the panel is there", async () => {
    await atSize(1280, 800, async () => {
      const { el } = await mountFoldedReading("team");
      const team = stripButton(el, "team");
      expect(team.hasAttribute("aria-controls")).toBe(false);
      await userEvent.click(team);
      await el.updateComplete;
      expect(el.shadowRoot!.getElementById(team.getAttribute("aria-controls")!)).toBe(panel(el));
      await userEvent.click(team);
      await el.updateComplete;
      expect(panel(el)).toBeNull();
      expect(team.hasAttribute("aria-controls")).toBe(false);
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

  it.each(["isComposing", "keyCode 229"] as const)(
    "an Escape that belongs to an input method's composition (%s) leaves it open",
    async (how) => {
      await atSize(1280, 800, async () => {
        const { el } = await mountFoldedReading("team");
        stripButton(el, "team").focus();
        await userEvent.keyboard("{Enter}");
        await el.updateComplete;
        const event = new KeyboardEvent("keydown", {
          key: "Escape",
          isComposing: how === "isComposing",
          bubbles: true,
          composed: true,
        });
        if (how === "keyCode 229") Object.defineProperty(event, "keyCode", { value: 229 });
        panelPages(el)[0]!.dispatchEvent(event);
        await el.updateComplete;
        expect(panel(el)).not.toBeNull();
      });
    },
  );

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

  it("hides its icon's tooltip while open, with the pointer still on the icon", async () => {
    await atSize(1280, 800, async () => {
      const { el } = await mountFoldedReading("team");
      const team = stripButton(el, "team");
      const tooltip = team.querySelector<HTMLElement>(".icon-tooltip")!;
      await userEvent.hover(team);
      expect(getComputedStyle(tooltip).display).not.toBe("none");
      await userEvent.click(team);
      await el.updateComplete;
      expect(team.matches(":hover")).toBe(true);
      expect(getComputedStyle(tooltip).display).toBe("none");
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
        roleIds: ["staff"],
        permissions: ["payment.take"],
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
        else await userEvent.tab();
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
