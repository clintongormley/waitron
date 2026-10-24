import { createHash } from "node:crypto";
import type { Transaction } from "@waitron/db";
import { readThemeInUse, type ThemeInUse } from "@waitron/layouts";
import { readPresentations } from "@waitron/media";
import {
  deriveThemeFrom,
  themeSheet,
  type ThemeChoices,
  type VenueLogoAddresses,
  type VenueThemeAnswer,
} from "@waitron/ui-core/theme";
import { SERVER_THEME_DEFAULTS } from "./theme-defaults.js";

export type VenueLogo = VenueLogoAddresses;

export interface VenueThemeSource {
  readonly inUse: ThemeInUse | null;
  readonly logo: VenueLogo | null;
}

export function themeHashOf(css: string, logo: VenueLogo | null): string {
  return createHash("sha256").update(JSON.stringify({ css, logo })).digest("hex");
}

export const WAITRON_THEME_ANSWER: VenueThemeAnswer = {
  hash: themeHashOf("", null),
  css: "",
  logo: null,
};

/** The addresses name each image's source file and framing, so a reframe or a replaced source misses the cache. */
function themeCacheKey(id: string, choices: ThemeChoices, logo: VenueLogo | null): string {
  return JSON.stringify([id, choices, logo]);
}

export async function readVenueThemeSource(tx: Transaction): Promise<VenueThemeSource> {
  const inUse = await readThemeInUse(tx);
  const named = inUse?.choices?.logo ?? null;
  if (named === null) return { inUse, logo: null };
  const { light, dark } = named;
  const found = await readPresentations(tx, dark === undefined ? [light] : [light, dark]);
  // A stored name is only known to be a string, so an inherited key such as "constructor" must miss.
  const image = (name: string | undefined) =>
    name !== undefined && Object.hasOwn(found, name) ? found[name] : undefined;
  const lightImage = image(light);
  if (lightImage === undefined) return { inUse, logo: null };
  return { inUse, logo: { light: lightImage.display, dark: image(dark)?.display ?? null } };
}

let cached: { key: string; answer: VenueThemeAnswer } | null = null;

/** Takes no transaction: colours are worked out after the read's transaction, which holds the write lock. */
export function venueThemeAnswer({ inUse, logo }: VenueThemeSource): VenueThemeAnswer {
  if (inUse === null || inUse.choices === null) return WAITRON_THEME_ANSWER;
  const key = themeCacheKey(inUse.id, inUse.choices, logo);
  if (cached?.key === key) return cached.answer;
  const css = themeSheet(deriveThemeFrom(SERVER_THEME_DEFAULTS, inUse.choices));
  const answer: VenueThemeAnswer = { hash: themeHashOf(css, logo), css, logo };
  cached = { key, answer };
  return answer;
}

export function forgetVenueTheme(): void {
  cached = null;
}
