import { describe, expect, it } from "vitest";
import { resolveFiscalJurisdiction } from "@waitron/country";
import { UNITED_KINGDOM } from "./united-kingdom.js";

describe("UNITED_KINGDOM", () => {
  it("preserves the existing no-regime venue defaults", () => {
    expect(UNITED_KINGDOM).toMatchObject({
      countryCode: "GB",
      defaultLocale: "en-GB",
      defaultTimeZone: "Europe/London",
      invoiceLocales: ["en-GB"],
    });
    expect(resolveFiscalJurisdiction(UNITED_KINGDOM, null)).toEqual({
      id: "GB-vat",
      areaCodes: [],
      supported: true,
      modules: { filing: "none", tax: "none" },
    });
  });
});

describe("country time-zone choices", () => {
  it("lists its defaults and administrative-area suggestions explicitly", () => {
    expect(UNITED_KINGDOM.timeZones).toStrictEqual(["Europe/London"]);
    expect(UNITED_KINGDOM.timeZones).toContain(UNITED_KINGDOM.defaultTimeZone);
    for (const area of UNITED_KINGDOM.administrativeAreas) {
      if (area.timeZone !== undefined) expect(UNITED_KINGDOM.timeZones).toContain(area.timeZone);
    }
  });
});
