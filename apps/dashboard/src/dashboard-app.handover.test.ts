import { afterEach, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "./api/client.js";
import { DashboardApp } from "./dashboard-app.js";
import type { ServersScreen } from "./screens/servers-screen.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";

const original = { locale: currentLocale(), path: location.href };
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  setLocale(original.locale);
  history.replaceState(null, "", original.path);
});
it.each([true, false])(
  "the real shell passes promotion permission (%s) and opens the handover page",
  async (allowed) => {
    localStorage.clear();
    sessionStorage.clear();
    setLocale("en-GB");
    const api = {
      liveData: new LiveData(),
      getMe: async () => ({
        personId: "owner",
        roleIds: ["manager"],
        email: "owner@example.test",
        locale: "en-GB",
        venueLocale: "en-GB",
        sessionDefault: "en-GB",
        venueName: "Test venue",
        modules: [],
        permissions: allowed ? ["venue.view", "node.manage"] : ["venue.view"],
        sessionExpiresInSeconds: 1800,
        sessionIdleTimeoutSeconds: 1800,
      }),
      getGoogleConfig: async () => ({ configured: false }),
      getVenueTheme: async () => ({ hash: "waitron", css: "", logo: null }),
      getLegalAbout: async () => ({ release: null, build: "test" }),
      getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
      getLocales: async () => ({
        locales: [{ code: "en-GB", label: "English" }],
        venueDefault: "en-GB",
        loginDefault: "en-GB",
        venueName: "Test venue",
      }),
      listAlerts: async () => ({ visible: false, alerts: [] }),
      getDiskStop: async () => ({ stopped: false, deleted: null }),
      listServers: async () => ({ term: 2, authorityFingerprint: null, nodes: [] }),
    } as unknown as DashboardApi;
    Object.defineProperty(api, "background", { get: () => api });
    history.replaceState(null, "", "/manage/servers");
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api,
      request: vi.fn(async () => {
        throw new Error("Unexpected module request");
      }),
    });
    if (!allowed) {
      await vi.waitFor(() => {
        expect(el.shadowRoot!.querySelector("dashboard-overview-screen")).not.toBeNull();
        expect(el.shadowRoot!.querySelector("dashboard-servers-screen")).toBeNull();
      });
      return;
    }
    let screen: ServersScreen;
    await vi.waitFor(() => {
      screen = el.shadowRoot!.querySelector<ServersScreen>("dashboard-servers-screen")!;
      expect(screen).not.toBeNull();
      expect(screen.canPromote).toBe(allowed);
    });
    const target = `${location.href}#handover-proof`;
    screen!.dispatchEvent(
      new CustomEvent("handover-open", { detail: { url: target }, bubbles: true, composed: true }),
    );
    await vi.waitFor(() => expect(location.href).toBe(target));
  },
);
