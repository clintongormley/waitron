import { afterEach, expect, it, vi } from "vitest";
import { WAITRON_CHOICES, themeSheet } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { VENUE_THEME_STORAGE_KEY, applyVenueTheme, followVenueTheme } from "./venue-theme.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const GREEN = {
  hash: "green-hash",
  css: themeSheet(deriveTheme({ ...WAITRON_CHOICES, brandColor: "#1e5b3a", background: "tinted" })),
  logo: null,
};

it("before start nothing is adopted or applied", () => {
  localStorage.removeItem(VENUE_THEME_STORAGE_KEY);
  const before = [...document.adoptedStyleSheets];
  applyVenueTheme(GREEN);
  expect([...document.adoptedStyleSheets]).toEqual(before);
  expect(localStorage.getItem(VENUE_THEME_STORAGE_KEY)).toBeNull();
});

it("following before start sends nothing", () => {
  const spy = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", spy);
  followVenueTheme("x");
  expect(spy).not.toHaveBeenCalled();
});
