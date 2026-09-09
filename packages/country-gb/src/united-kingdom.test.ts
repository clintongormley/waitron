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
