import { describe, expect, it } from "vitest";
import type { CountryPack } from "./country.js";
import { createHolidayCalendar, type HolidayDataset, type HolidayDatasetRow } from "./holidays.js";
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

describe("holiday calendar", () => {
  const source = {
    id: "XY-source",
    title: "Example gazette",
    url: "https://example.test/g",
    sha256: "a".repeat(64),
  };
  const dataset: HolidayDataset = {
    localEntryLimit: 3,
    sources: [source],
    provinceRegions: { "01": "R1", "02": "R1", "03": "R2" },
    areas: [
      { key: "isle-a", name: "Isle A", provinces: ["02"] },
      { key: "isle-b", name: "Isle B", provinces: ["02"] },
      { key: "valley", name: "Valley", provinces: ["01"] },
      { key: "plain", name: "Plain", provinces: ["01"] },
    ],
    years: [
      {
        year: 2030,
        dataVersion: "XY-2030.1",
        sourceIds: ["XY-source"],
        rows: [
          {
            key: "new-year",
            date: "2030-01-01",
            name: "New Year",
            scope: "national",
            regions: ["R1", "R2"],
            sourceId: "XY-source",
          },
          {
            key: "spring-r1",
            date: "2030-04-01",
            name: "Spring",
            scope: "national",
            regions: ["R1"],
            sourceId: "XY-source",
          },
          {
            key: "founders",
            date: "2030-04-01",
            name: "Founders",
            scope: "regional",
            regions: ["R1"],
            sourceId: "XY-source",
          },
          {
            key: "r2-day",
            date: "2030-05-05",
            name: "R2 Day",
            scope: "regional",
            regions: ["R2"],
            sourceId: "XY-source",
          },
          {
            key: "isle-a-day",
            date: "2030-06-01",
            name: "Isle A Day",
            scope: "regional",
            regions: ["R1"],
            onlyAreas: ["isle-a"],
            sourceId: "XY-source",
          },
          {
            key: "isle-b-day",
            date: "2030-06-02",
            name: "Isle B Day",
            scope: "regional",
            regions: ["R1"],
            onlyAreas: ["isle-b"],
            sourceId: "XY-source",
          },
          {
            key: "boxing",
            date: "2030-12-26",
            name: "Boxing",
            scope: "regional",
            regions: ["R1"],
            exceptAreas: ["valley"],
            sourceId: "XY-source",
          },
          {
            key: "valley-day",
            date: "2030-06-17",
            name: "Valley Day",
            scope: "regional",
            regions: ["R1"],
            onlyAreas: ["valley"],
            sourceId: "XY-source",
          },
        ],
      },
      { year: 2032, dataVersion: "XY-2032.1", sourceIds: ["XY-source"], rows: [] },
    ],
  };
  const calendar = createHolidayCalendar(dataset);
  const fact = (key: string, date: string, name: string, scope: "national" | "regional") => ({
    id: `shipped:${key}`,
    date,
    name,
    scope,
    sourceId: "XY-source",
  });
  const year = (state: string, regionCode: string | null, y = 2030) => ({
    year: y,
    state,
    regionCode,
    dataVersion: state === "complete" || state === "area_required" ? `XY-${y}.1` : null,
    sourceIds: state === "complete" || state === "area_required" ? ["XY-source"] : [],
  });

  it("maps a province to its region and nothing else", () => {
    expect(calendar.regionForProvince("01")).toBe("R1");
    expect(calendar.regionForProvince("03")).toBe("R2");
    expect(calendar.regionForProvince("99")).toBeUndefined();
    expect(calendar.regionForProvince("constructor")).toBeUndefined();
    expect(calendar.regionForProvince("")).toBeUndefined();
  });

  it("offers a province's sourced areas, and none to a province without them", () => {
    expect(calendar.areasForProvince("02")).toEqual([
      { key: "isle-a", name: "Isle A" },
      { key: "isle-b", name: "Isle B" },
    ]);
    expect(calendar.areasForProvince("03")).toEqual([]);
    expect(calendar.areasForProvince("99")).toEqual([]);
  });

  it("returns only facts inside the inclusive range, ordered by date, then national first", () => {
    const read = calendar.read({
      provinceCode: "03",
      areaKey: null,
      from: "2030-01-01",
      to: "2030-05-05",
    });
    expect(read).toEqual({
      facts: [
        fact("new-year", "2030-01-01", "New Year", "national"),
        fact("r2-day", "2030-05-05", "R2 Day", "regional"),
      ],
      coverage: [year("complete", "R2")],
    });
    expect(
      calendar.read({ provinceCode: "03", areaKey: null, from: "2030-01-02", to: "2030-05-04" })
        .facts,
    ).toEqual([]);
  });

  it("keeps every distinct fact on one date, and the region membership of each", () => {
    const facts = calendar.read({
      provinceCode: "02",
      areaKey: "isle-b",
      from: "2030-04-01",
      to: "2030-04-01",
    }).facts;
    expect(facts).toEqual([
      fact("spring-r1", "2030-04-01", "Spring", "national"),
      fact("founders", "2030-04-01", "Founders", "regional"),
    ]);
    expect(
      calendar.read({ provinceCode: "03", areaKey: null, from: "2030-04-01", to: "2030-04-01" })
        .facts,
    ).toEqual([]);
  });

  it("orders facts of one date and scope by id, whatever order the dataset lists them in", () => {
    const row = dataset.years[0]!.rows[0]!;
    const shuffled = createHolidayCalendar({
      ...dataset,
      years: [
        {
          ...dataset.years[0]!,
          rows: [
            ...dataset.years[0]!.rows,
            { ...row, key: "z-day", date: "2030-03-03" },
            { ...row, key: "a-day", date: "2030-03-03" },
          ],
        },
      ],
    });
    expect(
      shuffled
        .read({ provinceCode: "03", areaKey: null, from: "2030-03-03", to: "2030-03-03" })
        .facts.map(({ id }) => id),
    ).toEqual(["shipped:a-day", "shipped:z-day"]);
  });

  it("applies an area's replacement instead of the replaced holiday, never both", () => {
    const span = { from: "2030-06-01", to: "2030-12-31" };
    expect(
      calendar.read({ provinceCode: "01", areaKey: "valley", ...span }).facts.map(({ id }) => id),
    ).toEqual(["shipped:valley-day"]);
    expect(
      calendar.read({ provinceCode: "01", areaKey: "plain", ...span }).facts.map(({ id }) => id),
    ).toEqual(["shipped:boxing"]);
  });

  it("returns only the certain facts and asks for the area while it is unknown", () => {
    const valleyless = calendar.read({
      provinceCode: "01",
      areaKey: null,
      from: "2030-01-01",
      to: "2030-12-31",
    });
    expect(valleyless.facts.map(({ id }) => id)).toEqual([
      "shipped:new-year",
      "shipped:spring-r1",
      "shipped:founders",
    ]);
    expect(valleyless.coverage).toEqual([year("area_required", "R1")]);
    const isle = calendar.read({
      provinceCode: "02",
      areaKey: null,
      from: "2030-01-01",
      to: "2030-12-31",
    });
    expect(isle.facts.map(({ id }) => id)).toEqual([
      "shipped:new-year",
      "shipped:spring-r1",
      "shipped:founders",
      "shipped:boxing",
    ]);
    expect(isle.coverage).toEqual([year("area_required", "R1")]);
  });

  it("treats an area another province owns as no area chosen", () => {
    const read = calendar.read({
      provinceCode: "02",
      areaKey: "valley",
      from: "2030-06-01",
      to: "2030-06-30",
    });
    expect(read.facts).toEqual([]);
    expect(read.coverage).toEqual([year("area_required", "R1")]);
  });

  it("lists an island's own day only for that island", () => {
    const span = { from: "2030-06-01", to: "2030-06-01" };
    expect(calendar.read({ provinceCode: "02", areaKey: "isle-a", ...span })).toEqual({
      facts: [fact("isle-a-day", "2030-06-01", "Isle A Day", "regional")],
      coverage: [year("complete", "R1")],
    });
    expect(calendar.read({ provinceCode: "02", areaKey: "isle-b", ...span }).facts).toEqual([]);
  });

  it("tells an unknown region, a missing year and an ordinary day apart", () => {
    expect(
      calendar.read({ provinceCode: "99", areaKey: null, from: "2030-01-01", to: "2030-01-01" }),
    ).toEqual({
      facts: [],
      coverage: [year("unknown_region", null)],
    });
    expect(
      calendar.read({ provinceCode: "03", areaKey: null, from: "2031-01-01", to: "2031-01-01" }),
    ).toEqual({
      facts: [],
      coverage: [year("missing_year", "R2", 2031)],
    });
    expect(
      calendar.read({ provinceCode: "03", areaKey: null, from: "2030-01-02", to: "2030-01-02" }),
    ).toEqual({
      facts: [],
      coverage: [year("complete", "R2")],
    });
  });

  it("describes each civil year of a range that crosses years on its own", () => {
    expect(
      calendar.read({ provinceCode: "03", areaKey: null, from: "2030-12-31", to: "2032-01-01" })
        .coverage,
    ).toEqual([
      year("complete", "R2"),
      year("missing_year", "R2", 2031),
      year("complete", "R2", 2032),
    ]);
    expect(
      calendar.read({ provinceCode: "99", areaKey: null, from: "2030-12-31", to: "2031-01-01" })
        .coverage,
    ).toEqual([year("unknown_region", null), year("unknown_region", null, 2031)]);
  });

  it("refuses a range that is not two real dates in order", () => {
    for (const [from, to] of [
      ["2030-02-30", "2030-03-01"],
      ["2030-1-01", "2030-03-01"],
      ["2030-03-02", "2030-03-01"],
    ] as const)
      expect(() => calendar.read({ provinceCode: "03", areaKey: null, from, to })).toThrow(
        RangeError,
      );
  });

  it("carries the dataset's own allowance and sources", () => {
    expect(calendar.localEntryLimit).toBe(3);
    expect(calendar.sources).toEqual([source]);
    for (const limit of [0, 1])
      expect(createHolidayCalendar({ ...dataset, localEntryLimit: limit }).localEntryLimit).toBe(
        limit,
      );
  });

  it("is optional on a country pack", () => {
    const withCalendar: CountryPack = { ...pack, holidayCalendar: calendar };
    expect(withCalendar.holidayCalendar?.localEntryLimit).toBe(3);
    expect(pack.holidayCalendar).toBeUndefined();
  });

  it("refuses a dataset that could not describe a real calendar", () => {
    const row = dataset.years[0]!.rows[0]!;
    const withRows = (rows: readonly HolidayDatasetRow[]): HolidayDataset => ({
      ...dataset,
      years: [{ ...dataset.years[0]!, rows: [...dataset.years[0]!.rows, ...rows] }],
    });
    const refused: [string, HolidayDataset][] = [
      ["negative allowance", { ...dataset, localEntryLimit: -1 }],
      ["fractional allowance", { ...dataset, localEntryLimit: 1.5 }],
      ["duplicate fact key", withRows([{ ...row, date: "2030-01-02" }])],
      ["unreal date", withRows([{ ...row, key: "x", date: "2030-02-30" }])],
      ["date in another year", withRows([{ ...row, key: "x", date: "2031-01-01" }])],
      ["unknown region", withRows([{ ...row, key: "x", regions: ["R9"] }])],
      ["no region", withRows([{ ...row, key: "x", regions: [] }])],
      ["unknown area", withRows([{ ...row, key: "x", onlyAreas: ["nowhere"] }])],
      ["unknown source", withRows([{ ...row, key: "x", sourceId: "XY-other" }])],
      [
        "unknown year source",
        { ...dataset, years: [{ ...dataset.years[0]!, sourceIds: ["XY-other"] }] },
      ],
      ["source without a hash", { ...dataset, sources: [{ ...source, sha256: "" }] }],
      ["duplicate year", { ...dataset, years: [dataset.years[0]!, dataset.years[0]!] }],
      [
        "area for an unknown province",
        { ...dataset, areas: [...dataset.areas, { key: "far", name: "Far", provinces: ["99"] }] },
      ],
      [
        "area no row names",
        { ...dataset, areas: [...dataset.areas, { key: "idle", name: "Idle", provinces: ["03"] }] },
      ],
      ["duplicate area", { ...dataset, areas: [...dataset.areas, dataset.areas[0]!] }],
    ];
    for (const [label, broken] of refused)
      expect(() => createHolidayCalendar(broken), label).toThrow();
  });
});
