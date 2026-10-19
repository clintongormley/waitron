import { html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import type { DashboardContribution } from "@waitron/dashboard-kit";
import { DASHBOARD_MODULES } from "@waitron/dashboard-modules";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale, t } from "./i18n/t.js";
import { vatClassLabel } from "./screens/venue-defaults-panel.js";
import type { DashboardApi } from "./api/client.js";
import "./dashboard-app.js";
import { venueDetailsFixture } from "./testing/venue-details-fixture.js";
import type { DashboardApp } from "./dashboard-app.js";

// "widgets" adds kitchen panels this session may see and an adjustment-reasons panel it may not;
// "gadgets" is not enabled for the venue and adds an adjustment-reasons panel too. No core panel
// sits on that tab, so with both left out the tab itself is absent.
function panelModule(module: string, panels: DashboardContribution["settingsPanels"]) {
  return {
    module,
    screen: {
      id: `${module}-home`,
      navLabelKey: `nav.${module}`,
      group: "reports",
      requiresPermission: "test.use",
    },
    strings: { en: { [`nav.${module}`]: module }, es: { [`nav.${module}`]: module } },
    create: () => ({ render: () => html`<p>${module}</p>` }),
    settingsPanels: panels,
  } satisfies DashboardContribution;
}
// A function declaration, not a `const`: `vi.mock` is hoisted above the module body, and its
// factory would otherwise read `shown` before initialization.
function shown(id: string) {
  return () => ({ render: () => html`<p data-test=${`panel-${id}`}>${id}</p>` });
}

vi.mock("@waitron/dashboard-modules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@waitron/dashboard-modules")>()),
  DASHBOARD_MODULES: [
    panelModule("widgets", [
      {
        id: "widgets-late",
        tab: "kitchen",
        order: 5,
        requiresPermission: "test.use",
        create: shown("late"),
      },
      {
        id: "widgets-early",
        tab: "kitchen",
        order: -1,
        requiresPermission: "test.use",
        create: shown("early"),
      },
      {
        id: "widgets-reasons",
        tab: "adjustment-reasons",
        requiresPermission: "test.audit",
        create: shown("reasons"),
      },
    ]),
    panelModule("gadgets", [
      {
        id: "gadgets-reasons",
        tab: "adjustment-reasons",
        requiresPermission: "test.use",
        create: shown("gadgets"),
      },
    ]),
  ],
}));

const initialUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  history.replaceState(null, "", initialUrl);
  setLocale("es-ES");
});

function stubApi(role = "manager", permissions = ["test.use"]): DashboardApi {
  const pending = () => vi.fn(() => new Promise(() => undefined));
  return {
    getMe: vi.fn().mockResolvedValue({
      personId: "p1",
      role,
      email: "manager@example.com",
      locale: null,
      venueLocale: "es-ES",
      sessionDefault: "es-ES",
      venueName: "Deli Test SL",
      permissions,
      modules: ["widgets"],
    }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }),
    getCatalogueSettings: vi
      .fn()
      .mockResolvedValue({ defaultProductVatClass: "reduced", defaultColor: null }),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    getSalesOverview: pending(),
    listAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
    getVenueDetails: vi.fn().mockResolvedValue(venueDetailsFixture()),
    getVenueDefaults: vi.fn().mockResolvedValue({
      receiptLanguage: "es-ES",
      receiptLanguageChoices: ["es-ES"],
      fixedReceiptLanguage: null,
      defaultProductVatClass: "reduced",
    }),
    listCourses: vi.fn().mockResolvedValue([]),
    getBumpMode: vi.fn().mockResolvedValue({ mode: "line" }),
    getKitchenTimingDefaults: vi.fn().mockResolvedValue({
      warmAfterMinutes: 5,
      overdueAfterMinutes: 10,
      forgottenAfterMinutes: 15,
    }),
    setKitchenTimingDefaults: vi.fn().mockResolvedValue(undefined),
    getFireControl: vi.fn().mockResolvedValue({ mode: "waiter" }),
  } as unknown as DashboardApi;
}

