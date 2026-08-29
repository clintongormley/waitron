import { afterEach, expect, it } from "vitest";
import { setLocale } from "./t.js";
import { localizedName } from "./localized.js";

afterEach(() => {
  // localizedName reads t.ts's module-level locale; reset to the shipped default so a setLocale in
  // one test cannot leak into another (order-independence, §4).
  setLocale("es-ES");
});

it("returns the current locale's name when the map has that key", () => {
  setLocale("es-ES");
  expect(localizedName({ "es-ES": "Café con leche", en: "Latte" })).toBe("Café con leche");
});

it("falls back to the first value when the current locale is absent", () => {
  setLocale("es-ES");
  // No "es-ES" key → the ?? Object.values(map)[0] arm, so a name in some other language still shows
  // rather than an empty string.
  expect(localizedName({ en: "Latte" })).toBe("Latte");
});

it("returns an empty string for an empty map", () => {
  expect(localizedName({})).toBe("");
});
