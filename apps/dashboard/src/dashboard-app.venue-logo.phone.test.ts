import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import {
  applyTokens,
  startVenueTheme,
  VENUE_THEME_STORAGE_KEY,
  type WtVenueLogo,
} from "@waitron/ui";
import { FIXTURE_ANSWER } from "@waitron/ui/test/venue-theme-fixture.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import type { DashboardApp } from "./dashboard-app.js";
import "./dashboard-app.js";
import { setLocale } from "./i18n/t.js";
import {
  nextLogoLoad,
  png,
  stubShellApi,
  type ShellLocale as Locale,
} from "./testing/venue-logo-fixture.js";

const LOGOS = [
  ["3:1", png(150, 50), 3],
  ["6:1", png(300, 50), 6],
  ["1:4", png(20, 80), 0.25],
] as const;

const never = () => new Promise<Response>(() => {});

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
    api: stubShellApi(signedIn, locale),
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
  const loads = nextLogoLoad();
  const { el, banner } = await mountShell(address, signedIn, locale);
  const { logo, img } = await loads;
  expect(logo).toBe(banner.querySelector<WtVenueLogo>("wt-venue-logo"));
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