async function mount(
  path: string,
  role = "manager",
  permissions = ["test.use"],
): Promise<DashboardApp> {
  const url = new URL(location.href);
  url.pathname = path;
  history.replaceState(null, "", url);
  const { el } = await mountWidget<DashboardApp>("dashboard-app", {
    api: stubApi(role, permissions),
    request: async () => [] as never,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-venue-settings-screen")).not.toBeNull(),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  return el;
}
const page = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-venue-settings-screen")!;
const tabKeys = (el: DashboardApp) =>
  [
    ...page(el).shadowRoot!.querySelector("wt-tabs")!.shadowRoot!.querySelectorAll('[role="tab"]'),
  ].map((tab) => tab.getAttribute("data-key"));

it("puts a module's panels on their tab by their stated order, the core panel counting as 0", async () => {
  const el = await mount("/manage/venue-settings/view/kitchen");
  const kitchen = page(el).shadowRoot!.querySelector('[slot="kitchen"]')!;
  const children = [...kitchen.children].map((child) =>
    child.tagName === "DASHBOARD-KITCHEN-SCREEN" ? "core" : (child as HTMLElement).dataset.test,
  );
  expect(children).toEqual(["panel-early", "core", "panel-late"]);
});

it("leaves out a panel the session lacks the permission for, and a disabled module's panel", async () => {
  const el = await mount("/manage/venue-settings/view/adjustment-reasons");
  expect(tabKeys(el)).toEqual(["kitchen"]);
  expect(page(el).shadowRoot!.querySelector("[data-test=panel-reasons]")).toBeNull();
  expect(page(el).shadowRoot!.querySelector("[data-test=panel-gadgets]")).toBeNull();
  expect(location.pathname).toBe("/manage/venue-settings/view/kitchen");
});

it("refuses to start when a module names an unknown settings tab", async () => {
  const list = DASHBOARD_MODULES as unknown as unknown[];
  const original = [...list];
  list.length = 0;
  list.push(
    panelModule("widgets", [
      { id: "lost", tab: "nowhere", requiresPermission: "test.use", create: shown("lost") },
    ]),
  );
  try {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi(),
      request: async () => [] as never,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    // The throw lands in the session probe's catch, which drops to login; a silent skip would not.
    expect(el.shadowRoot!.querySelector("dashboard-login-screen")).not.toBeNull();
  } finally {
    list.length = 0;
    list.push(...original);
  }
});

it("refuses to start when a module repeats a core panel's id", async () => {
  const list = DASHBOARD_MODULES as unknown as unknown[];
  const original = [...list];
  list.length = 0;
  list.push(
    panelModule("widgets", [
      { id: "kitchen", tab: "kitchen", requiresPermission: "test.use", create: shown("dup") },
    ]),
  );
  try {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi(),
      request: async () => [] as never,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("dashboard-login-screen")).not.toBeNull();
  } finally {
    list.length = 0;
    list.push(...original);
  }
});

it.each([
  ["manager", ["venue.view", "venue.configure", "test.use"], false],
  ["supervisor", ["venue.view", "test.use"], true],
])(
  "mounts core venue details for %s using venue.configure for editing",
  async (role, permissions, readOnly) => {
    const el = await mount("/manage/venue-settings", role, permissions);
    expect(tabKeys(el)[0]).toBe("venue-details");
    expect(location.pathname).toBe("/manage/venue-settings/view/venue-details");
    const panel = page(el).shadowRoot!.querySelector(
      "dashboard-venue-details-panel",
    ) as HTMLElement & { readOnly: boolean };
    expect(panel).not.toBeNull();
    expect(panel.readOnly).toBe(readOnly);
    expect(panel.shadowRoot!.querySelector("h1")).toBeNull();
    expect(page(el).shadowRoot!.querySelectorAll("h1")).toHaveLength(1);
  },
);
it("replaces a removed Receipts deep link with Venue details for a manager with venue access", async () => {
  const el = await mount("/manage/venue-settings/view/receipts", "manager", [
    "venue.view",
    "venue.configure",
  ]);
  expect(tabKeys(el)[0]).toBe("venue-details");
  expect(location.pathname).toBe("/manage/venue-settings/view/venue-details");
  expect(page(el).shadowRoot!.querySelector("wt-tabs")!.value).toBe("venue-details");
});

it("shows the VAT class for new products in the Defaults card to venue.configure without catalogue.manage", async () => {
  const el = await mount("/manage/venue-settings/view/venue-details", "manager", [
    "venue.view",
    "venue.configure",
  ]);
  const defaults = () =>
    page(el).shadowRoot!.querySelector("dashboard-venue-defaults-panel")?.shadowRoot ?? null;
  await expect
    .poll(
      () => defaults()?.querySelector('[data-test="saved-defaultProductVatClass"]')?.textContent,
    )
    .toBe(vatClassLabel("reduced"));
});

it("shows a supervisor the Defaults card's values with nothing to edit", async () => {
  const el = await mount("/manage/venue-settings/view/venue-details", "supervisor", ["venue.view"]);
  const defaults = () =>
    page(el).shadowRoot!.querySelector("dashboard-venue-defaults-panel")?.shadowRoot ?? null;
  await expect
    .poll(
      () => defaults()?.querySelector('[data-test="saved-defaultProductVatClass"]')?.textContent,
    )
    .toBe(vatClassLabel("reduced"));
  expect(defaults()!.querySelector('[data-test="saved-receiptLanguage"]')).not.toBeNull();
  expect(defaults()!.querySelector('[data-test="edit"]')).toBeNull();
  expect(defaults()!.querySelector("wt-combobox")).toBeNull();
});

it("orders the Venue details cards Business, Venue, Business day, Defaults", async () => {
  const el = await mount("/manage/venue-settings/view/venue-details", "manager", [
    "venue.view",
    "venue.configure",
  ]);
  const h2s = (root: ParentNode): string[] =>
    [...root.querySelectorAll("*")].flatMap((node) => [
      ...(node.matches(".settings-card > header > h2") ? [node.textContent!.trim()] : []),
      ...(node.shadowRoot ? h2s(node.shadowRoot) : []),
    ]);
  const headings = () =>
    h2s(page(el).shadowRoot!.querySelector('[data-test="venue-settings-venue-details"]')!);
  await expect
    .poll(headings)
    .toEqual([
      t("venue_settings.card.business"),
      t("venue_settings.card.venue"),
      t("venue_settings.card.business_day"),
      t("venue_settings.card.defaults"),
    ]);
});
