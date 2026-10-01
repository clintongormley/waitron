import { describe, expect, it } from "vitest";
import {
  COUNTRY_PACKS,
  FISCAL_TERRITORIES,
  VENUE_SETUP_COUNTRY_PACKS,
  findFiscalModules,
  getCountryPack,
  getVenueSetupCountryPack,
  resolveInstalledContentLanguageRules,
  resolveInstalledCountryLocale,
  resolveInstalledDefaultContentLanguage,
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

  it("requires nothing for a Madrid venue or a Spanish venue with no province", () => {
    for (const area of ["Madrid", null])
      expect(resolveInstalledContentLanguageRules({ country: "ES", area })).toStrictEqual({
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

  it("gives Catalan as a new Barcelona venue's default content language and nothing elsewhere", () => {
    expect(resolveInstalledDefaultContentLanguage({ country: "es", area: "Barcelona" })).toBe("ca");
    for (const input of [
      { country: "ES", area: "Valencia" },
      { country: "ES", area: "Madrid" },
      { country: "XX", area: "Barcelona" },
      { country: null, area: null },
    ])
      expect(resolveInstalledDefaultContentLanguage(input)).toBeUndefined();
  });
});
