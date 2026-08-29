import { afterEach, expect, it } from "vitest";
import { setLocale } from "./t.js";
import { localizedName } from "./localized.js";

afterEach(() => {
  // localizedName reads t.ts's module-level locale; reset to the shipped default so a setLocale in
  // one test cannot leak into another (order-independence, §4).
  setLocale("es-ES");
});

it("resolves the current language via a region-stripped tag (es-ES → es)", () => {
  setLocale("es-ES");
  // A descriptions map is keyed by SHORT language subtags, so the full tag must be region-stripped
  // before the lookup (mirrors pickLocale). "en" is listed FIRST on purpose so a raw currentLocale()
  // lookup (map["es-ES"] → undefined → Object.values[0] = "Latte") would return the WRONG value —
  // this discriminates the region-strip from the first-value fallback (proven by deletion).
  expect(localizedName({ en: "Latte", es: "Café con leche" })).toBe("Café con leche");
});

it("falls back to the first value when the current language is absent", () => {
  setLocale("es-ES");
  // No "es" key → the ?? Object.values(map)[0] arm, so a name in some other language still shows
  // rather than an empty string.
  expect(localizedName({ en: "Latte" })).toBe("Latte");
});

it("returns an empty string for an empty map", () => {
  expect(localizedName({})).toBe("");
});
