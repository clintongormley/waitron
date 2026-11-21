import { html } from "lit";
import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import type { DashboardContribution } from "@waitron/dashboard-kit";
import { DASHBOARD_MODULES } from "@waitron/dashboard-modules";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale, t } from "./i18n/t.js";
import type { DashboardApi } from "./api/client.js";
import "./dashboard-app.js";
import type { DashboardApp } from "./dashboard-app.js";
import type { WtInput } from "@waitron/ui";
import type { PaymentsScreen } from "./screens/payments-screen.js";

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
      roleIds: ["manager"],
      email: "manager@example.com",
      locale: null,
      venueLocale: "es-ES",
      sessionDefault: "es-ES",
      venueName: "Deli Test SL",
      permissions: ["test.use", "venue.view"],
      modules: ["widgets"],
    }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }),
    getVenueTheme: vi.fn().mockResolvedValue({ hash: "waitron", css: "", logo: null }),
    getLegalAbout: vi.fn().mockResolvedValue({ release: null, build: "test" }),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    getSalesOverview: pending(),
    listAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
    getDiskStop: vi.fn().mockResolvedValue({ stopped: false, deleted: null }),
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
  expect(reports).toEqual(["nav-sales", "nav-widget-report", "nav-orders"]);
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
  expect(location.pathname).toBe("/widget-report");
  navItem(el, "widgets")!.click();
  await vi.waitFor(() => expect(shown(el, "widgets")).not.toBeNull());
  expect(shown(el, "widget-report")).toBeNull();
});

it("restores a permitted further screen from its address", async () => {
  const el = await mount("/widget-report");
  await vi.waitFor(() => expect(shown(el, "widget-report")).not.toBeNull());
  expect(navItem(el, "widget-report")!.getAttribute("aria-current")).toBe("page");
});

it("refuses a further screen's address without its permission, and lands on the overview", async () => {
  const el = await mount("/widget-audit");
  await vi.waitFor(() => expect(overview(el)).not.toBeNull());
  expect(shown(el, "widget-audit")).toBeNull();
});

