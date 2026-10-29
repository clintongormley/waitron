import { describe, expect, it } from "vitest";
import * as country from "./index.js";

const policy = {
  taxCountryCode: "AA",
  taxIdentifier: {
    validate(value: string) {
      return value.trim().toUpperCase() === "TAX"
        ? { valid: true as const, normalized: "TAX", kind: "tax" }
        : { valid: false as const, reason: "format" as const };
    },
  },
  documentCountryCodes: ["AA", "BB"],
  documentTypesFor: () => ["passport" as const],
  documentMaxLength: 20,
};

describe("recipient identifier validation", () => {
  it("uses the supplied domestic checker and strips unrelated postal fields", () => {
    expect(
      country.validateRecipientIdentifier?.({ taxId: " tax ", countryCode: "BB" }, policy),
    ).toEqual({ valid: true, value: { taxId: "TAX" } });
  });

  it("canonicalizes an explicit domestic type and issuing country", () => {
    expect(
      country.validateRecipientIdentifier?.(
        { taxId: " tax ", identifierType: "tax-number", identifierCountryCode: " aa " },
        policy,
      ),
    ).toEqual({ valid: true, value: { taxId: "TAX" } });
  });

  it("preserves foreign text and normalizes only its issuing country", () => {
    expect(
      country.validateRecipientIdentifier?.(
        {
          taxId: " Ab-09 /xy ",
          identifierType: "passport",
          identifierCountryCode: " bb ",
          countryCode: "AA",
        },
        policy,
      ),
    ).toEqual({
      valid: true,
      value: {
        taxId: " Ab-09 /xy ",
        identifierType: "passport",
        identifierCountryCode: "BB",
      },
    });
  });

  it.each([
    [null, "taxId"],
    [[], "taxId"],
    [Object.assign([], { taxId: "TAX" }), "taxId"],
    ["TAX", "taxId"],
    [{}, "taxId"],
    [{ taxId: 12 }, "taxId"],
    [{ taxId: "" }, "taxId"],
    [{ taxId: " \t\n" }, "taxId"],
    [{ taxId: "wrong", countryCode: "BB" }, "taxId"],
    [{ taxId: "wrong", identifierType: "tax-number", identifierCountryCode: "AA" }, "taxId"],
    [{ taxId: "TAX", identifierCountryCode: "BB" }, "identifierType"],
    [{ taxId: "TAX", identifierType: "passport" }, "identifierCountryCode"],
    [{ taxId: "TAX", identifierType: null, identifierCountryCode: "BB" }, "identifierType"],
    [{ taxId: "TAX", identifierType: undefined }, "identifierType"],
    [{ taxId: "TAX", identifierType: "unknown", identifierCountryCode: "BB" }, "identifierType"],
    [
      { taxId: "TAX", identifierType: "passport", identifierCountryCode: null },
      "identifierCountryCode",
    ],
    [
      { taxId: "TAX", identifierType: "passport", identifierCountryCode: undefined },
      "identifierCountryCode",
    ],
    [
      { taxId: "TAX", identifierType: "passport", identifierCountryCode: ["BB"] },
      "identifierCountryCode",
    ],
    [
      { taxId: "TAX", identifierType: "passport", identifierCountryCode: "ZZ" },
      "identifierCountryCode",
    ],
    [{ taxId: "TAX", identifierType: "tax-number", identifierCountryCode: "BB" }, "identifierType"],
    [{ taxId: "TAX", identifierType: "vat-number", identifierCountryCode: "BB" }, "identifierType"],
  ])("refuses malformed identity %j at %s", (input, field) => {
    expect(country.validateRecipientIdentifier?.(input, policy)).toEqual({ valid: false, field });
  });

  it("counts Unicode code points at the configured document limit", () => {
    const input = { identifierType: "passport", identifierCountryCode: "BB" };
    expect(
      country.validateRecipientIdentifier?.({ ...input, taxId: "😀".repeat(20) }, policy),
    ).toEqual({ valid: true, value: { ...input, taxId: "😀".repeat(20) } });
    expect(
      country.validateRecipientIdentifier?.({ ...input, taxId: "😀".repeat(21) }, policy),
    ).toEqual({ valid: false, field: "taxId" });
  });

  it.each([
    "\u0000",
    "\u0008",
    "\u000b",
    "\u000c",
    "\u000e",
    "\u001b",
    "\ud800",
    "\udfff",
    "\ufffe",
    "\uffff",
  ])("refuses a document containing XML-disallowed character %j", (character) => {
    expect(
      country.validateRecipientIdentifier?.(
        { taxId: `ID${character}9`, identifierType: "passport", identifierCountryCode: "BB" },
        policy,
      ),
    ).toEqual({ valid: false, field: "taxId" });
  });

  it("preserves XML-permitted whitespace inside a nonblank document", () => {
    const value = { taxId: "ID\t9\nA\rB", identifierType: "passport", identifierCountryCode: "BB" };
    expect(country.validateRecipientIdentifier?.(value, policy)).toEqual({ valid: true, value });
  });
});
