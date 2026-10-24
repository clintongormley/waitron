import { vi, type Mock } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import { FIXTURE_ANSWER } from "@waitron/ui/test/venue-theme-fixture.js";
import type { DashboardApi } from "../api/client.js";

export { nextLogoLoad, png } from "@waitron/ui/test/venue-logo-fixture.js";

export type ShellLocale = "en-GB" | "es-ES";

export type ShellApi = DashboardApi & {
  readonly liveData: LiveData;
  readonly getMe: Mock;
  readonly getVenueTheme: Mock;
};

/** The shell's reads, each resolving; signed out, the session read is refused. */
export function stubShellApi(signedIn: boolean, locale: ShellLocale = "es-ES"): ShellApi {
  const api = {
    liveData: new LiveData(),
    getGoogleConfig: async () => ({ configured: false }),
    getLocales: async () => ({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: locale,
      loginDefault: locale,
      venueName: "Deli Test SL",
      onboardingIntent: "prepare",
    }),
    getMe: signedIn
      ? vi.fn().mockResolvedValue({
          personId: "p1",
          role: "manager",
          email: "manager@example.com",
          locale,
          venueLocale: locale,
          sessionDefault: locale,
          venueName: "Deli Test SL",
          onboardingIntent: "prepare",
          permissions: [],
          modules: [],
        })
      : vi.fn().mockRejectedValue({ code: "management_session.required" }),
    getVenueTheme: vi.fn().mockResolvedValue(FIXTURE_ANSWER),
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
    listMyShifts: async () => [],
    listMySwaps: async () => [],
    listMyAbsences: async () => [],
    getStaffRoster: async () => [],
  };
  return api as unknown as ShellApi;
}