it("finds a further screen by the nav search, and never the one not permitted", async () => {
  // Below the drawer breakpoint a closed drawer is inert and its search box cannot take focus.
  const [width, height] = [window.innerWidth, window.innerHeight];
  await page.viewport(1280, 800);
  onTestFinished(() => page.viewport(width, height));
  const el = await mount();
  const box = el.shadowRoot!.querySelector<WtInput>("[data-test=nav-search]")!;
  const found = () =>
    [...el.shadowRoot!.querySelectorAll<HTMLElement>(".nav-item")]
      .filter((item) => item.checkVisibility())
      .map((item) => item.dataset.test);
  async function search(term: string): Promise<void> {
    box.focus();
    box.shadowRoot!.querySelector("input")!.select();
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

it("opens the core Modules menu for hardware managers without relying on enabled contributions", async () => {
  history.replaceState(null, "", "/modules/view/card-providers/state/all");
  const api = stubApi();
  vi.mocked(api.getMe).mockResolvedValue({
    ...(await api.getMe()),
    permissions: ["hardware.manage"],
    modules: [],
  });
  Object.assign(api, {
    listReaders: async () => [],
    listModules: async () => [{ id: "stripe", category: "card-provider", enabled: true }],
    listPaymentProviders: async () => [
      { providerId: "stripe", state: "connected", canUnpair: false },
    ],
  });
  const { el } = await mountWidget<DashboardApp>("dashboard-app", {
    api,
    request: async () => [] as never,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-modules-screen")).not.toBeNull(),
  );
  const screen = el.shadowRoot!.querySelector("dashboard-modules-screen")!;
  await vi.waitFor(() =>
    expect(
      screen.shadowRoot
        ?.querySelector("wt-data-table")
        ?.shadowRoot?.querySelector("[data-test=disconnect-stripe]"),
    ).toBeTruthy(),
  );
  expect(
    screen
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector("[data-test=switch-stripe]"),
  ).toBeNull();
  expect(navItem(el, "modules")).not.toBeNull();
  expect(location.pathname).toBe("/modules/view/card-providers/state/all");
});

it("redirects the old provider setup address to all card providers", async () => {
  history.replaceState(null, "", "/payments/view/providers");
  const api = stubApi();
  vi.mocked(api.getMe).mockResolvedValue({
    ...(await api.getMe()),
    permissions: ["hardware.manage"],
    modules: [],
  });
  Object.assign(api, { listModules: async () => [], listPaymentProviders: async () => [] });
  const { el } = await mountWidget<DashboardApp>("dashboard-app", {
    api,
    request: async () => [] as never,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-modules-screen")).not.toBeNull(),
  );
  expect(location.pathname).toBe("/modules/view/card-providers/state/all/return-to/card-readers");
});

it.each([true, false])(
  "gates payment checks under Reporting and leaves for a fresh readers page (hardware.manage=%s)",
  async (allowed) => {
    history.replaceState(null, "", "/check-card-payments");
    const api = stubApi();
    vi.mocked(api.getMe).mockResolvedValue({
      ...(await api.getMe()),
      locale: "en",
      permissions: allowed ? ["hardware.manage"] : ["venue.view"],
      modules: [],
    });
    for (const name of [
      "listPaymentProviders",
      "listReaders",
      "listReaderHolders",
      "listStuckPayments",
      "listStuckBillPayments",
      "listStuckTenderRefunds",
      "listStuckBillRefunds",
      "listAbandonedRefunds",
      "listHeldPayments",
    ])
      Object.assign(api, { [name]: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api,
      request: async () => [] as never,
    });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=account-menu]")).not.toBeNull(),
    );
    if (!allowed) {
      await vi.waitFor(() => expect(location.pathname).not.toBe("/check-card-payments"));
      expect(navItem(el, "check-card-payments")).toBeNull();
      expect(el.shadowRoot!.querySelector("dashboard-payments-screen")).toBeNull();
      return;
    }
    expect(navItem(el, "check-card-payments")?.getAttribute("aria-current")).toBe("page");
    expect(
      el.shadowRoot!.querySelector("#nav-group-panel-reports [data-test=nav-check-card-payments]"),
    ).not.toBeNull();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("dashboard-payments-screen")).not.toBeNull(),
    );
    const checks = el.shadowRoot!.querySelector<PaymentsScreen>("dashboard-payments-screen")!;
    expect(checks.surface).toBe("checks");
    expect(checks.shadowRoot!.querySelector("h1")?.textContent?.trim()).toBe(
      t("payments.checks_title"),
    );
    navItem(el, "payments")!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("dashboard-payments-screen")).not.toBe(checks),
    );
    expect(checks.isConnected).toBe(false);
    expect(el.shadowRoot!.querySelector<PaymentsScreen>("dashboard-payments-screen")!.surface).toBe(
      "readers",
    );
  },
);

const FROM_READERS = "/modules/view/card-providers/state/all/return-to/card-readers";

async function mountForCardSetup(path: string) {
  history.replaceState(null, "", path);
  const api = stubApi();
  vi.mocked(api.getMe).mockResolvedValue({
    ...(await api.getMe()),
    locale: "en",
    permissions: ["hardware.manage"],
    modules: [],
  });
  const providers = vi
    .fn()
    .mockResolvedValue([{ providerId: "sumup", state: "not_connected", canUnpair: true }]);
  const availableReaders = vi.fn().mockResolvedValue([]);
  const listModules = vi
    .fn()
    .mockResolvedValue([{ id: "sumup", category: "card-provider", enabled: true }]);
  Object.assign(api, { listModules, listPaymentProviders: providers, availableReaders });
  for (const name of [
    "listReaders",
    "listReaderHolders",
    "listStuckPayments",
    "listStuckBillPayments",
    "listStuckTenderRefunds",
    "listStuckBillRefunds",
    "listAbandonedRefunds",
    "listHeldPayments",
  ])
    Object.assign(api, { [name]: vi.fn().mockResolvedValue([]) });
  const { el } = await mountWidget<DashboardApp>("dashboard-app", {
    api,
    request: async () => ({ merchantName: "Deli" }) as never,
  });
  return { el, providers, availableReaders, listModules };
}

