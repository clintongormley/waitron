import { commands, page } from "vitest/browser";
import {
  chooseTheme,
  startThemeChoice,
  THEME_STORAGE_KEY,
  type WtRowActions,
  type WtThemeChooser,
} from "@waitron/ui";
import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";
import { DashboardApp } from "./dashboard-app.js";
import type { DashboardApi } from "./api/client.js";
import darkLockup from "../../../packages/ui/brand/waitron-lockup-dark.svg?raw";
import lightLockup from "../../../packages/ui/brand/waitron-lockup.svg?raw";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateColorScheme: (colorScheme: "light" | "dark" | null) => Promise<void>;
  }
}

afterEach(async () => {
  setLocale("es-ES");
  chooseTheme("device");
  localStorage.removeItem(THEME_STORAGE_KEY);
  await commands.emulateColorScheme(null);
  cleanupWidgets();
});

type Locale = "en-GB" | "es-ES";

/** The signed-out shell's reads, each resolving, so a stray rejection is a finding. */
function stubApi(locale: Locale = "es-ES", onboardingIntent = "prepare"): DashboardApi {
  return {
    getMe: vi.fn().mockRejectedValue({ code: "management_session.required" }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: locale,
      loginDefault: locale,
      venueName: "Deli Test SL",
      onboardingIntent,
    }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }),
    putLocale: vi.fn().mockResolvedValue(undefined),
    passkeySignals: vi.fn().mockResolvedValue({
      rpId: "localhost",
      userId: "cDE",
      credentialIds: [],
      name: "manager@example.com",
      displayName: "Manager",
    }),
  } as unknown as DashboardApi;
}

// Vite may inline a small SVG as a data URL, rewriting its quotes and spacing on the way, so the
// served drawing is compared with the file's once both are parsed.
const drawing = (svg: string) =>
  new XMLSerializer()
    .serializeToString(new DOMParser().parseFromString(svg, "image/svg+xml").documentElement)
    .replace(/\s+/g, " ");
const served = async (url: string) => drawing(await (await fetch(url)).text());

async function mountShell(): Promise<{ host: HTMLElement; shown: () => Promise<string> }> {
  const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api: stubApi() });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  const img = el.shadowRoot!.querySelector<HTMLImageElement>(
    '[data-test=brand-banner] img[alt="Waitron"]',
  )!;
  return { host, shown: async () => (img.currentSrc ? served(img.currentSrc) : "") };
}

it("tells the two lockups apart", () => {
  expect(drawing(darkLockup)).not.toBe(drawing(lightLockup));
});

it("with Dark chosen the banner shows the dark lockup, whatever the computer is set to", async () => {
  await commands.emulateColorScheme("light");
  const { shown } = await mountShell();
  chooseTheme("dark");
  await expect.poll(shown).toBe(drawing(darkLockup));
  await commands.emulateColorScheme("dark");
  await expect.poll(shown).toBe(drawing(darkLockup));
});

it("with Light chosen it shows the light lockup, whatever the computer is set to", async () => {
  // The computer is dark before the shell draws, so a stale light drawing cannot pass the first poll.
  await commands.emulateColorScheme("dark");
  const { shown } = await mountShell();
  chooseTheme("light");
  await expect.poll(shown).toBe(drawing(lightLockup));
  await commands.emulateColorScheme("light");
  await expect.poll(shown).toBe(drawing(lightLockup));
});

it("on Follow device it follows the computer, and a change of choice applies at once", async () => {
  const { shown } = await mountShell();
  await commands.emulateColorScheme("dark");
  await expect.poll(shown).toBe(drawing(darkLockup));
  chooseTheme("light");
  await expect.poll(shown).toBe(drawing(lightLockup));
  chooseTheme("device");
  await expect.poll(shown).toBe(drawing(darkLockup));
});

it("a choice saved before the page started is what the logo shows", async () => {
  await commands.emulateColorScheme("light");
  const { host, shown } = await mountShell();
  localStorage.setItem(THEME_STORAGE_KEY, "dark");
  startThemeChoice(host);
  await expect.poll(shown).toBe(drawing(darkLockup));
});

