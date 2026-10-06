import { findAdministrativeArea, resolveFiscalJurisdiction } from "@waitron/country";
import { describe, expect, it } from "vitest";
import {
  COUNTRY_PACKS,
  FISCAL_TERRITORIES,
  VENUE_SETUP_COUNTRY_PACKS,
  findFiscalModules,
  getCountryPack,
  getVenueSetupCountryPack,
  receiptLabelsFor,
  resolveInstalledContentLanguageRules,
  resolveInstalledCountryLocale,
  resolveInstalledDefaultContentLanguage,
  resolveInstalledReceiptLanguageRules,
  resolveInstalledStartingContentLanguages,
} from "./registry.js";

describe("installed country packs", () => {
  it("has one pack per unique country code", () => {
    expect(COUNTRY_PACKS.map(({ countryCode }) => countryCode)).toEqual(["ES", "GB"]);
    expect(new Set(COUNTRY_PACKS.map(({ countryCode }) => countryCode)).size).toBe(
      COUNTRY_PACKS.length,
    );
    expect(getCountryPack(" es ")?.countryCode).toBe("ES");
    expect(getCountryPack("XX")).toBeUndefined();
    expect(VENUE_SETUP_COUNTRY_PACKS.map(({ countryCode }) => countryCode)).toEqual(["ES"]);
    expect(getVenueSetupCountryPack(" es ")?.countryCode).toBe("ES");
    expect(getVenueSetupCountryPack("GB")).toBeUndefined();
  });

  it("carries no display name", () => {
    for (const pack of COUNTRY_PACKS) expect(Object.keys(pack)).not.toContain("name");
  });

  it("exposes only supported fiscal territories with complete module selections", () => {
    expect(FISCAL_TERRITORIES).toEqual(["ES-common", "GB-vat"]);
    expect(findFiscalModules("ES-common")).toEqual({ filing: "verifactu", tax: "vat" });
    expect(findFiscalModules("GB-vat")).toEqual({ filing: "none", tax: "none" });
    expect(findFiscalModules("ES-canary")).toBeUndefined();
    expect(findFiscalModules("missing")).toBeUndefined();
    expect(Object.isFrozen(findFiscalModules("ES-common"))).toBe(true);
  });

  it("resolves venue locales through installed country and area preferences", () => {
    expect(
      resolveInstalledCountryLocale(["es-ES", "en-GB"], {
        country: "ES",
        area: "Barcelona",
        fallback: "en-GB",
      }),
    ).toBe("es-ES");
    expect(
      resolveInstalledCountryLocale(["ca-ES", "es-ES", "en-GB"], {
        country: "ES",
        area: "Barcelona",
        fallback: "en-GB",
      }),
    ).toBe("ca-ES");
    expect(resolveInstalledCountryLocale(["en-GB"], { country: "GB", fallback: "en-GB" })).toBe(
      "en-GB",
    );
    expect(resolveInstalledCountryLocale(["en-GB"], { country: "XX", fallback: "en-GB" })).toBe(
      "en-GB",
    );
    expect(
      resolveInstalledCountryLocale(["es-ES", "en-GB"], {
        override: "es-ES",
        fallback: "en-GB",
      }),
    ).toBe("es-ES");
    expect(resolveInstalledCountryLocale(["fr-FR"], { country: "XX", fallback: "fr-FR" })).toBe(
      "fr-FR",
    );
    expect(resolveInstalledCountryLocale(["fr-FR"], { country: "XX", fallback: "en-GB" })).toBe(
      "fr-FR",
    );
    expect(resolveInstalledCountryLocale([], { country: "XX", fallback: "en-GB" })).toBe("en-GB");
    expect(
      resolveInstalledCountryLocale(["es-ES", "en-GB"], {
        country: "ES",
        fallback: "en-GB",
      }),
    ).toBe("es-ES");
  });
});

