import { beforeEach, afterEach, expect, it } from "vitest";
import { setLocale } from "./t.js";
import { localizedName } from "./localized.js";
import { setContentLanguages } from "@waitron/ui";

beforeEach(() => setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] }));

afterEach(() => {
  // Reset to the shipped default so a setLocale in one test cannot leak into another.
  setLocale("es-ES");
  setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
});

it("uses the site default rather than the first stored translation", () => {
  setLocale("fr-FR");
  setContentLanguages({ defaultLanguage: "es", languages: ["es", "fr", "en"] });
  expect(localizedName({ en: "Bread", es: "Pan" })).toBe("Pan");
});

it("resolves a FULL invoice-locale-tag map (the receipt/invoice path, es-ES)", () => {
  setLocale("es-ES");
  // "en-GB" first, so a lookup falling back to the first value would return the wrong name.
  expect(localizedName({ "en-GB": "Latte", "es-ES": "Café con leche" })).toBe("Café con leche");
});

it("resolves a SHORT language-subtag map (the catalogue path, es)", () => {
  setLocale("es-ES");
  // "en" first, so a lookup falling back to the first value would return the wrong name.
  expect(localizedName({ en: "Coffee", es: "Café" })).toBe("Café");
});

it("prefers the FULL tag over the short subtag when both are present", () => {
  setLocale("es-ES");
  expect(localizedName({ "es-ES": "Café con leche", es: "Café" })).toBe("Café con leche");
});

it("falls back to the configured English default when the current language is absent", () => {
  setLocale("es-ES");
  setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
  expect(localizedName({ en: "Latte" })).toBe("Latte");
});

it("returns an empty string for an empty map", () => {
  expect(localizedName({})).toBe("");
});