/** A signed-in member of staff, whose shell opens on their own schedule. */
function signedInApi(locale: Locale = "en-GB"): DashboardApi {
  return {
    ...stubApi(locale),
    getMe: vi.fn().mockResolvedValue({
      personId: "p2",
      role: "staff",
      locale,
      venueLocale: locale,
      sessionDefault: locale,
      venueName: "Deli Test SL",
      permissions: ["sale.take_payment"],
      modules: [],
    }),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getCatalogueSettings: vi
      .fn()
      .mockResolvedValue({ defaultProductVatClass: "general", defaultColor: null }),
    listMyShifts: vi.fn().mockResolvedValue([]),
    listMySwaps: vi.fn().mockResolvedValue([]),
    listMyAbsences: vi.fn().mockResolvedValue([]),
    listAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
    logout: vi.fn().mockResolvedValue(undefined),
  } as unknown as DashboardApi;
}

async function mountApp(api: DashboardApi, theme?: "light" | "dark") {
  const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  return { el, host };
}

const q = <T extends HTMLElement = HTMLElement>(el: DashboardApp, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const bannerChooser = (el: DashboardApp) => q<WtThemeChooser>(el, "[data-test=theme-chooser]");
const inChooser = (el: DashboardApp, test: string) =>
  bannerChooser(el)!.shadowRoot!.querySelector<HTMLElement>(`[data-test=${test}]`)!;
const accountMenu = (el: DashboardApp) => q<WtRowActions>(el, "[data-test=account-menu]")!;
const menuPopup = (el: DashboardApp) =>
  accountMenu(el).shadowRoot!.querySelector<HTMLElement>("[popover]")!;
const choiceButtons = (el: DashboardApp) => [
  ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>("[data-test=theme-choices] button"),
];
const bg = (host: HTMLElement) => getComputedStyle(host).getPropertyValue("--wt-color-bg").trim();
const DARK_BG = "#101216";

async function openAccountMenu(el: DashboardApp): Promise<void> {
  accountMenu(el).shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  await vi.waitFor(() => expect(menuPopup(el).matches(":popover-open")).toBe(true));
}

it("signed out, puts the theme chooser in the banner just before the language chooser", async () => {
  const { el } = await mountApp(stubApi("en-GB"));
  const actions = q(el, ".banner-actions")!;
  expect([...actions.children].map((child) => child.getAttribute("data-test"))).toEqual([
    "theme-chooser",
    "language-chooser",
  ]);
});

it("signed in, the banner has no theme chooser and the account menu holds the Theme choices between Account settings and the language choices", async () => {
  const { el } = await mountApp(signedInApi("en-GB"));
  expect(q(el, "[data-test=account-menu]")).not.toBeNull();
  expect(bannerChooser(el)).toBeNull();
  expect([...accountMenu(el).children].map((child) => child.getAttribute("data-test"))).toEqual([
    "profile-row",
    "theme-choices",
    "language-chooser",
    "logout",
  ]);
  await openAccountMenu(el);
  const group = q(el, '[data-test=theme-choices][role="group"]')!;
  await expect.element(group).toHaveAccessibleName("Theme");
  const buttons = choiceButtons(el);
  for (const [i, name] of ["Light", "Dark", "Follow device"].entries())
    await expect.element(buttons[i]!).toHaveAccessibleName(name);
  expect(buttons).toHaveLength(3);
  expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
});

it("signed out, a pick in the banner turns the dashboard dark and is kept", async () => {
  await commands.emulateColorScheme("light");
  const { el, host } = await mountApp(stubApi("en-GB"));
  startThemeChoice(host);
  inChooser(el, "theme-trigger").click();
  await bannerChooser(el)!.updateComplete;
  inChooser(el, "theme-dark").click();
  await vi.waitFor(() => expect(bg(host)).toBe(DARK_BG));
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  await el.updateComplete;
  expect(bannerChooser(el)!.active).toBe("dark");
  inChooser(el, "theme-trigger").click();
  await bannerChooser(el)!.updateComplete;
  inChooser(el, "theme-device").click();
  await el.updateComplete;
  expect(host.hasAttribute("data-theme")).toBe(false);
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  expect(bannerChooser(el)!.active).toBe("device");
});

it("signed in, a pick in the account menu turns the dashboard dark, closes the menu, and is marked next time", async () => {
  await commands.emulateColorScheme("light");
  const { el, host } = await mountApp(signedInApi("en-GB"));
  startThemeChoice(host);
  await openAccountMenu(el);
  q(el, "[data-test=theme-choice-dark]")!.click();
  await vi.waitFor(() => expect(bg(host)).toBe(DARK_BG));
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  expect(menuPopup(el).matches(":popover-open")).toBe(false);
  await el.updateComplete;
  await openAccountMenu(el);
  expect(
    ["light", "dark", "device"].map((choice) =>
      q(el, `[data-test=theme-choice-${choice}]`)!.getAttribute("aria-pressed"),
    ),
  ).toEqual(["false", "true", "false"]);
});

it("labels the Theme choices in Spanish", async () => {
  const words = ["Claro", "Oscuro", "Según el dispositivo"];
  const signedOut = await mountApp(stubApi("es-ES"));
  const trigger = inChooser(signedOut.el, "theme-trigger");
  await expect
    .element(trigger.shadowRoot?.querySelector("button") ?? trigger)
    .toHaveAccessibleName("Tema: Según el dispositivo");
  trigger.click();
  await bannerChooser(signedOut.el)!.updateComplete;
  expect(
    ["theme-light", "theme-dark", "theme-device"].map((test) =>
      inChooser(signedOut.el, test).textContent!.trim(),
    ),
  ).toEqual(words);
  cleanupWidgets();
  const signedIn = await mountApp(signedInApi("es-ES"));
  await openAccountMenu(signedIn.el);
  await expect
    .element(q(signedIn.el, '[data-test=theme-choices][role="group"]')!)
    .toHaveAccessibleName("Tema");
  const buttons = choiceButtons(signedIn.el);
  expect(buttons).toHaveLength(3);
  for (const [i, word] of words.entries())
    await expect.element(buttons[i]!).toHaveAccessibleName(word);
});

/** Runs `body` at a real viewport size inside the real page's outer margin (`index.html` pads the
 * body by 24px), then restores the size. */
async function atViewport(host: HTMLElement, width: number, body: () => Promise<void>) {
  const before = { width: window.innerWidth, height: window.innerHeight };
  host.style.padding = "24px";
  try {
    await page.viewport(width, 800);
    await vi.waitFor(() => expect(window.innerWidth).toBe(width));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await body();
  } finally {
    await page.viewport(before.width, before.height);
  }
}

it.each(
  (["prepare", "live"] as const).flatMap((intent) =>
    (["en-GB", "es-ES"] as const).flatMap((locale) =>
      [320, 360, 390].map((width) => [width, intent, locale] as const),
    ),
  ),
)(
  "signed out, fits the banner at %ipx with the theme and language choosers on the lockup's row (%s, %s)",
  async (width, intent, locale) => {
    const { el, host } = await mountApp(stubApi(locale, intent));
    await atViewport(host, width, async () => {
      const banner = q(el, "[data-test=brand-banner]")!;
      const box = (selector: string) => q(el, selector)!.getBoundingClientRect();
      const logo = box(".brand-logo");
      const theme = box("[data-test=theme-chooser]");
      const language = box("[data-test=language-chooser]");
      expect(logo.width, "the lockup keeps a readable width").toBeGreaterThanOrEqual(60);
      expect(banner.scrollWidth).toBeLessThanOrEqual(banner.clientWidth);
      const overlaps = (a: DOMRect, b: DOMRect) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
      expect(overlaps(theme, logo), "the theme chooser overlaps the lockup").toBe(false);
      expect(overlaps(language, logo), "the language chooser overlaps the lockup").toBe(false);
      expect(overlaps(theme, language), "the two choosers overlap").toBe(false);
      expect(theme.width).toBeGreaterThan(0);
      expect(language.width).toBeGreaterThan(0);
      expect(theme.top, "the theme chooser shares the lockup's row").toBeLessThan(logo.bottom);
      expect(language.top, "the language chooser shares the lockup's row").toBeLessThan(
        logo.bottom,
      );
    });
  },
);

it("has no accessibility violations with the account menu open, in both themes", async () => {
  for (const theme of ["light", "dark"] as const) {
    const { el, host } = await mountApp(signedInApi("en-GB"), theme);
    await openAccountMenu(el);
    await expectNoA11yViolations(host);
    cleanupWidgets();
  }
});

it("hands the banner chooser the same labels on a redraw, and new ones when the language changes", async () => {
  const { el } = await mountApp(stubApi("en-GB"));
  const english = bannerChooser(el)!.labels;
  el.requestUpdate();
  await el.updateComplete;
  expect(bannerChooser(el)!.labels).toBe(english);
  setLocale("es-ES");
  el.requestUpdate();
  await el.updateComplete;
  expect(bannerChooser(el)!.labels).not.toBe(english);
  expect(bannerChooser(el)!.labels.theme).toBe("Tema");
});
