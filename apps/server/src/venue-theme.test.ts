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
  handSet: { light: {}, dark: {} },
};

const DARK_GREEN: ThemeChoices = { ...LEMON, brandColor: "#1e5b3a", background: "tinted" };

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
    expect(venueThemeAnswer(null)).toEqual(empty);
    expect(venueThemeAnswer({ id: ID, choices: null })).toEqual(empty);
    expect(derivations).not.toHaveBeenCalled();
  });

  it("serves the lemon brand (#f2d300) as picked, warnings and all", () => {
    const answer = venueThemeAnswer({ id: ID, choices: LEMON });
    const css = themeSheet(deriveThemeFrom(SERVER_THEME_DEFAULTS, LEMON));
    expect(answer.css).toBe(css);
    expect(answer.css).toContain("--wt-color-primary: #f2d300;");
    expect(answer.css).not.toContain("#9d8a15");
    expect(answer.hash).toBe(themeHashOf(css, null));
    expect(answer.logo).toBeNull();
  });

  it("derives once while nothing changes", () => {
    const first = venueThemeAnswer({ id: ID, choices: LEMON });
    const second = venueThemeAnswer({ id: ID, choices: { ...LEMON } });
    expect(second).toEqual(first);
    expect(derivations).toHaveBeenCalledTimes(1);

    const other = venueThemeAnswer({ id: ID, choices: DARK_GREEN });
    expect(other.hash).not.toBe(first.hash);
    expect(derivations).toHaveBeenCalledTimes(2);
  });

  it("returns to Waitron's hash when no theme is in use, and to its own when used again", () => {
    const lemon = venueThemeAnswer({ id: ID, choices: LEMON });
    expect(lemon.hash).not.toBe(WAITRON_THEME_ANSWER.hash);
    expect(venueThemeAnswer(null).hash).toBe(WAITRON_THEME_ANSWER.hash);
    expect(venueThemeAnswer({ id: ID, choices: LEMON }).hash).toBe(lemon.hash);
  });
});
