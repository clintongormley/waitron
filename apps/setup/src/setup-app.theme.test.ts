import { commands, page } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import {
  applyTokens,
  chooseTheme,
  startThemeChoice,
  THEME_STORAGE_KEY,
  type WtThemeChooser,
} from "@waitron/ui";
import type { SetupApp } from "./setup-app.js";
import type { SetupApi, SetupStatus } from "./api/client.js";
import { setLocale } from "./i18n/t.js";
import "./setup-app.js";
import { expectNoA11yViolations } from "./widgets/test-helpers.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateColorScheme: (colorScheme: "light" | "dark" | null) => Promise<void>;
  }
}

const mounted: HTMLElement[] = [];

afterEach(async () => {
  for (const host of mounted.splice(0)) host.remove();
  setLocale("en-GB");
  chooseTheme("device");
  localStorage.removeItem(THEME_STORAGE_KEY);
  await commands.emulateColorScheme(null);
});

function stubApi(): SetupApi {
  return {
    getDiscovery: vi.fn().mockResolvedValue({ caDownloadAvailable: false }),
    getStatus: vi.fn().mockResolvedValue({
      provisioned: false,
      environment: "preproduction",
      needs: ["venue"],
    } satisfies SetupStatus),
  } as unknown as SetupApi;
}

async function mountSetupApp(
  languages: readonly string[] = ["en-GB"],
): Promise<{ el: SetupApp; host: HTMLElement }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  mounted.push(host);
  const el = document.createElement("setup-app") as SetupApp;
  el.api = stubApi();
  el.browserLanguages = languages;
  host.appendChild(el);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  return { el, host };
}

const chooserOf = (el: SetupApp) =>
  el.shadowRoot!.querySelector<WtThemeChooser>("[data-test=theme-chooser]")!;
const inChooser = (el: SetupApp, test: string) =>
  chooserOf(el).shadowRoot!.querySelector<HTMLElement>(`[data-test=${test}]`)!;
const bg = (host: HTMLElement) => getComputedStyle(host).getPropertyValue("--wt-color-bg").trim();
const DARK_BG = "#101216";

it.each([1280, 390])(
  "puts the theme chooser just before the language chooser at the trailing end of the header, %ipx wide",
  async (width) => {
    const before = { width: window.innerWidth, height: window.innerHeight };
    await page.viewport(width, 844);
    try {
      const { el } = await mountSetupApp();
      const header = el.shadowRoot!.querySelector<HTMLElement>("main > header")!;
      const headerBox = header.getBoundingClientRect();
      const logoBox = header.querySelector("[data-test=setup-logo]")!.getBoundingClientRect();
      const theme = inChooser(el, "theme-trigger").getBoundingClientRect();
      const lang = header
        .querySelector("wt-language-chooser")!
        .shadowRoot!.querySelector("[data-test=lang-trigger]")!
        .getBoundingClientRect();
      const space1 = parseFloat(getComputedStyle(header).getPropertyValue("--wt-space-1"));
      expect(space1).toBe(4);
      expect(theme.right).toBeLessThan(lang.left);
      expect(Math.abs(lang.left - theme.right - space1)).toBeLessThanOrEqual(1);
      const middle = (box: DOMRect) => box.top + box.height / 2;
      expect(Math.abs(middle(theme) - middle(logoBox))).toBeLessThanOrEqual(1);
      expect(Math.abs(middle(lang) - middle(logoBox))).toBeLessThanOrEqual(1);
      expect(Math.abs(lang.right - headerBox.right)).toBeLessThanOrEqual(1);
    } finally {
      await page.viewport(before.width, before.height);
    }
  },
);

it("a pick applies and keeps the choice", async () => {
  await commands.emulateColorScheme("light");
  const { el, host } = await mountSetupApp();
  startThemeChoice(host);
  inChooser(el, "theme-trigger").click();
  await chooserOf(el).updateComplete;
  inChooser(el, "theme-dark").click();
  await vi.waitFor(() => expect(bg(host)).toBe(DARK_BG));
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  await el.updateComplete;
  expect(chooserOf(el).active).toBe("dark");
});

it("labels the chooser in Spanish", async () => {
  const { el } = await mountSetupApp(["es-ES"]);
  await chooserOf(el).updateComplete;
  await expect
    .element(
      page.elementLocator(inChooser(el, "theme-trigger").shadowRoot!.querySelector("button")!),
    )
    .toHaveAccessibleName("Tema: Según el dispositivo");
});

it("hands the chooser the same labels on a redraw, and new ones when the language changes", async () => {
  const { el } = await mountSetupApp();
  const english = chooserOf(el).labels;
  el.requestUpdate();
  await el.updateComplete;
  expect(chooserOf(el).labels).toBe(english);
  setLocale("es-ES");
  el.requestUpdate();
  await el.updateComplete;
  expect(chooserOf(el).labels).not.toBe(english);
  expect(chooserOf(el).labels.theme).toBe("Tema");
});

it.each(
  [390, 1280].flatMap((width) =>
    ["en-GB", "es-ES"].flatMap((locale) =>
      ["light", "dark"].map((theme) => ({ width, locale, theme })),
    ),
  ),
)(
  "keeps reporting and the original header controls visible at $width in $locale/$theme",
  async ({ width, locale, theme }) => {
    const before = { width: innerWidth, height: innerHeight };
    await page.viewport(width, 844);
    try {
      const { el, host } = await mountSetupApp([locale]);
      host.setAttribute("data-theme", theme);
      const header = el.shadowRoot!.querySelector<HTMLElement>("header")!;
      const report = header.querySelector("setup-problem-report")!;
      await report.updateComplete;
      const button = report.shadowRoot!.querySelector("wt-button")!;
      await button.updateComplete;
      await expect
        .element(button.shadowRoot!.querySelector("button")!)
        .toHaveAccessibleName(locale === "es-ES" ? "Informar de un problema" : "Report a problem");
      const bounds = header.getBoundingClientRect();
      const trigger = button.getBoundingClientRect();
      const controls = header.querySelector(".header-controls")!.getBoundingClientRect();
      expect(trigger.width).toBeGreaterThanOrEqual(44);
      expect(trigger.height).toBeGreaterThanOrEqual(44);
      expect(trigger.left).toBeGreaterThanOrEqual(bounds.left - 1);
      expect(trigger.right).toBeLessThanOrEqual(bounds.right + 1);
      expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth);
      if (width === 390) expect(trigger.top).toBeGreaterThanOrEqual(controls.bottom);
      else expect(trigger.right).toBeLessThanOrEqual(controls.left);
      await expectNoA11yViolations(header);
    } finally {
      await page.viewport(before.width, before.height);
    }
  },
);
