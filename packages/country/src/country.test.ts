import { describe, expect, it } from "vitest";
import type { CountryPack } from "./country.js";
import {
  findAdministrativeArea,
  findAdministrativeAreaByPostalCode,
  resolveCountryLocale,
  resolveFiscalJurisdiction,
} from "./country.js";

const pack: CountryPack = {
  countryCode: "XY",
  name: "Example",
  defaultLocale: "xy-XY",
  defaultTimeZone: "Europe/Example",
  invoiceLocales: ["xy-XY", "en-GB"],
  moduleIds: ["example"],
  administrativeAreas: [
    {
      code: "01",
      name: "North",
      aliases: ["Northern"],
      postalPrefixes: ["10"],
      defaultLocale: "north-XY",
      timeZone: "Europe/North",
    },
    { code: "02", name: "South", postalPrefixes: ["20", "21"] },
  ],
  fiscalJurisdictions: [
    {
      id: "XY-common",
      areaCodes: ["01"],
      supported: true,
      modules: { filing: "example-filing", tax: "example-tax" },
    },
    { id: "XY-special", areaCodes: ["02"], supported: false },
  ],
};

describe("country geography", () => {
  it("finds an administrative area by code, name, or alias without case sensitivity", () => {
    expect(findAdministrativeArea(pack, "01")?.name).toBe("North");
    expect(findAdministrativeArea(pack, "north")?.code).toBe("01");
    expect(findAdministrativeArea(pack, " NORTHERN ")?.code).toBe("01");
    expect(findAdministrativeArea(pack, "missing")).toBeUndefined();
    expect(findAdministrativeArea(pack, "   ")).toBeUndefined();
  });

  it("derives an area from an unambiguous postal prefix", () => {
    expect(findAdministrativeAreaByPostalCode(pack, "10000")?.code).toBe("01");
    expect(findAdministrativeAreaByPostalCode(pack, "21000")?.code).toBe("02");
    expect(findAdministrativeAreaByPostalCode(pack, "99999")).toBeUndefined();
  });

  it("resolves supported and explicitly unsupported fiscal jurisdictions", () => {
    expect(resolveFiscalJurisdiction(pack, "01")).toEqual(pack.fiscalJurisdictions[0]);
    expect(resolveFiscalJurisdiction(pack, "02")).toEqual(pack.fiscalJurisdictions[1]);
    expect(resolveFiscalJurisdiction(pack, "99")).toBeUndefined();
  });

  it("uses an explicit country-wide jurisdiction only when no area mapping matches", () => {
    const countryWide: CountryPack = {
      ...pack,
      defaultFiscalJurisdictionId: "XY-country-wide",
      fiscalJurisdictions: [
        ...pack.fiscalJurisdictions,
        {
          id: "XY-country-wide",
          areaCodes: [],
          supported: true,
          modules: { filing: "none", tax: "none" },
        },
      ],
    };
    expect(resolveFiscalJurisdiction(countryWide, null)?.id).toBe("XY-country-wide");
    expect(resolveFiscalJurisdiction(countryWide, "99")?.id).toBe("XY-country-wide");
    expect(resolveFiscalJurisdiction(countryWide, "01")?.id).toBe("XY-common");
  });
});

describe("resolveCountryLocale", () => {
  it("uses the first available override, area preference, country default, then fallback", () => {
    expect(resolveCountryLocale(pack, ["en-GB", "xy-XY"], { override: "en-GB", area: "01" })).toBe(
      "en-GB",
    );
    expect(resolveCountryLocale(pack, ["north-XY", "xy-XY"], { area: "01" })).toBe("north-XY");
    expect(resolveCountryLocale(pack, ["xy-XY"], { area: "01" })).toBe("xy-XY");
    expect(resolveCountryLocale(pack, ["en-GB"], { area: "01", fallback: "en-GB" })).toBe("en-GB");
    expect(resolveCountryLocale(pack, ["xy-XY"], {})).toBe("xy-XY");
    expect(resolveCountryLocale(pack, ["xy-XY"], { area: "missing" })).toBe("xy-XY");
    expect(resolveCountryLocale(pack, [], { fallback: "en-GB" })).toBe("en-GB");
    expect(resolveCountryLocale(pack, [], {})).toBe("xy-XY");
  });
});