const configureSumup = (el: DashboardApp) =>
  el
    .shadowRoot!.querySelector("dashboard-modules-screen")
    ?.shadowRoot?.querySelector("wt-data-table")
    ?.shadowRoot?.querySelector<HTMLElement>("[data-test=configure-sumup]");

async function connectSumup(el: DashboardApp, providers: ReturnType<typeof vi.fn>): Promise<void> {
  await vi.waitFor(() => expect(configureSumup(el)).toBeTruthy());
  const modules = el.shadowRoot!.querySelector("dashboard-modules-screen")!;
  configureSumup(el)!.click();
  await vi.waitFor(() =>
    expect(modules.shadowRoot!.querySelector("sumup-connect-form")).not.toBeNull(),
  );
  const form = modules.shadowRoot!.querySelector<
    HTMLElement & { updateComplete: Promise<boolean> }
  >("sumup-connect-form")!;
  await form.updateComplete;
  form
    .shadowRoot!.querySelector("[data-test=api-key]")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "synthetic-key" } }));
  await form.updateComplete;
  providers.mockResolvedValue([{ providerId: "sumup", state: "connected", canUnpair: true }]);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]")!.click();
}

it("opens Card readers once a provider connects on Modules, when Card readers sent the person there", async () => {
  const { el, providers, availableReaders } = await mountForCardSetup(FROM_READERS);
  const modules = await vi.waitFor(() => {
    const screen = el.shadowRoot!.querySelector("dashboard-modules-screen");
    expect(screen).not.toBeNull();
    return screen!;
  });
  await connectSumup(el, providers);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-payments-screen")).not.toBeNull(),
  );
  expect(location.pathname).toBe("/payments");
  expect(modules.isConnected).toBe(false);
  expect(navItem(el, "payments")?.getAttribute("aria-current")).toBe("page");
  const readers = el.shadowRoot!.querySelector<PaymentsScreen>("dashboard-payments-screen")!;
  expect(readers.surface).toBe("readers");
  const add = await vi.waitFor(() => {
    const button = readers.shadowRoot!.querySelector<HTMLElement>("[data-test=add-reader]");
    expect(button?.hasAttribute("disabled")).toBe(false);
    return button!;
  });
  add.click();
  await vi.waitFor(() => expect(availableReaders).toHaveBeenCalledWith("sumup"));
});

it("returns to Card readers only once: Back reaches Modules without the return, and a later save stays there", async () => {
  const { el, providers, listModules } = await mountForCardSetup(FROM_READERS);
  await connectSumup(el, providers);
  await vi.waitFor(() => expect(location.pathname).toBe("/payments"));
  providers.mockResolvedValue([{ providerId: "sumup", state: "not_connected", canUnpair: true }]);
  history.back();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-modules-screen")).not.toBeNull(),
  );
  expect(location.pathname).toBe("/modules/view/card-providers/state/all");
  await vi.waitFor(() => expect(configureSumup(el)).toBeTruthy());
  const reads = listModules.mock.calls.length;
  await connectSumup(el, providers);
  await vi.waitFor(() => expect(listModules.mock.calls.length).toBeGreaterThan(reads));
  expect(location.pathname).toBe("/modules/view/card-providers/state/all");
  expect(el.shadowRoot!.querySelector("dashboard-modules-screen")).not.toBeNull();
});

it("does not carry the Card readers return into another screen's address", async () => {
  const { el } = await mountForCardSetup(FROM_READERS);
  await vi.waitFor(() => expect(navItem(el, "orders")).not.toBeNull());
  navItem(el, "orders")!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-orders-screen")).not.toBeNull(),
  );
  expect(location.pathname).toBe("/orders");
});
