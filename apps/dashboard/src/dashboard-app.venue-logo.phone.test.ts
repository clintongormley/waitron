import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import {
  applyTokens,
  startVenueTheme,
  VENUE_THEME_STORAGE_KEY,
  type WtVenueLogo,
} from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import { FIXTURE_ANSWER } from "@waitron/ui/test/venue-theme-fixture.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import type { DashboardApp } from "./dashboard-app.js";
import "./dashboard-app.js";
import type { DashboardApi } from "./api/client.js";
import { setLocale } from "./i18n/t.js";

function png(width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#1e5b3a";
  context.fillRect(0, 0, width, height);
  return canvas.toDataURL("image/png");
}

const LOGOS = [
  ["3:1", png(150, 50), 3],
  ["6:1", png(300, 50), 6],
  ["1:4", png(20, 80), 0.25],
] as const;

type Locale = "en-GB" | "es-ES";

const never = () => new Promise<Response>(() => {});

function stubApi(signedIn: boolean, locale: Locale): DashboardApi {
  return {
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
    getVenueTheme: vi.fn().mockReturnValue(new Promise(() => {})),
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
  } as unknown as DashboardApi;
}

async function flush(el: DashboardApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function mountShell(
  logo: string | null,
  signedIn: boolean,
  locale: Locale,
): Promise<{ el: DashboardApp; banner: HTMLElement }> {
  localStorage.setItem(
    VENUE_THEME_STORAGE_KEY,
    JSON.stringify({ ...FIXTURE_ANSWER, logo: logo === null ? null : { light: logo, dark: null } }),
  );
  startVenueTheme(document.documentElement, { fetchImpl: never });
  const { el } = await mountWidget<DashboardApp>("dashboard-app", {
    api: stubApi(signedIn, locale),
  });
  await flush(el);
  const ready = signedIn ? "[data-test=account-menu]" : "dashboard-login-screen";
  await expect.poll(() => el.shadowRoot!.querySelector(ready)).not.toBeNull();
  await flush(el);
  await document.fonts.ready;
  return { el, banner: el.shadowRoot!.querySelector<HTMLElement>("[data-test=brand-banner]")! };
}

async function controlHeight(signedIn: boolean, locale: Locale): Promise<number> {
  const { banner } = await mountShell(null, signedIn, locale);
  expect(banner.querySelector(".brand-logo")).not.toBeNull();
  const height = banner.getBoundingClientRect().height;
  cleanupWidgets();
  return height;
}

async function loadedImage(logo: WtVenueLogo): Promise<HTMLImageElement> {
  await vi.waitFor(() => {
    const img = logo.shadowRoot!.querySelector<HTMLImageElement>("img[part=image]");
    expect(img?.complete && img.naturalWidth > 0).toBe(true);
  });
  await logo.updateComplete;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  return logo.shadowRoot!.querySelector<HTMLImageElement>("img[part=image]")!;
}

/** True when the two boxes overlap vertically, so they sit on one row. */
function sameRow(a: Element, b: Element): boolean {
  const first = a.getBoundingClientRect();
  const second = b.getBoundingClientRect();
  return first.top < second.bottom && second.top < first.bottom;
}

let width = 0;
let height = 0;

beforeEach(() => {
  width = window.innerWidth;
  height = window.innerHeight;
  applyTokens(document.documentElement);
});

afterEach(async () => {
  cleanupWidgets();
  await page.viewport(width, height);
  localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
  startVenueTheme(document.documentElement, {
    fetchImpl: () => Promise.reject(new TypeError("Failed to fetch")),
  });
  sessionStorage.clear();
  setLocale("es-ES");
});

async function check(
  signedIn: boolean,
  locale: Locale,
  address: string,
  ratio: number,
): Promise<void> {
  const expectedHeight = await controlHeight(signedIn, locale);
  const { el, banner } = await mountShell(address, signedIn, locale);
  const logo = banner.querySelector<WtVenueLogo>("wt-venue-logo")!;
  const img = await loadedImage(logo);
  const drawn = img.getBoundingClientRect();
  expect(drawn.height).toBeGreaterThan(0);
  expect(drawn.height).toBeLessThanOrEqual(40);
  expect(Math.abs(drawn.width / drawn.height - ratio)).toBeLessThanOrEqual(0.05);
  if (signedIn) {
    const toggle = banner.querySelector("[data-test=nav-toggle]")!;
    expect(drawn.height).toBeLessThanOrEqual(toggle.getBoundingClientRect().height);
    expect(sameRow(logo, banner.querySelector("[data-test=account-menu]")!)).toBe(true);
  } else {
    expect(sameRow(logo, banner.querySelector("[data-test=theme-chooser]")!)).toBe(true);
    expect(sameRow(logo, banner.querySelector("[data-test=language-chooser]")!)).toBe(true);
  }
  expect(banner.getBoundingClientRect().height).toBe(expectedHeight);
  expect(el.shadowRoot!.querySelector(".brand-logo")?.checkVisibility() ?? false).toBe(false);
}

describe.each(["en-GB", "es-ES"] as const)("phone width (%s)", (locale) => {
  describe.each([320, 360, 390, 1280])("signed in at %i px", (viewportWidth) => {
    it.each(LOGOS)("a %s logo keeps its shape and the banner's height", async (_, src, ratio) => {
      await page.viewport(viewportWidth, 800);
      await check(true, locale, src, ratio);
    });
  });

  it.each(LOGOS)(
    "signed out at 390 px, a %s logo keeps its shape and the banner's height",
    async (_, src, ratio) => {
      await page.viewport(390, 800);
      await check(false, locale, src, ratio);
    },
  );
});
