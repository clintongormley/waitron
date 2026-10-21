import { createHash } from "node:crypto";
import type { ThemeInUse } from "@waitron/layouts";
import {
  deriveThemeFrom,
  themeSheet,
  type ThemeChoices,
  type VenueThemeAnswer,
} from "@waitron/ui-core/theme";
import { SERVER_THEME_DEFAULTS } from "./theme-defaults.js";

export function themeHashOf(css: string, logo: null): string {
  return createHash("sha256").update(JSON.stringify({ css, logo })).digest("hex");
}

export const WAITRON_THEME_ANSWER: VenueThemeAnswer = {
  hash: themeHashOf("", null),
  css: "",
  logo: null,
};

function themeCacheKey(row: { id: string; choices: ThemeChoices }): string {
  return JSON.stringify([row.id, row.choices]);
}

let cached: { key: string; answer: VenueThemeAnswer } | null = null;

/** Takes no transaction: colours are worked out after the read's transaction, which holds the write lock. */
export function venueThemeAnswer(inUse: ThemeInUse | null): VenueThemeAnswer {
  if (inUse === null || inUse.choices === null) return WAITRON_THEME_ANSWER;
  const key = themeCacheKey({ id: inUse.id, choices: inUse.choices });
  if (cached?.key === key) return cached.answer;
  const css = themeSheet(deriveThemeFrom(SERVER_THEME_DEFAULTS, inUse.choices));
  const answer: VenueThemeAnswer = { hash: themeHashOf(css, null), css, logo: null };
  cached = { key, answer };
  return answer;
}

export function forgetVenueTheme(): void {
  cached = null;
}
