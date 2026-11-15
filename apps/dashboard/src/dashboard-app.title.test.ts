import { afterEach, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "./api/client.js";
import { DashboardApp } from "./dashboard-app.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";

const original = { locale: currentLocale(), path: location.href, title: document.title };
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  setLocale(original.locale);
  history.replaceState(null, "", original.path);
  document.title = original.title;
});

const LOCALES = [
  { code: "en-GB", label: "English" },
  { code: "es-ES", label: "Español" },
];

function signedIn(locale: string): DashboardApi {
  const api = {
    liveData: new LiveData(),
    getMe: async () => ({
      personId: "owner",
      roleIds: ["manager"],
      email: "owner@example.test",
      locale,
      venueLocale: locale,
      sessionDefault: locale,
      venueName: "Test venue",
      modules: [],
      permissions: ["venue.view", "node.manage"],
      sessionExpiresInSeconds: 1800,
      sessionIdleTimeoutSeconds: 1800,
    }),
    getGoogleConfig: async () => ({ configured: false }),
    getVenueTheme: async () => ({ hash: "waitron", css: "", logo: null }),
    getLegalAbout: async () => ({ release: null, build: "test" }),
    getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
    getLocales: async () => ({
      locales: LOCALES,
      venueDefault: locale,
      loginDefault: locale,
      venueName: "Test venue",
    }),
    listAlerts: async () => ({ visible: false, alerts: [] }),
    getDiskStop: async () => ({ stopped: false, deleted: null }),
    listServers: async () => ({ term: 2, authorityFingerprint: null, nodes: [] }),
  } as unknown as DashboardApi;
  Object.defineProperty(api, "background", { get: () => api });
  return api;
}

async function mount(api: DashboardApi, path: string): Promise<DashboardApp> {
  history.replaceState(null, "", path);
  const { el } = await mountWidget<DashboardApp>("dashboard-app", {
    api,
    request: vi.fn(async () => {
      throw new Error("Unexpected module request");
    }),
  });
  return el;
}

it.each([
  { locale: "en-GB", servers: "Servers · Waitron", overview: "Overview · Waitron" },
  { locale: "es-ES", servers: "Servidores · Waitron", overview: "Resumen · Waitron" },
])(
  "the browser tab names the open screen in $locale and follows navigation",
  async ({ locale, servers, overview }) => {
    setLocale(locale);
    const el = await mount(signedIn(locale), "/manage/servers");
    await vi.waitFor(() => expect(document.title).toBe(servers));
    let link: HTMLElement | null = null;
    await vi.waitFor(() => {
      link = el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-overview]");
      expect(link).not.toBeNull();
    });
    link!.click();
    await vi.waitFor(() => expect(document.title).toBe(overview));
  },
);

it("the browser tab's title changes language with the dashboard", async () => {
  setLocale("en-GB");
  await mount(signedIn("en-GB"), "/manage/servers");
  await vi.waitFor(() => expect(document.title).toBe("Servers · Waitron"));
  setLocale("es-ES");
  await vi.waitFor(() => expect(document.title).toBe("Servidores · Waitron"));
});

it.each([
  { locale: "en-GB", title: "Waitron Dashboard" },
  { locale: "es-ES", title: "Panel de Waitron" },
])("the sign-in page's tab reads $title in $locale", async ({ locale, title }) => {
  setLocale(locale);
  const api = {
    getMe: async () => {
      throw { code: "management_session.required" };
    },
    getVenueTheme: async () => ({ hash: "waitron", css: "", logo: null }),
    getLegalAbout: async () => ({ release: null, build: "test" }),
    getGoogleConfig: async () => ({ configured: false }),
    forgetLocales: () => {},
    getLocales: async () => ({
      locales: LOCALES,
      venueDefault: locale,
      loginDefault: locale,
      venueName: "Venue",
    }),
  } as unknown as DashboardApi;
  document.title = "";
  const el = await mount(api, "/manage/");
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-login-screen")).not.toBeNull(),
  );
  await vi.waitFor(() => expect(document.title).toBe(title));
});
