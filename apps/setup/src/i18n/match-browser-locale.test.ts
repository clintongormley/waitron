import { expect, it } from "vitest";
import { matchBrowserLocale } from "./match-browser-locale.js";

it("takes the first browser language the wizard speaks, whatever its region", () => {
  expect(matchBrowserLocale(["fr-FR", "es-MX", "en-GB"])).toBe("es-ES");
  expect(matchBrowserLocale(["en-US", "es-ES"])).toBe("en-GB");
});

it("matches a bare language and ignores letter case", () => {
  expect(matchBrowserLocale(["ES"])).toBe("es-ES");
  expect(matchBrowserLocale(["EN-au"])).toBe("en-GB");
});

it("falls back to British English when the browser names no language the wizard speaks", () => {
  expect(matchBrowserLocale(["fr-FR", "de"])).toBe("en-GB");
  expect(matchBrowserLocale([])).toBe("en-GB");
});

it("does not take a language whose code only begins with a supported one", () => {
  expect(matchBrowserLocale(["est", "eng"])).toBe("en-GB");
  expect(matchBrowserLocale(["est", "es"])).toBe("es-ES");
});
