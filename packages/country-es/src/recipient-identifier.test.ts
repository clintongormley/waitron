import { describe, expect, it } from "vitest";
import * as country from "@waitron/country";
import * as spain from "./index.js";

const validateRecipientIdentifier = country.validateRecipientIdentifier;

describe("Spain's accepted recipient identifiers", () => {
  it("validates a Spanish number independently of the recipient's postal country", () => {
    expect(
      validateRecipientIdentifier?.(
        { taxId: " b 1234567 4 ", countryCode: "FR" },
        spain.SPAIN_RECIPIENT_IDENTIFIER_POLICY,
      ),
    ).toEqual({ valid: true, value: { taxId: "B12345674" } });
    expect(
      validateRecipientIdentifier?.(
        { taxId: "B12345670", countryCode: "FR" },
        spain.SPAIN_RECIPIENT_IDENTIFIER_POLICY,
      ),
    ).toEqual({ valid: false, field: "taxId" });
  });

  it.each([
    "vat-number",
    "passport",
    "residence-country-id",
    "residence-certificate",
    "other-document",
  ])("accepts explicit %s without Spanish normalization", (identifierType) => {
    const value = { taxId: " Ab-09 /xy ", identifierType, identifierCountryCode: "FR" };
    expect(validateRecipientIdentifier?.(value, spain.SPAIN_RECIPIENT_IDENTIFIER_POLICY)).toEqual({
      valid: true,
      value,
    });
  });

  it("accepts an ES-issued passport without applying NIF checks", () => {
    const value = { taxId: "Passport 9", identifierType: "passport", identifierCountryCode: "ES" };
    expect(validateRecipientIdentifier?.(value, spain.SPAIN_RECIPIENT_IDENTIFIER_POLICY)).toEqual({
      valid: true,
      value,
    });
  });

  it.each(["vat-number", "residence-country-id", "residence-certificate", "other-document", "07"])(
    "refuses the unsupported ES alternative %s",
    (identifierType) => {
      expect(
        validateRecipientIdentifier?.(
          { taxId: "12345678Z", identifierType, identifierCountryCode: "ES" },
          spain.SPAIN_RECIPIENT_IDENTIFIER_POLICY,
        ),
      ).toEqual({ valid: false, field: "identifierType" });
    },
  );

  it("keeps AEAT's special XU issuing code independent of postal choices", () => {
    const value = { taxId: "Passport 9", identifierType: "passport", identifierCountryCode: "XU" };
    expect(validateRecipientIdentifier?.(value, spain.SPAIN_RECIPIENT_IDENTIFIER_POLICY)).toEqual({
      valid: true,
      value,
    });
  });

  it.each(["ZZ", "AX", "BL", "EH", "SJ"])(
    "refuses issuer %s absent from the authority's list",
    (identifierCountryCode) => {
      expect(
        validateRecipientIdentifier?.(
          { taxId: "Passport 9", identifierType: "passport", identifierCountryCode },
          spain.SPAIN_RECIPIENT_IDENTIFIER_POLICY,
        ),
      ).toEqual({ valid: false, field: "identifierCountryCode" });
    },
  );

  it("accepts twenty foreign code points but refuses twenty-one", () => {
    const identity = { identifierType: "passport", identifierCountryCode: "FR" };
    expect(
      validateRecipientIdentifier?.(
        { ...identity, taxId: "x".repeat(20) },
        spain.SPAIN_RECIPIENT_IDENTIFIER_POLICY,
      ),
    ).toEqual({ valid: true, value: { ...identity, taxId: "x".repeat(20) } });
    expect(
      validateRecipientIdentifier?.(
        { ...identity, taxId: "x".repeat(21) },
        spain.SPAIN_RECIPIENT_IDENTIFIER_POLICY,
      ),
    ).toEqual({ valid: false, field: "taxId" });
  });
});

it("exports complete localized identity label resources", async () => {
  const resources = await import("./index.js");
  expect(Object.keys(resources.SPAIN_RECIPIENT_IDENTIFIER_LABELS ?? {})).toEqual([
    "en",
    "es",
    "ca",
    "gl",
    "eu",
  ]);
  for (const row of Object.values(resources.SPAIN_RECIPIENT_IDENTIFIER_LABELS ?? {}))
    expect(Object.keys(row).sort()).toEqual([
      "other-document",
      "passport",
      "residence-certificate",
      "residence-country-id",
      "tax-number",
      "vat-number",
    ]);
});
