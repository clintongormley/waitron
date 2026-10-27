import { SUPPORTED_LOCALE_CODES } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import { COUNTRY_PACKS, resolveInstalledStartingContentLanguages } from "./registry.js";
import {
  STARTER_CONTENT_LANGUAGES,
  resolveInstalledStarterLanguages,
  starterName,
  starterNames,
  type StarterTranslations,
} from "./starter-languages.js";

const FILE: StarterTranslations<string> = {
  Alpha: { es: "alpha-es", ca: "alpha-ca", "ca-ES-valencia": "alpha-val", gl: "alpha-gl" },
  Gamma: { es: "gamma-es", ca: "gamma-ca", "ca-ES-valencia": "gamma-val", gl: "gamma-gl" },
};

describe("resolveInstalledStarterLanguages", () => {
  it.each([
    ["ES", "Madrid", "es-ES", "es", ["es", "en"]],
    ["ES", "Barcelona", "ca-ES", "es", ["ca", "es", "en"]],
    ["ES", "Valencia", "es-ES", "es", ["ca-ES-valencia", "es", "en"]],
    ["ES", "A Coruña", "gl-ES", "es", ["gl", "es", "en"]],
    ["ES", "Madrid", "en-GB", "en", ["es", "en"]],
    ["ES", null, "es-ES", "es", ["es", "en"]],
    ["GB", "London", null, "en", ["en"]],
    ["XX", null, "es-ES", "es", ["en"]],
  ] as const)(
    "%s / %s with %s receipts: staff %s, languages %j",
    (country, area, receiptLocale, staffLanguage, languages) => {
      expect(resolveInstalledStarterLanguages({ country, area, receiptLocale })).toEqual({
        languages,
        staffLanguage,
      });
    },
  );
});

describe("starterNames", () => {
  it("answers English and each of the venue's languages the entry has", () => {
    expect(starterNames(FILE, "Alpha", ["ca-ES-valencia", "es", "en"])).toEqual({
      en: "Alpha",
      "ca-ES-valencia": "alpha-val",
      es: "alpha-es",
    });
  });

  it("includes English when the languages do not", () => {
    expect(starterNames(FILE, "Alpha", ["es"])).toEqual({ en: "Alpha", es: "alpha-es" });
  });

  it("leaves out a language the entry does not have", () => {
    expect(starterNames(FILE, "Alpha", ["fr", "en"])).toEqual({ en: "Alpha" });
  });

  it("answers only English for a starter with no entry", () => {
    expect(starterNames(FILE, "Beta-missing", ["es", "en"])).toEqual({ en: "Beta-missing" });
  });
});

describe("starterName", () => {
  it("answers the staff language's text", () => {
    expect(starterName(FILE, "Alpha", "es")).toBe("alpha-es");
  });

  it("answers English for en", () => {
    expect(starterName(FILE, "Alpha", "en")).toBe("Alpha");
  });

  it("answers English for a starter with no entry", () => {
    expect(starterName(FILE, "Beta-missing", "es")).toBe("Beta-missing");
    expect(starterName(FILE, "Beta-missing", "en")).toBe("Beta-missing");
  });
});

describe("starter languages", () => {
  it("every language a new venue can start with is a starter language", () => {
    const languages = new Set<string>();
    for (const pack of COUNTRY_PACKS) {
      for (const area of [undefined, ...pack.administrativeAreas.map(({ name }) => name)]) {
        for (const language of resolveInstalledStartingContentLanguages({
          country: pack.countryCode,
          area,
        }).languages) {
          languages.add(language);
        }
      }
    }
    languages.delete("en");
    expect([...languages].sort()).toEqual([...STARTER_CONTENT_LANGUAGES].sort());
  });

  it("the staff languages are the supported locales' subtags", () => {
    expect(SUPPORTED_LOCALE_CODES.map((code) => code.split("-")[0])).toEqual(["es", "en"]);
  });
});
