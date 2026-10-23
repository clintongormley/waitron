import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveThemeFrom, themeSheet, type ThemeChoices } from "@waitron/ui-core/theme";
import { SERVER_THEME_DEFAULTS } from "./theme-defaults.js";
import {
  WAITRON_THEME_ANSWER,
  forgetVenueTheme,
  themeHashOf,
  venueThemeAnswer,
} from "./venue-theme.js";

vi.mock("@waitron/ui-core/theme", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/ui-core/theme")>();
  return { ...actual, deriveThemeFrom: vi.fn(actual.deriveThemeFrom) };
});

const LEMON: ThemeChoices = {
  brandColor: "#f2d300",
  brandFix: {},
  background: "neutral",
  corners: "standard",
  logo: null,
  handSet: { light: {}, dark: {} },
};

const DARK_GREEN: ThemeChoices = { ...LEMON, brandColor: "#1e5b3a", background: "tinted" };

const LOGO = { light: "/media/renditions/v1/a.webp/display/5000-5000-100.webp", dark: null };

const ID = "0b0c4f1e-6a55-4d6e-9d1b-3f1f6c1d2a10";

const derivations = vi.mocked(deriveThemeFrom);

beforeEach(() => {
  forgetVenueTheme();
  derivations.mockClear();
});

describe("venueThemeAnswer", () => {
  it("answers Waitron's empty sheet with no theme in use, or one this release cannot use", () => {
    const empty = {
      hash: "e5b913bdac6111b271019fdd50363b9b68977f24809cb00fb7a0cb54c2e72146",
      css: "",
      logo: null,
    };
    expect(WAITRON_THEME_ANSWER).toEqual(empty);
    expect(venueThemeAnswer({ inUse: null, logo: null })).toEqual(empty);
    expect(venueThemeAnswer({ inUse: { id: ID, choices: null }, logo: null })).toEqual(empty);
    expect(derivations).not.toHaveBeenCalled();
  });

  it("serves the lemon brand (#f2d300) as picked, warnings and all", () => {
    const answer = venueThemeAnswer({ inUse: { id: ID, choices: LEMON }, logo: null });
    const css = themeSheet(deriveThemeFrom(SERVER_THEME_DEFAULTS, LEMON));
    expect(answer.css).toBe(css);
    expect(answer.css).toContain("--wt-color-primary: #f2d300;");
    expect(answer.css).not.toContain("#9d8a15");
    expect(answer.hash).toBe(themeHashOf(css, null));
    expect(answer.logo).toBeNull();
  });

  it("derives once while nothing changes", () => {
    const first = venueThemeAnswer({ inUse: { id: ID, choices: LEMON }, logo: null });
    const second = venueThemeAnswer({ inUse: { id: ID, choices: { ...LEMON } }, logo: null });
    expect(second).toEqual(first);
    expect(derivations).toHaveBeenCalledTimes(1);

    const other = venueThemeAnswer({ inUse: { id: ID, choices: DARK_GREEN }, logo: null });
    expect(other.hash).not.toBe(first.hash);
    expect(derivations).toHaveBeenCalledTimes(2);
  });

  it("returns to Waitron's hash when no theme is in use, and to its own when used again", () => {
    const lemon = venueThemeAnswer({ inUse: { id: ID, choices: LEMON }, logo: null });
    expect(lemon.hash).not.toBe(WAITRON_THEME_ANSWER.hash);
    expect(venueThemeAnswer({ inUse: null, logo: null }).hash).toBe(WAITRON_THEME_ANSWER.hash);
    expect(venueThemeAnswer({ inUse: { id: ID, choices: LEMON }, logo: null }).hash).toBe(
      lemon.hash,
    );
  });

  it("answers the logo's addresses and hashes them", () => {
    const answer = venueThemeAnswer({ inUse: { id: ID, choices: LEMON }, logo: LOGO });
    expect(answer.logo).toEqual(LOGO);
    expect(answer.hash).toBe(themeHashOf(answer.css, LOGO));
    const without = venueThemeAnswer({ inUse: { id: ID, choices: LEMON }, logo: null });
    expect(without.css).toBe(answer.css);
    expect(answer.hash).not.toBe(without.hash);
  });

  it("a new address misses the cache, and the same address twice derives once", () => {
    const inUse = { id: ID, choices: LEMON };
    const first = venueThemeAnswer({ inUse, logo: LOGO });
    expect(venueThemeAnswer({ inUse, logo: { ...LOGO } })).toEqual(first);
    expect(derivations).toHaveBeenCalledTimes(1);

    const moved = {
      light: "/media/renditions/v1/a.webp/display/5000-5000-120.webp",
      dark: "/media/renditions/v1/b.webp/display/5000-5000-100.webp",
    };
    const second = venueThemeAnswer({ inUse, logo: moved });
    expect(derivations).toHaveBeenCalledTimes(2);
    expect(second.logo).toEqual(moved);
    expect(second.hash).not.toBe(first.hash);
  });
});
