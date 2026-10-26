import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import {
  applyTokens,
  currentVenueLogo,
  startVenueTheme,
  VENUE_LOGO_RETRY_MS,
  VENUE_THEME_STORAGE_KEY,
  type WtPoweredBy,
} from "@waitron/ui";
import { WAITRON_CHOICES, themeSheet, type TextScale } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { WAITRON_LOCKUP_DARK_URL, WAITRON_LOCKUP_URL } from "@waitron/ui/src/waitron-lockup.js";
import { FIXTURE_ANSWER } from "@waitron/ui/test/venue-theme-fixture.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import type { DashboardApp } from "./dashboard-app.js";
import "./dashboard-app.js";
import { setLocale, t } from "./i18n/t.js";
import { en, es } from "./i18n/strings.js";
import { nextLogoLoad, png, stubShellApi, type ShellLocale } from "./testing/venue-logo-fixture.js";

const LIGHT = png(120, 40);
const LONG_NAME = "Restaurantes y Hostelería del Mediterráneo Occidental Sociedad Limitada";
const never = () => new Promise<Response>(() => {});

function store(answer: unknown): void {
  localStorage.setItem(VENUE_THEME_STORAGE_KEY, JSON.stringify(answer));
}
const withLogo = { ...FIXTURE_ANSWER, hash: "logo-hash", logo: { light: LIGHT, dark: null } };
const withLogoAt = (textScale: TextScale) => ({
  ...withLogo,
  hash: `logo-hash-${textScale}`,
  css: themeSheet(deriveTheme({ ...WAITRON_CHOICES, textScale })),
});

interface Options {
  readonly locale?: ShellLocale;
  readonly bell?: boolean;
  readonly theme?: "light" | "dark";
  readonly venueName?: string;
  readonly live?: boolean;
}

async function signedIn(options: Options = {}): Promise<DashboardApp> {
  const api = stubShellApi(true, options.locale ?? "es-ES");
  const extra: Record<string, unknown> = {};
  if (options.bell) extra.listAlerts = async () => ({ visible: true, alerts: [] });
  if (options.venueName !== undefined || options.live) {
    const venue = {
      ...(options.venueName === undefined ? {} : { venueName: options.venueName }),
      ...(options.live ? { onboardingIntent: "live" } : {}),
    };
    const me = (await api.getMe()) as Record<string, unknown>;
    extra.getMe = vi.fn().mockResolvedValue({ ...me, ...venue });
    const locales = await api.getLocales();
    extra.getLocales = async () => ({ ...locales, ...venue });
  }
  Object.assign(api, extra);
  const { el } = await mountWidget<DashboardApp>("dashboard-app", { api }, options.theme);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=account-menu]")).not.toBeNull();
  if (options.bell) {
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=alerts-bell]")).not.toBeNull();
  }
  await el.updateComplete;
  await document.fonts.ready;
  return el;
}

const banner = (el: DashboardApp) => el.shadowRoot!.querySelector("[data-test=brand-banner]")!;
const lines = (el: DashboardApp) => el.shadowRoot!.querySelectorAll<WtPoweredBy>("wt-powered-by");
const inBanner = (el: DashboardApp) => banner(el).querySelectorAll<WtPoweredBy>("wt-powered-by");
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function loadedLockup(line: WtPoweredBy): Promise<HTMLImageElement> {
  await line.updateComplete;
  const img = line.shadowRoot!.querySelector<HTMLImageElement>("[part=lockup]")!;
  if (!(img.complete && img.naturalWidth > 0)) {
    await new Promise((resolve) => img.addEventListener("load", resolve, { once: true }));
  }
  expect(img.naturalWidth).toBeGreaterThan(0);
  return img;
}

