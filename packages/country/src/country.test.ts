import { describe, expect, it } from "vitest";
import type { CountryPack } from "./country.js";
import {
  contentLanguageRules,
  findAdministrativeArea,
  findAdministrativeAreaByPostalCode,
  receiptLanguageRules,
  resolveCountryLocale,
  resolveFiscalJurisdiction,
} from "./country.js";

const pack: CountryPack = {
  countryCode: "XY",
  defaultLocale: "xy-XY",
  defaultTimeZone: "Europe/Example",
  invoiceLocales: ["xy-XY", "en-GB"],
  moduleIds: ["example"],
  availableForVenueSetup: true,
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

  it("uses the longest matching postal prefix", () => {
    const overlapping: CountryPack = {
      ...pack,
      administrativeAreas: [
        { code: "01", name: "Broad", postalPrefixes: ["1"] },
        { code: "02", name: "Specific", postalPrefixes: ["10"] },
      ],
    };
    expect(findAdministrativeAreaByPostalCode(overlapping, "10000")?.code).toBe("02");
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
    expect(
      resolveCountryLocale(pack, ["en-GB", "xy-XY"], {
        override: "en-GB",
        area: "01",
        fallback: "en-GB",
      }),
    ).toBe("en-GB");
    expect(
      resolveCountryLocale(pack, ["north-XY", "xy-XY"], {
        area: "01",
        fallback: "en-GB",
      }),
    ).toBe("north-XY");
    expect(resolveCountryLocale(pack, ["xy-XY"], { area: "01", fallback: "en-GB" })).toBe("xy-XY");
    expect(resolveCountryLocale(pack, ["en-GB"], { area: "01", fallback: "en-GB" })).toBe("en-GB");
    expect(resolveCountryLocale(pack, ["xy-XY"], { fallback: "en-GB" })).toBe("xy-XY");
    expect(resolveCountryLocale(pack, ["xy-XY"], { area: "missing", fallback: "en-GB" })).toBe(
      "xy-XY",
    );
    expect(resolveCountryLocale(pack, [], { fallback: "en-GB" })).toBe("en-GB");
  });
});

describe("contentLanguageRules", () => {
  const notice = { minimumForeign: 2, text: { en: "Two foreign languages." } };
  const ruled: CountryPack = {
    ...pack,
    officialLocales: ["xy-XY", "north-XY"],
    administrativeAreas: [
      {
        code: "01",
        name: "North",
        postalPrefixes: ["10"],
        requiredContentLocales: ["north-XY", "xy-XY"],
        defaultContentLocale: "north-XY",
        foreignLanguageNotice: notice,
      },
      { code: "02", name: "South", postalPrefixes: ["20"], requiredContentLocales: ["xy-XY"] },
      { code: "03", name: "East", postalPrefixes: ["30"] },
    ],
  };

  it("returns the area's required locales, its default content locale and its notice", () => {
    expect(contentLanguageRules(ruled, "north")).toStrictEqual({
      required: ["north-XY", "xy-XY"],
      official: ["xy-XY", "north-XY"],
      defaultContentLocale: "north-XY",
      foreignLanguageNotice: notice,
    });
  });

  it("leaves out a default content locale and a notice the area does not declare", () => {
    expect(contentLanguageRules(ruled, "02")).toStrictEqual({
      required: ["xy-XY"],
      official: ["xy-XY", "north-XY"],
    });
  });

  it("requires nothing in an area without rules, an unknown area or no area", () => {
    for (const area of ["East", "missing", null, undefined])
      expect(contentLanguageRules(ruled, area)).toStrictEqual({
        required: [],
        official: ["xy-XY", "north-XY"],
      });
  });

  it("names no official locale for a pack that declares none", () => {
    expect(contentLanguageRules(pack, "01")).toStrictEqual({ required: [], official: [] });
  });
});

describe("receiptLanguageRules", () => {
  const reason = { en: "North prints in its own language.", es: "El norte imprime en su idioma." };
  const ruled: CountryPack = {
    ...pack,
    administrativeAreas: [
      {
        code: "01",
        name: "North",
        postalPrefixes: ["10"],
        fixedReceiptLocale: { locale: "north-XY", reason },
      },
      { code: "02", name: "South", postalPrefixes: ["20"] },
    ],
  };

  it("fixes a ruled area to its locale, with the reason, and makes that the default", () => {
    expect(receiptLanguageRules(ruled, "north")).toStrictEqual({
      choices: ["xy-XY", "en-GB"],
      defaultLocale: "north-XY",
      fixed: { locale: "north-XY", reason },
    });
  });

  it("offers the pack's invoice locales with the pack default and nothing fixed elsewhere", () => {
    for (const area of ["South", "missing", null, undefined])
      expect(receiptLanguageRules(ruled, area)).toStrictEqual({
        choices: ["xy-XY", "en-GB"],
        defaultLocale: "xy-XY",
      });
  });
});
