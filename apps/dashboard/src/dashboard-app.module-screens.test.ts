import { html } from "lit";
import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import type { DashboardContribution } from "@waitron/dashboard-kit";
import { DASHBOARD_MODULES } from "@waitron/dashboard-modules";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";
import type { DashboardApi } from "./api/client.js";
import "./dashboard-app.js";
import type { DashboardApp } from "./dashboard-app.js";

// One module with three screens: its primary one and a second anyone with `test.use` may open, and
// a third that asks for a permission this session does not hold.

function screen(id: string, label: string, group: string, requiresPermission: string) {
  return {
    screen: { id, navLabelKey: `nav.${id}`, group, requiresPermission },
    create: () => ({ render: () => html`<p data-test=${`screen-${id}`}>${label}</p>` }),
    label,
  };
}

function threeScreenModule(): DashboardContribution {
  const primary = screen("widgets", "Widgets", "service", "test.use");
  const report = screen("widget-report", "Widget report", "reports", "test.use");
  const secret = screen("widget-audit", "Widget audit", "reports", "test.audit");
  const strings = Object.fromEntries(
    [primary, report, secret].map((each) => [`nav.${each.screen.id}`, each.label]),
  );
  return {
    module: "widgets",
    screen: primary.screen,
    strings: { en: strings, es: strings },
    create: primary.create,
    moreScreens: [
      { screen: report.screen, create: report.create },
      { screen: secret.screen, create: secret.create },
    ],
  };
}

vi.mock("@waitron/dashboard-modules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@waitron/dashboard-modules")>()),
  DASHBOARD_MODULES: [threeScreenModule()],
}));

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

function stubApi(): DashboardApi {
  const pending = () => vi.fn(() => new Promise(() => undefined));
  return {
    getMe: vi.fn().mockResolvedValue({
      personId: "p1",
      role: "manager",
      email: "manager@example.com",
      locale: null,
      venueLocale: "es-ES",
      sessionDefault: "es-ES",
      venueName: "Deli Test SL",
      permissions: ["test.use"],
      modules: ["widgets"],
    }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    getSalesOverview: pending(),
    listAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
  } as unknown as DashboardApi;
}

async function mount(path?: string): Promise<DashboardApp> {
  if (path !== undefined) {
    const url = new URL(location.href);
    url.pathname = path;
    history.replaceState(null, "", url);
  }
  const { el } = await mountWidget<DashboardApp>("dashboard-app", {
    api: stubApi(),
    request: async () => [] as never,
  });
  await vi.waitFor(() => expect(navItem(el, "widgets")).not.toBeNull());
  return el;
}

const navItem = (el: DashboardApp, id: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="nav-${id}"]`);
const shown = (el: DashboardApp, id: string) =>
  el.shadowRoot!.querySelector(`[data-test="screen-${id}"]`);
const overview = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-overview-screen");

it("lists a module's further screen in its own nav group, and leaves out the one not permitted", async () => {
  const el = await mount();
  const reports = [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>("#nav-group-panel-reports [data-test]"),
  ].map((item) => item.dataset.test);
  expect(reports).toEqual(["nav-overview", "nav-sales", "nav-widget-report"]);
  expect(navItem(el, "widget-report")!.textContent!.trim()).toBe("Widget report");
  expect(navItem(el, "widget-audit")).toBeNull();
  expect(
    el.shadowRoot!.querySelector("#nav-group-panel-service [data-test=nav-widgets]"),
  ).not.toBeNull();
});

it("opens a further screen from the nav, and the primary one still opens", async () => {
  const el = await mount();
  navItem(el, "widget-report")!.click();
  await vi.waitFor(() => expect(shown(el, "widget-report")).not.toBeNull());
  expect(location.pathname).toBe("/manage/widget-report");
  navItem(el, "widgets")!.click();
  await vi.waitFor(() => expect(shown(el, "widgets")).not.toBeNull());
  expect(shown(el, "widget-report")).toBeNull();
});

it("restores a permitted further screen from its address", async () => {
  const el = await mount("/manage/widget-report");
  await vi.waitFor(() => expect(shown(el, "widget-report")).not.toBeNull());
  expect(navItem(el, "widget-report")!.getAttribute("aria-current")).toBe("page");
});

it("refuses a further screen's address without its permission, and lands on the overview", async () => {
  const el = await mount("/manage/widget-audit");
  await vi.waitFor(() => expect(overview(el)).not.toBeNull());
  expect(shown(el, "widget-audit")).toBeNull();
});

it("finds a further screen by the nav search, and never the one not permitted", async () => {
  // Below the drawer breakpoint a closed drawer is inert and its search box cannot take focus.
  const [width, height] = [window.innerWidth, window.innerHeight];
  await page.viewport(1280, 800);
  onTestFinished(() => page.viewport(width, height));
  const el = await mount();
  const box = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=nav-search]")!;
  const found = () =>
    [...el.shadowRoot!.querySelectorAll<HTMLElement>(".nav-item")]
      .filter((item) => item.checkVisibility())
      .map((item) => item.dataset.test);
  async function search(term: string): Promise<void> {
    box.focus();
    box.select();
    await userEvent.keyboard(term);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
  await search("widget");
  expect(found()).toEqual(["nav-widget-report", "nav-widgets"]);
  await search("audit");
  expect(found()).toEqual([]);
});

it("refuses to start when a further screen names an unknown nav group", async () => {
  const report = DASHBOARD_MODULES[0]!.moreScreens![0]!.screen;
  report.group = "nowhere";
  try {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi(),
      request: async () => [] as never,
    });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("dashboard-login-screen")).not.toBeNull(),
    );
    expect(navItem(el, "widgets")).toBeNull();
  } finally {
    report.group = "reports";
  }
});

// "sales" is in the nav; "alerts" is a built-in screen the nav does not list.
it.each(["sales", "alerts"])(
  "refuses to start when a module screen reuses the built-in screen id %s",
  async (id) => {
    const report = DASHBOARD_MODULES[0]!.moreScreens![0]!.screen;
    report.id = id;
    try {
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api: stubApi(),
        request: async () => [] as never,
      });
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("dashboard-login-screen")).not.toBeNull(),
      );
      expect(navItem(el, "widgets")).toBeNull();
    } finally {
      report.id = "widget-report";
    }
  },
);

it("refuses to start when a further screen repeats another screen's id", async () => {
  const report = DASHBOARD_MODULES[0]!.moreScreens![0]!.screen;
  report.id = "widgets";
  try {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi(),
      request: async () => [] as never,
    });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("dashboard-login-screen")).not.toBeNull(),
    );
    expect(navItem(el, "widgets")).toBeNull();
  } finally {
    report.id = "widget-report";
  }
});
