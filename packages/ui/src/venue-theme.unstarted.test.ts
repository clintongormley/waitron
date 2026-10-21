import { afterEach, expect, it, vi } from "vitest";
import { VENUE_THEME_STORAGE_KEY, applyVenueTheme, followVenueTheme } from "./venue-theme.js";
import { FIXTURE_ANSWER as GREEN } from "../test/venue-theme-fixture.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

it("loading the module creates no stylesheet", async () => {
  const made = vi.fn();
  vi.stubGlobal(
    "CSSStyleSheet",
    class extends CSSStyleSheet {
      constructor(options?: CSSStyleSheetInit) {
        super(options);
        made();
      }
    },
  );
  const fresh = (await import(
    /* @vite-ignore */ `./venue-theme.ts?unstarted=${Date.now()}`
  )) as typeof import("./venue-theme.js");
  expect(made).not.toHaveBeenCalled();
  fresh.startVenueTheme(document.createElement("div"), {
    fetchImpl: () => new Promise<Response>(() => {}),
  });
  expect(made).toHaveBeenCalledOnce();
});