describe("content-language rules", () => {
  const SPAIN_OFFICIAL = ["es", "ca", "gl", "eu"];

  it("requires Catalan and Spanish for a Barcelona venue, as language codes", () => {
    expect(
      resolveInstalledContentLanguageRules({ country: "ES", area: "Barcelona" }),
    ).toStrictEqual({ required: ["ca", "es"], official: SPAIN_OFFICIAL });
  });

  it("carries the area's foreign-language notice for a Valencia venue", () => {
    const rules = resolveInstalledContentLanguageRules({ country: "ES", area: "46" });
    expect(rules.required).toEqual(["ca", "es"]);
    expect(rules.official).toEqual(SPAIN_OFFICIAL);
    expect(rules.foreignLanguageNotice?.minimumForeign).toBe(1);
    expect(Object.keys(rules.foreignLanguageNotice!.text).sort()).toEqual(["en", "es"]);
  });

  it("requires Galician and Spanish for an A Coruña venue", () => {
    const rules = resolveInstalledContentLanguageRules({ country: "ES", area: "A Coruña" });
    expect(rules.required).toEqual(["gl", "es"]);
    expect(rules.foreignLanguageNotice?.minimumForeign).toBe(2);
  });

  it("requires Spanish for a Madrid venue", () => {
    expect(resolveInstalledContentLanguageRules({ country: "ES", area: "Madrid" })).toStrictEqual({
      required: ["es"],
      official: SPAIN_OFFICIAL,
    });
  });

  it("requires nothing for a Spanish venue with no province", () => {
    expect(resolveInstalledContentLanguageRules({ country: "ES", area: null })).toStrictEqual({
      required: [],
      official: SPAIN_OFFICIAL,
    });
  });

  it("requires nothing and names no official language for a country with none, or no country", () => {
    for (const country of ["GB", "XX", null])
      expect(resolveInstalledContentLanguageRules({ country, area: "London" })).toStrictEqual({
        required: [],
        official: [],
      });
  });

  it("gives a new Spanish venue the regional language as its default where one is required, Spanish elsewhere", () => {
    expect(resolveInstalledDefaultContentLanguage({ country: "es", area: "Barcelona" })).toBe("ca");
    expect(resolveInstalledDefaultContentLanguage({ country: "ES", area: "Valencia" })).toBe("ca");
    expect(resolveInstalledDefaultContentLanguage({ country: "ES", area: "Madrid" })).toBe("es");
    for (const input of [
      { country: "XX", area: "Barcelona" },
      { country: null, area: null },
    ])
      expect(resolveInstalledDefaultContentLanguage(input)).toBeUndefined();
  });
});

describe("starting content languages", () => {
  it.each([
    [
      { country: "ES", area: "Madrid" },
      { defaultLanguage: "es", languages: ["es", "en"], required: ["es"] },
    ],
    [
      { country: "ES", area: "Barcelona" },
      { defaultLanguage: "ca", languages: ["ca", "es", "en"], required: ["ca", "es"] },
    ],
    [
      { country: "ES", area: "46" },
      { defaultLanguage: "ca", languages: ["ca", "es", "en"], required: ["ca", "es"] },
    ],
    [
      { country: "ES", area: "07" },
      { defaultLanguage: "ca", languages: ["ca", "es", "en"], required: ["ca", "es"] },
    ],
    [
      { country: "ES", area: "A Coruña" },
      { defaultLanguage: "gl", languages: ["gl", "es", "en"], required: ["gl", "es"] },
    ],
    [
      { country: "ES", area: "Bizkaia" },
      { defaultLanguage: "es", languages: ["es", "en"], required: [] },
    ],
    [
      { country: "ES", area: null },
      { defaultLanguage: "es", languages: ["es", "en"], required: [] },
    ],
    [
      { country: "GB", area: null },
      { defaultLanguage: "en", languages: ["en"], required: [] },
    ],
    [
      { country: "XX", area: "Barcelona" },
      { defaultLanguage: "en", languages: ["en"], required: [] },
    ],
  ])("starts a new venue in %o with these content languages", (input, expected) => {
    expect(resolveInstalledStartingContentLanguages(input)).toStrictEqual(expected);
  });

  it("requires a language, and switches English on without requiring it, wherever a venue can be set up", () => {
    for (const pack of VENUE_SETUP_COUNTRY_PACKS)
      for (const area of pack.administrativeAreas) {
        if (resolveFiscalJurisdiction(pack, area.code)?.supported !== true) continue;
        const starting = resolveInstalledStartingContentLanguages({
          country: pack.countryCode,
          area: area.code,
        });
        expect(starting.required.length, area.name).toBeGreaterThan(0);
        expect(starting.required, area.name).not.toContain("en");
        expect(starting.languages, area.name).toContain("en");
        expect(starting.languages[0], area.name).toBe(starting.defaultLanguage);
      }
  });
});

