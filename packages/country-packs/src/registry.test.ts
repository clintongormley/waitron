import { describe, expect, it } from "vitest";
import {
  COUNTRY_PACKS,
  FISCAL_TERRITORIES,
  VENUE_SETUP_COUNTRY_PACKS,
  findFiscalModules,
  getCountryPack,
  getVenueSetupCountryPack,
  resolveInstalledCountryLocale,
} from "./registry.js";

describe("installed country packs", () => {
  it("has one pack per unique country code", () => {
    expect(COUNTRY_PACKS.map(({ countryCode }) => countryCode)).toEqual(["ES", "GB"]);
    expect(new Set(COUNTRY_PACKS.map(({ countryCode }) => countryCode)).size).toBe(
      COUNTRY_PACKS.length,
    );
    expect(getCountryPack(" es ")?.name).toBe("España");
    expect(getCountryPack("XX")).toBeUndefined();
    expect(VENUE_SETUP_COUNTRY_PACKS.map(({ countryCode }) => countryCode)).toEqual(["ES"]);
    expect(getVenueSetupCountryPack(" es ")?.name).toBe("España");
    expect(getVenueSetupCountryPack("GB")).toBeUndefined();
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
