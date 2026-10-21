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
