import { afterEach, expect, it } from "vitest";
import { mediaTestReference } from "@waitron/ui/src/test-helpers.js";
import { WAITRON_CHOICES, type ThemeChoices, type ThemeLogo } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { en, es } from "../i18n/strings.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget, serveLogos } from "./test-helpers.js";
import "./theme-preview.js";

type Preview = HTMLElementTagNameMap["dashboard-theme-preview"];

const drafts: Record<string, ThemeChoices> = {
  waitron: WAITRON_CHOICES,
  lucia: {
    brandColor: "#1e5b3a",
    brandFix: { dark: true },
    background: "tinted",
    corners: "round",
    logo: null,
    handSet: { light: {}, dark: {} },
    textScale: 100,
  },
  lemon: { ...WAITRON_CHOICES, brandColor: "#f2d300" },
  "two fixes": {
    ...WAITRON_CHOICES,
    handSet: { light: { text: "#6a6a6a", "surface-sunken": "#bbbbbb" }, dark: {} },
  },
};

const L = mediaTestReference("lucia.png");
const D = mediaTestReference("lucia-dark.png");
const logos: Record<string, ThemeLogo | null> = {
  "no logo": null,
  "a logo": { light: L },
  "a logo and a dark one": { light: L, dark: D },
};

const cases = (["light", "dark"] as const).flatMap((mode) =>
  Object.keys(drafts).flatMap((draft) =>
    (["en-GB", "es-ES"] as const).map((locale) => ({ mode, draft, locale })),
  ),
);
const logoCases = (["light", "dark"] as const).flatMap((mode) =>
  Object.keys(logos).flatMap((logo) =>
    (["en-GB", "es-ES"] as const).map((locale) => ({ mode, logo, locale })),
  ),
);

serveLogos([L, D]);

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

it.each(cases)("theme preview: $draft, $locale / $mode", async ({ mode, draft, locale }) => {
  setLocale(locale);
  const { el, host } = await mountWidget<Preview>(
    "dashboard-theme-preview",
    { theme: deriveTheme(drafts[draft]!), name: "Bar Lucía" },
    mode,
  );
  const strings = locale === "es-ES" ? es : en;
  expect(el.shadowRoot!.querySelector("h3")?.textContent?.trim()).toBe(
    strings["appearance.preview"],
  );
  await expectNoA11yViolations(host);
});

it.each(logoCases)(
  "theme preview's banner strip: $logo, $locale / $mode",
  async ({ mode, logo, locale }) => {
    setLocale(locale);
    const { el, host } = await mountWidget<Preview>(
      "dashboard-theme-preview",
      {
        theme: deriveTheme(drafts.lucia!),
        name: "Bar Lucía",
        logo: logos[logo]!,
        legalName: "BAR LUCÍA S.L.",
      },
      mode,
    );
    const images = () =>
      [...el.shadowRoot!.querySelectorAll("wt-venue-logo")].map(
        (venue) => venue.shadowRoot?.querySelector("img")?.naturalWidth,
      );
    if (logos[logo] !== null) await expect.poll(images).toEqual([400, 400]);
    await expectNoA11yViolations(host);
  },
);