/** The single banner line, with its lockup loaded and the frame laid out. */
async function theLine(el: DashboardApp): Promise<WtPoweredBy> {
  await vi.waitFor(() => expect(inBanner(el)).toHaveLength(1));
  expect(lines(el)).toHaveLength(1);
  const line = inBanner(el)[0]!;
  await loadedLockup(line);
  await frame();
  return line;
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function sameRow(a: DOMRect, b: DOMRect): boolean {
  return a.top < b.bottom && b.top < a.bottom;
}

let width = 0;
let height = 0;

beforeEach(() => {
  width = window.innerWidth;
  height = window.innerHeight;
  applyTokens(document.documentElement);
  localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
});

afterEach(async () => {
  vi.useRealTimers();
  cleanupWidgets();
  vi.restoreAllMocks();
  await page.viewport(width, height);
  localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
  startVenueTheme(document.documentElement, {
    fetchImpl: () => Promise.reject(new TypeError("Failed to fetch")),
  });
  sessionStorage.clear();
  setLocale("es-ES");
});

describe("Powered by in the signed-in banner", () => {
  it("shows once in the banner while a venue logo is in use, with the sign-in line's words", async () => {
    store(withLogo);
    startVenueTheme(document.documentElement, { fetchImpl: never });
    const loads = nextLogoLoad();
    const el = await signedIn();
    await loads;
    const line = await theLine(el);
    expect(line.getAttribute("label")).toBe(t("login.powered_by"));
  });

  it("is not shown with no venue logo", async () => {
    store(FIXTURE_ANSWER);
    startVenueTheme(document.documentElement, { fetchImpl: never });
    const el = await signedIn();
    expect(currentVenueLogo().kind).toBe("none");
    expect(lines(el)).toHaveLength(0);
  });

  it("is not shown while waiting for the answer", async () => {
    startVenueTheme(document.documentElement, { fetchImpl: never });
    const el = await signedIn();
    expect(currentVenueLogo().kind).toBe("waiting");
    expect(lines(el)).toHaveLength(0);
  });

  it("is not shown for a logo that fails to load", async () => {
    store({ ...withLogo, logo: { light: "/no-such.png", dark: null } });
    startVenueTheme(document.documentElement, { fetchImpl: never });
    const el = await signedIn();
    const logo = banner(el).querySelector("wt-venue-logo")!;
    await vi.waitFor(() => expect(logo.hasAttribute("failed")).toBe(true));
    await el.updateComplete;
    expect(lines(el)).toHaveLength(0);
  });

  it("goes when the logo fails and comes back when its retry loads", async () => {
    store(withLogo);
    startVenueTheme(document.documentElement, { fetchImpl: never });
    const loads = nextLogoLoad();
    const el = await signedIn();
    const { logo, img } = await loads;
    await theLine(el);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    img.dispatchEvent(new Event("error"));
    await logo.updateComplete;
    await el.updateComplete;
    expect(logo.failed).toBe(true);
    expect(lines(el)).toHaveLength(0);

    vi.advanceTimersByTime(VENUE_LOGO_RETRY_MS);
    vi.useRealTimers();
    await vi.waitFor(() => expect(logo.failed).toBe(false));
    await theLine(el);
  });

  it.each([
    ["English", "en-GB", "Powered by"],
    ["Spanish", "es-ES", null],
  ] as const)("reads in %s", async (_name, locale, english) => {
    store(withLogo);
    startVenueTheme(document.documentElement, { fetchImpl: never });
    const el = await signedIn({ locale });
    const label = (await theLine(el)).getAttribute("label");
    expect(label).toBe((locale === "en-GB" ? en : es)["login.powered_by"]);
    if (english !== null) expect(label).toBe(english);
    else expect(label).not.toBe("Powered by");
  });

  it("draws Waitron's dark lockup in the dark theme", async () => {
    store(withLogo);
    startVenueTheme(document.documentElement, { fetchImpl: never });
    const el = await signedIn({ theme: "dark" });
    const line = await theLine(el);
    const img = line.shadowRoot!.querySelector<HTMLImageElement>("[part=lockup]")!;
    expect(img.getAttribute("src")).toBe(WAITRON_LOCKUP_DARK_URL);
    expect(img.getAttribute("src")).not.toBe(WAITRON_LOCKUP_URL);
  });

  describe.each(["en-GB", "es-ES"] as const)("at desktop width (%s)", (locale) => {
    it.each([
      ["the alerts bell", true],
      ["the help switch", false],
    ] as const)(
      "sits on the first row before %s, after the legal name, with a divider",
      async (_first, bell) => {
        await page.viewport(1280, 800);
        store(withLogo);
        startVenueTheme(document.documentElement, { fetchImpl: never });
        const el = await signedIn({ locale, bell });
        const line = await theLine(el);
        const at = line.getBoundingClientRect();
        const name = banner(el).querySelector("[data-test=venue-name]")!.getBoundingClientRect();
        const control = banner(el)
          .querySelector(bell ? "[data-test=alerts-bell]" : "[data-test=help-switch]")!
          .getBoundingClientRect();
        const menu = banner(el).querySelector("[data-test=account-menu]")!.getBoundingClientRect();
        expect(sameRow(at, control)).toBe(true);
        expect(sameRow(at, name)).toBe(true);
        expect(sameRow(at, menu)).toBe(true);
        expect(at.left).toBeGreaterThanOrEqual(name.right);
        expect(at.right).toBeLessThanOrEqual(control.left);
        // Pushed to the trailing side: only the banner's own gap separates it from the control.
        expect(control.left - at.right).toBeLessThanOrEqual(16);
        for (const other of [name, control, menu]) expect(overlaps(at, other)).toBe(false);
        // The divider is a 1 px border line on the line's trailing edge, between it and the control.
        const style = getComputedStyle(line);
        expect(style.borderInlineEndWidth).toBe("1px");
        expect(style.borderInlineEndStyle).toBe("solid");
        const probe = document.createElement("span");
        probe.style.color = "var(--wt-color-border)";
        line.after(probe);
        const border = getComputedStyle(probe).color;
        probe.remove();
        expect(style.borderInlineEndColor).toBe(border);
        expect(at.right).toBeLessThanOrEqual(1280);
      },
    );

    it("keeps a long legal name clear of it", async () => {
      await page.viewport(1280, 800);
      store(withLogo);
      startVenueTheme(document.documentElement, { fetchImpl: never });
      const el = await signedIn({ locale, bell: true, venueName: LONG_NAME });
      const line = await theLine(el);
      const at = line.getBoundingClientRect();
      const name = banner(el).querySelector("[data-test=venue-name]")!.getBoundingClientRect();
      const bellBox = banner(el).querySelector("[data-test=alerts-bell]")!.getBoundingClientRect();
      expect(overlaps(at, name)).toBe(false);
      expect(at.left).toBeGreaterThanOrEqual(name.right);
      expect(at.right).toBeLessThanOrEqual(bellBox.left);
      const words = line.shadowRoot!.querySelector("[part=label]")!;
      expect(words.getBoundingClientRect().height).toBeLessThan(at.height + 1);
    });
  });

  describe.each(["en-GB", "es-ES"] as const)("at phone width (%s)", (locale) => {
    it.each([
      ["a short", undefined],
      ["a long", LONG_NAME],
    ] as const)(
      "with %s legal name, takes the second row's trailing end and leaves the first row alone",
      async (_kind, venueName) => {
        await page.viewport(390, 844);
        store(withLogo);
        startVenueTheme(document.documentElement, { fetchImpl: never });
        const el = await signedIn({ locale, bell: true, venueName });
        const line = await theLine(el);
        const at = line.getBoundingClientRect();
        const logo = banner(el).querySelector("wt-venue-logo")!.getBoundingClientRect();
        const name = banner(el).querySelector("[data-test=venue-name]")!.getBoundingClientRect();
        const menu = banner(el).querySelector("[data-test=account-menu]")!.getBoundingClientRect();
        const bellBox = banner(el)
          .querySelector("[data-test=alerts-bell]")!
          .getBoundingClientRect();
        const box = banner(el).getBoundingClientRect();
        expect(at.top).toBeGreaterThanOrEqual(logo.bottom);
        expect(at.top).toBeGreaterThanOrEqual(menu.bottom);
        expect(sameRow(at, name)).toBe(true);
        expect(at.left).toBeGreaterThanOrEqual(name.right);
        expect(overlaps(at, name)).toBe(false);
        expect(at.left).toBeGreaterThanOrEqual(0);
        expect(at.right).toBeLessThanOrEqual(390);
        // The second row's trailing end lines up with the account menu's above it.
        expect(Math.abs(at.right - menu.right)).toBeLessThanOrEqual(1);
        expect(at.bottom).toBeLessThanOrEqual(box.bottom);
        expect(sameRow(logo, menu)).toBe(true);
        expect(sameRow(logo, bellBox)).toBe(true);
        expect(menu.right).toBeLessThanOrEqual(390);
        expect(getComputedStyle(line).borderInlineEndWidth).toBe("0px");
        const words = line.shadowRoot!.querySelector("[part=label]")!.getBoundingClientRect();
        expect(words.width).toBeGreaterThan(0);
      },
    );
  });

  it.each([100, 130] as const)(
    "at 320 px in Spanish at %i% text, with a long legal name and the Live pill, keeps the whole line and its lockup on screen",
    async (scale) => {
      await page.viewport(320, 700);
      store(withLogoAt(scale));
      startVenueTheme(document.documentElement, { fetchImpl: never });
      const el = await signedIn({ locale: "es-ES", bell: true, venueName: LONG_NAME, live: true });
      const line = await theLine(el);
      const at = line.getBoundingClientRect();
      const lockup = line.shadowRoot!.querySelector("[part=lockup]")!.getBoundingClientRect();
      const words = line.shadowRoot!.querySelector("[part=label]")!.getBoundingClientRect();
      const name = banner(el).querySelector("[data-test=venue-name]")!.getBoundingClientRect();
      const pill = banner(el).querySelector("[data-test=mode-indicator]")!.getBoundingClientRect();
      const menu = banner(el).querySelector("[data-test=account-menu]")!.getBoundingClientRect();
      expect(
        getComputedStyle(banner(el).querySelector("[data-test=venue-name]")!).fontSize,
        `the legal name at ${scale}%`,
      ).toBe(scale === 100 ? "14px" : "18px");
      const probe = document.createElement("span");
      probe.style.display = "block";
      probe.style.width = "calc(var(--wt-space-6) * 2)";
      document.body.append(probe);
      const lockupWidth = probe.getBoundingClientRect().width;
      probe.remove();
      for (const [part, box] of [
        ["the line", at],
        ["its lockup", lockup],
        ["its words", words],
      ] as const) {
        expect(box.left, `${part}'s left edge`).toBeGreaterThanOrEqual(0);
        expect(box.right, `${part}'s right edge`).toBeLessThanOrEqual(320);
        expect(overlaps(box, name), `${part} against the legal name`).toBe(false);
        expect(overlaps(box, pill), `${part} against the Live pill`).toBe(false);
      }
      expect(lockup.width, "the lockup's drawn width").toBeCloseTo(lockupWidth, 0);
      expect(Math.abs(at.right - menu.right), "trailing end under the menu's").toBeLessThanOrEqual(
        1,
      );
      expect(words.left, "the words start inside the line").toBeGreaterThanOrEqual(at.left);
      expect(words.right, "the words end inside the line").toBeLessThanOrEqual(at.right);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    },
  );

  it("the sign-in page keeps a single line, under its card, with none in its banner", async () => {
    store(withLogo);
    startVenueTheme(document.documentElement, { fetchImpl: never });
    const loads = nextLogoLoad();
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubShellApi(false),
    });
    await expect.poll(() => el.shadowRoot!.querySelector("dashboard-login-screen")).not.toBeNull();
    await loads;
    await vi.waitFor(() => expect(lines(el)).toHaveLength(1));
    expect(inBanner(el)).toHaveLength(0);
  });
});
