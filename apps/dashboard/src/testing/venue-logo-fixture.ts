import { vi, type Mock } from "vitest";
import type { WtVenueLogo } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import { FIXTURE_ANSWER } from "@waitron/ui/test/venue-theme-fixture.js";
import type { DashboardApi } from "../api/client.js";

export type ShellLocale = "en-GB" | "es-ES";

export type ShellApi = DashboardApi & {
  readonly liveData: LiveData;
  readonly getMe: Mock;
  readonly getVenueTheme: Mock;
};

/** A filled PNG of the given size, as a data URL. */
export function png(width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#1e5b3a";
  context.fillRect(0, 0, width, height);
  return canvas.toDataURL("image/png");
}

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

/**
 * Resolves with the next logo box to send `wt-logo-load`, once it has drawn the image at its own
 * shape. Call it before whatever makes the image load: the event is heard on `document`.
 */
export function nextLogoLoad(): Promise<{ logo: WtVenueLogo; img: HTMLImageElement }> {
  return new Promise((resolve) => {
    document.addEventListener(
      "wt-logo-load",
      (event) => {
        const logo = event.composedPath()[0] as WtVenueLogo;
        void logo.updateComplete
          .then(() => new Promise((frame) => requestAnimationFrame(frame)))
          .then(() =>
            resolve({ logo, img: logo.shadowRoot!.querySelector<HTMLImageElement>("img")! }),
          );
      },
      { once: true },
    );
  });
}
