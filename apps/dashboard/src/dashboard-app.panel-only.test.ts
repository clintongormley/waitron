import { html } from "lit";
import { page as browserPage, userEvent } from "vitest/browser";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import type { DashboardContribution } from "@waitron/dashboard-kit";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";
import type { DashboardApi } from "./api/client.js";
import "./dashboard-app.js";
import { venueDetailsFixture } from "./testing/venue-details-fixture.js";
import type { DashboardApp } from "./dashboard-app.js";
import type { UrlPathConfig, WtInput } from "@waitron/ui";
import { dashboardPath } from "./navigation.js";

// "certs" brings one Venue details panel and no screen of its own. "gauges" is the control: a module
// built the same way but WITH a screen, so each "adds nothing" check below is one a contribution
// that did add an entry would fail.
function panelOnlyModule() {
  return {
    module: "certs",
    strings: { en: { "nav.certs": "Certificate" }, es: { "nav.certs": "Certificado" } },
    settingsPanels: [
      {
        id: "certs-card",
        tab: "venue-details",
        order: 1,
        requiresPermission: "test.use",
        create: () => ({ render: () => html`<p data-test="panel-certs">Certificate</p>` }),
      },
    ],
  } satisfies DashboardContribution;
}
function screenedModule() {
  return {
    module: "gauges",
    strings: { en: { "nav.gauges": "Gauges" }, es: { "nav.gauges": "Gauges" } },
    screen: {
      id: "gauges",
      navLabelKey: "nav.gauges",
      group: "reports",
      requiresPermission: "test.use",
    },
    create: () => ({ render: () => html`<p data-test="screen-gauges">Gauges</p>` }),
  } satisfies DashboardContribution;
}

vi.mock("@waitron/dashboard-modules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@waitron/dashboard-modules")>()),
  DASHBOARD_MODULES: [panelOnlyModule(), screenedModule()],
}));

// The app's address controller lives in a private field, so its settings are read as they are
// handed to the constructor.
const urlConfigs = vi.hoisted((): UrlPathConfig[] => []);
vi.mock("@waitron/ui", async (importOriginal) => {
  const original = await importOriginal<typeof import("@waitron/ui")>();
  class RecordingUrlStateController extends original.UrlStateController {
    constructor(...args: ConstructorParameters<typeof original.UrlStateController>) {
      super(...args);
      urlConfigs.push(args[2]);
    }
  }
  return { ...original, UrlStateController: RecordingUrlStateController };
});

const initialUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  history.replaceState(null, "", initialUrl);
  setLocale("es-ES");
});

function stubApi(modules: string[]): DashboardApi {
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
      permissions: ["venue.view", "venue.configure", "test.use"],
      modules,
    }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }),
    getCatalogueSettings: vi
      .fn()
      .mockResolvedValue({ defaultProductVatClass: "reduced", defaultColor: null }),
    getVenueTheme: vi.fn().mockResolvedValue({ hash: "waitron", css: "", logo: null }),
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
  } as unknown as DashboardApi;
}

async function mount(path: string, modules = ["certs"]): Promise<DashboardApp> {
  const url = new URL(location.href);
  url.pathname = path;
  history.replaceState(null, "", url);
  const { el } = await mountWidget<DashboardApp>("dashboard-app", {
    api: stubApi(modules),
    request: async () => [] as never,
  });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("nav")).not.toBeNull());
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  return el;
}

const settings = (el: DashboardApp) =>
  el.shadowRoot!.querySelector("dashboard-venue-settings-screen");
const navItems = (el: DashboardApp) =>
  [...el.shadowRoot!.querySelectorAll<HTMLElement>(".nav-item")].map((item) => item.dataset.test);

it("shows a panel-only module's panel on Venue details after the core panels", async () => {
  const el = await mount("/manage/venue-settings/view/venue-details");
  await vi.waitFor(() => expect(settings(el)).not.toBeNull());
  const details = () =>
    settings(el)!.shadowRoot!.querySelector('[data-test="venue-settings-venue-details"]');
  await vi.waitFor(() =>
    expect(details()?.querySelector("[data-test=panel-certs]")).not.toBeNull(),
  );
  const children = [...details()!.children].map((child) => child.tagName.toLowerCase());
  expect(children).toEqual([
    "dashboard-venue-details-panel",
    "dashboard-venue-defaults-panel",
    "p",
  ]);
});

it("adds nothing to the nav for a panel-only module, where a screened module adds its screen", async () => {
  const screenedOnly = navItems(await mount("/manage", ["gauges"]));
  cleanupWidgets();
  const both = navItems(await mount("/manage", ["gauges", "certs"]));
  expect(screenedOnly).toContain("nav-gauges");
  expect(both).toEqual(screenedOnly);
});

it("lets the nav search find a screened module by its label, and nothing of a panel-only one", async () => {
  // Below the drawer breakpoint a closed drawer is inert and its search box cannot take focus.
  const [width, height] = [window.innerWidth, window.innerHeight];
  await browserPage.viewport(1280, 800);
  onTestFinished(() => browserPage.viewport(width, height));
  const el = await mount("/manage", ["gauges", "certs"]);
  const box = el.shadowRoot!.querySelector<WtInput>("[data-test=nav-search]")!;
  async function search(term: string): Promise<(string | undefined)[]> {
    box.focus();
    box.shadowRoot!.querySelector("input")!.select();
    await userEvent.keyboard(term);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    return [...el.shadowRoot!.querySelectorAll<HTMLElement>(".nav-item, [data-search-destination]")]
      .filter((item) => item.checkVisibility())
      .map((item) => item.dataset.test ?? item.dataset.searchDestination);
  }
  expect(await search("gauge")).toEqual(["nav-gauges"]);
  // "nav.certs" reads "Certificate" and "Certificado"; a screen labelled by it would be found here.
  expect(await search("certif")).toEqual([]);
});

it("keeps a screened module's address word, and none for a panel-only module", async () => {
  urlConfigs.length = 0;
  await mount("/manage");
  const config = urlConfigs.find((each) => each.basePath === "/manage");
  expect(config?.keepUnlisted).toEqual([...(dashboardPath.keepUnlisted ?? []), "gauges"]);
});