describe("receipt-language rules", () => {
  const SPAIN_OFFICIAL = ["es-ES", "ca-ES", "gl-ES", "eu-ES"];

  it("fixes a Barcelona venue's receipts to Catalan and carries the reason", () => {
    const rules = resolveInstalledReceiptLanguageRules({ country: "ES", area: "Barcelona" });
    expect(rules.choices).toEqual(SPAIN_OFFICIAL);
    expect(rules.defaultLocale).toBe("ca-ES");
    expect(rules.fixed?.locale).toBe("ca-ES");
    expect(Object.keys(rules.fixed!.reason).sort()).toEqual(["en", "es"]);
  });

  it("offers a Madrid venue the four official languages, Spanish by default, nothing fixed", () => {
    expect(resolveInstalledReceiptLanguageRules({ country: "es", area: "Madrid" })).toStrictEqual({
      choices: SPAIN_OFFICIAL,
      defaultLocale: "es-ES",
    });
  });

  it("offers nothing for a country with no installed pack, or no country, and defaults to Spanish", () => {
    for (const country of ["XX", null])
      expect(resolveInstalledReceiptLanguageRules({ country, area: "Barcelona" })).toStrictEqual({
        choices: [],
        defaultLocale: "es-ES",
      });
  });
});

describe("receipt labels", () => {
  // Compared with the pack's own entries rather than spelled out: the words are Spanish-domain
  // vocabulary, which this package's English-only guard refuses (`scripts/english-only.test.ts`).
  const spain = getCountryPack("ES")!.receiptLabels!;

  it("finds a locale's labels in the pack that has them", () => {
    expect(receiptLabelsFor("ca-ES")).toBe(spain["ca-ES"]);
    expect(receiptLabelsFor("ca-ES").date).toBe("Data");
    expect(receiptLabelsFor("es-ES")).toBe(spain["es-ES"]);
    expect(receiptLabelsFor("es-ES").date).not.toBe("Data");
  });

  it("prints Spain's Spanish labels for a locale no installed pack labels", () => {
    for (const locale of ["en-GB", "es", "fr-FR"])
      expect(receiptLabelsFor(locale)).toBe(spain["es-ES"]);
  });
});

describe("holiday calendars", () => {
  it("installs Spain's holiday data and two local holidays a year, and none for Great Britain", () => {
    const spain = getCountryPack("ES")!;
    expect(spain.holidayCalendar?.localEntryLimit).toBe(2);
    expect(getCountryPack("GB")!.holidayCalendar).toBeUndefined();
  });

  it("finds a stored province's region through the installed pack", () => {
    const spain = getCountryPack("es")!;
    for (const stored of ["Sevilla", "41"]) {
      const code = findAdministrativeArea(spain, stored)!.code;
      expect(spain.holidayCalendar!.regionForProvince(code)).toBe("01");
    }
    expect(findAdministrativeArea(spain, "Nowhere")).toBeUndefined();
  });
});
