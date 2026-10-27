import { WAITRON_CHOICES, themeSheet } from "@waitron/ui-core/theme";
import { WAITRON_DEFAULTS, deriveTheme } from "@waitron/ui-core/theme/waitron";

const BG = "--wt-color-bg";

export const FIXTURE_THEME = deriveTheme({
  ...WAITRON_CHOICES,
  brandColor: "#1e5b3a",
  background: "tinted",
});
export const FIXTURE_LIGHT_BG = FIXTURE_THEME.light[BG]!;
export const FIXTURE_DARK_BG = FIXTURE_THEME.dark[BG]!;
export const WAITRON_LIGHT_BG = WAITRON_DEFAULTS.light[BG]!;
export const WAITRON_DARK_BG = WAITRON_DEFAULTS.dark[BG]!;

export const FIXTURE_ANSWER: { hash: string; css: string; logo: null } = {
  hash: "startup-fixture-hash",
  css: themeSheet(FIXTURE_THEME),
  logo: null,
};

export const bg = (): string =>
  getComputedStyle(document.documentElement).getPropertyValue(BG).trim();

/** Waitron's look at 130% text; a test that adopts it on `document` removes it afterwards. */
export const TEXT_130_SHEET: CSSStyleSheet = new CSSStyleSheet();
TEXT_130_SHEET.replaceSync(themeSheet(deriveTheme({ ...WAITRON_CHOICES, textScale: 130 })));

/** Waitron's look in Serif with Medium and Bold at 800; a test that adopts it removes it afterwards. */
export const SERIF_BOLD_SHEET: CSSStyleSheet = new CSSStyleSheet();
SERIF_BOLD_SHEET.replaceSync(
  themeSheet(
    deriveTheme({
      ...WAITRON_CHOICES,
      text: { family: "serif", weight: { medium: 800, bold: 800 } },
    }),
  ),
);
