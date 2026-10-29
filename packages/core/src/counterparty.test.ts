import { describe, expect, it } from "vitest";
import { NoneBackend } from "@waitron/fiscal-none";
import { checkedCounterparty } from "./counterparty.js";

const backend = new NoneBackend();
const base = { taxId: " b 1234567 4 ", legalName: "Customer", countryCode: "FR" };

describe("recipient identity independent of postal country", () => {
  it("normalizes Spanish identity at a foreign address", () => {
    expect(checkedCounterparty(backend, base)).toEqual({ ...base, taxId: "B12345674" });
  });
  it("canonicalizes explicit domestic metadata to absent fields", () => {
    expect(
      checkedCounterparty(backend, {
        ...base,
        identifierType: "tax-number",
        identifierCountryCode: "ES",
      }),
    ).toEqual({ ...base, taxId: "B12345674" });
  });
  it.each(["ES", "FR"])("keeps foreign document text at postal %s", (countryCode) => {
    const value = {
      ...base,
      countryCode,
      taxId: " Ab-09 /xy ",
      identifierType: "passport" as const,
      identifierCountryCode: "FR",
    };
    expect(checkedCounterparty(backend, value)).toEqual(value);
  });
  it.each([
    { taxId: "", field: "taxId" },
    { taxId: "B12345678", field: "taxId" },
    { taxId: "anything", field: "taxId" },
    { identifierType: "passport", field: "identifierCountryCode" },
    { identifierCountryCode: "FR", field: "identifierType" },
    { identifierType: "passport", identifierCountryCode: "ZZ", field: "identifierCountryCode" },
  ])("refuses invalid identity $field before recording", ({ field, ...patch }) => {
    expect(() =>
      checkedCounterparty(backend, { ...base, ...patch } as Parameters<
        typeof checkedCounterparty
      >[1]),
    ).toThrowError(expect.objectContaining({ code: "counterparty.invalid", params: { field } }));
  });
});
