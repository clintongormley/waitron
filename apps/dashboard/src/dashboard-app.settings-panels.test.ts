import { html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import type { DashboardContribution } from "@waitron/dashboard-kit";
import { DASHBOARD_MODULES } from "@waitron/dashboard-modules";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";
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
    getCatalogueSettings: vi.fn().mockResolvedValue({ defaultProductVatClass: "reduced" }),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    getSalesOverview: pending(),
    listAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
    getVenueDetails: vi.fn().mockResolvedValue(venueDetailsFixture()),
    getReceipt: pending(),
    getLocationSettings: pending(),
    getReceiptLanguage: pending(),
    listStatuses: vi.fn().mockResolvedValue([]),
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
  expect(tabKeys(el)).toEqual(["receipts", "tables", "kitchen"]);
  expect(page(el).shadowRoot!.querySelector("[data-test=panel-reasons]")).toBeNull();
  expect(page(el).shadowRoot!.querySelector("[data-test=panel-gadgets]")).toBeNull();
  expect(location.pathname).toBe("/manage/venue-settings/view/receipts");
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
it("preserves an explicitly selected Receipts link for a manager with venue access", async () => {
  const el = await mount("/manage/venue-settings/view/receipts", "manager", [
    "venue.view",
    "venue.configure",
  ]);
  expect(tabKeys(el)[0]).toBe("venue-details");
  expect(location.pathname).toBe("/manage/venue-settings/view/receipts");
  expect(page(el).shadowRoot!.querySelector("wt-tabs")!.value).toBe("receipts");
});

it.each([
  ["manager", ["person.manage", "venue.view", "venue.configure"], true],
  ["supervisor", ["venue.view"], false],
])(
  "shows product defaults to %s according to catalogue access",
  async (role, permissions, visible) => {
    const el = await mount("/manage/venue-settings/view/venue-details", role, permissions);
    const panel = page(el).shadowRoot!.querySelector("dashboard-catalogue-settings-panel");
    expect(panel !== null).toBe(visible);
    if (panel) {
      await expect
        .poll(() => panel.shadowRoot?.querySelector("wt-combobox")?.value)
        .toBe("reduced");
    }
  },
);
