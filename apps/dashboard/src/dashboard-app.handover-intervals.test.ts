import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import type { DashboardApi } from "./api/client.js";
import { DashboardApp } from "./dashboard-app.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
it.each([true, false])(
  "gates navigation and the direct address by report.view (%s)",
  async (allowed) => {
    history.replaceState(null, "", "/manage/handover-intervals");
    const list = vi.fn().mockResolvedValue({ intervals: [], timeZone: "Europe/Madrid" });
    const api = {
      liveData: new LiveData(),
      getMe: async () => ({
        personId: "reader",
        role: "supervisor",
        email: "reader@example.test",
        locale: "en-GB",
        venueLocale: "en-GB",
        sessionDefault: "en-GB",
        venueName: "Test venue",
        modules: [],
        permissions: allowed ? ["venue.view", "report.view"] : ["venue.view"],
        sessionExpiresInSeconds: 1800,
        sessionIdleTimeoutSeconds: 1800,
      }),
      getGoogleConfig: async () => ({ configured: false }),
      getVenueTheme: async () => ({ hash: "waitron", css: "", logo: null }),
      getLegalAbout: async () => ({ release: null, build: "test" }),
      getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
      listAlerts: async () => ({ visible: false, alerts: [] }),
      getDiskStop: async () => ({ stopped: false, deleted: null }),
      getSalesOverview: () => new Promise(() => {}),
      listHandoverIntervals: list,
      listReturnedInvoices: async () => ({
        records: [],
        nextOffset: null,
        timeZone: "Europe/Madrid",
      }),
    } as unknown as DashboardApi;
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await vi.waitFor(() => expect(el.shadowRoot?.querySelector(".shell")).not.toBeNull());
    if (allowed) {
      await vi.waitFor(() =>
        expect(el.shadowRoot?.querySelector("dashboard-handover-intervals-screen")).not.toBeNull(),
      );
      expect(el.shadowRoot!.querySelector('[data-test="nav-handover-intervals"]')).not.toBeNull();
      expect(location.pathname).toBe("/manage/handover-intervals");
      await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
    } else {
      await vi.waitFor(() => expect(location.pathname).toBe("/manage/overview"));
      expect(el.shadowRoot!.querySelector('[data-test="nav-handover-intervals"]')).toBeNull();
      expect(el.shadowRoot!.querySelector("dashboard-handover-intervals-screen")).toBeNull();
      expect(list).not.toHaveBeenCalled();
    }
  },
);
