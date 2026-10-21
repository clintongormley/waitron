import { expect, it } from "vitest";
import { WAITRON_CHOICES, themeSheet } from "@waitron/ui-core/theme";
import { deriveTheme } from "@waitron/ui-core/theme/waitron";
import { VENUE_THEME_STORAGE_KEY, applyVenueTheme } from "./venue-theme.js";

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
