import { afterEach, expect, it } from "vitest";
import { setLocale } from "./t.js";
import { localizedName } from "./localized.js";

afterEach(() => {
  // localizedName reads t.ts's module-level locale; reset to the shipped default so a setLocale in
  // one test cannot leak into another (order-independence, §4).
  setLocale("es-ES");
});

it("resolves a FULL invoice-locale-tag map (the receipt/invoice path, es-ES)", () => {
  setLocale("es-ES");
  // The receipt path keys `descriptions` by the full tag ("es-ES"). "en-GB" is listed FIRST so a
  // short-subtag-only lookup (map["es"] → undefined → Object.values[0] = "Latte") would return the
  // WRONG value — this discriminates the full-tag hit from the first-value fallback (proven by
  // deletion: it would FAIL under region-strip-only).
  expect(localizedName({ "en-GB": "Latte", "es-ES": "Café con leche" })).toBe("Café con leche");
});

it("resolves a SHORT language-subtag map (the catalogue/product path, es)", () => {
  setLocale("es-ES");
  // The catalogue path keys `descriptions` by the short subtag ("es"). "en" is listed FIRST so a
  // full-tag-only lookup (map["es-ES"] → undefined → Object.values[0] = "Coffee") would return the
  // WRONG value — this discriminates the short-subtag fallback from the first-value fallback (proven
  // by deletion: it would FAIL under full-tag-only).
  expect(localizedName({ en: "Coffee", es: "Café" })).toBe("Café");
});

it("prefers the FULL tag over the short subtag when both are present", () => {
  setLocale("es-ES");
  // Precedence: map[loc] before map[lang]. A map carrying both keys returns the full-tag entry.
  expect(localizedName({ "es-ES": "Café con leche", es: "Café" })).toBe("Café con leche");
});

it("falls back to the first value when the current language is absent", () => {
  setLocale("es-ES");
  // Neither "es-ES" nor "es" present → the ?? Object.values(map)[0] arm, so a name in some other
  // language still shows rather than an empty string.
  expect(localizedName({ en: "Latte" })).toBe("Latte");
});

it("returns an empty string for an empty map", () => {
  expect(localizedName({})).toBe("");
});
