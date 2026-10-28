import { describe, expect, it } from "vitest";
import * as packs from "./index.js";

describe("recipient identity independent of postal country", () => {
  it.each(["ES", "FR"])("normalizes a Spanish NIF with postal country %s", (countryCode) => {
    expect(packs.recipientIdentifierResult?.({ taxId: " b12345674 ", countryCode })).toEqual({
      valid: true,
      value: { taxId: "B12345674" },
    });
  });

  it.each(["ES", "FR"])("preserves a French passport with postal country %s", (countryCode) => {
    expect(
      packs.recipientIdentifierResult?.({
        taxId: " Ab-09 /xy ",
        identifierType: "passport",
        identifierCountryCode: "FR",
        countryCode,
      }),
    ).toEqual({
      valid: true,
      value: { taxId: " Ab-09 /xy ", identifierType: "passport", identifierCountryCode: "FR" },
    });
  });

  it("does not infer a foreign type or issuer from the value or address", () => {
    expect(
      packs.recipientIdentifierResult?.({ taxId: "FR12345678901", countryCode: "FR" }),
    ).toEqual({ valid: false, field: "taxId" });
    expect(
      packs.recipientIdentifierResult?.({
        taxId: "12345678Z",
        identifierType: "passport",
        countryCode: "FR",
      }),
    ).toEqual({ valid: false, field: "identifierCountryCode" });
  });

  it("canonicalizes explicit Spanish identity without preserving duplicate metadata", () => {
    expect(
      packs.recipientIdentifierResult?.({
        taxId: "12345678z",
        identifierType: "tax-number",
        identifierCountryCode: "ES",
      }),
    ).toEqual({ valid: true, value: { taxId: "12345678Z" } });
  });

  it("refuses a missing identifier even with a complete foreign address", () => {
    expect(
      packs.recipientIdentifierResult?.({
        taxId: "  ",
        countryCode: "FR",
        address: "2 Main Street, Paris",
      }),
    ).toEqual({ valid: false, field: "taxId" });
  });
});
