import { describe, expect, it } from "vitest";
import * as addresses from "./index.js";

const foreign = {
  countryCode: "FR",
  streetAddress: "2 Main Street",
  postalCode: "",
  locality: "Paris",
  province: "",
};
const spanish = {
  ...foreign,
  countryCode: "ES",
  postalCode: "28013",
  locality: "Madrid",
  province: "Madrid",
};

describe("recipient postal address independent of identity", () => {
  it.each(["FR", "IE", "HK"])("allows no postcode or province for %s", (countryCode) => {
    expect(addresses).toHaveProperty("recipientAddressErrors", expect.any(Function));
    const draft = { ...foreign, countryCode };
    expect(addresses.recipientAddressErrors(draft)).toEqual({});
    expect(addresses.composeRecipientAddress(draft)).toBe("2 Main Street, Paris");
    expect(
      addresses.recipientAddressErrors({ ...draft, postalCode: "Any local postcode" }),
    ).toEqual({});
  });
  it.each(["streetAddress", "locality"] as const)("requires foreign %s", (field) => {
    expect(addresses).toHaveProperty("recipientAddressErrors", expect.any(Function));
    expect(addresses.recipientAddressErrors({ ...foreign, [field]: "  " })).toEqual({
      [field]: "required",
    });
  });
  it.each([
    ["", "required"],
    ["XX", "invalid"],
    ["EU", "invalid"],
  ])("rejects country %s", (countryCode, error) => {
    expect(addresses).toHaveProperty("recipientAddressErrors", expect.any(Function));
    expect(addresses.recipientAddressErrors({ ...foreign, countryCode })).toEqual({
      countryCode: error,
    });
  });
  it("applies Spanish field rules only when ES is selected, preserving the draft", () => {
    expect(addresses).toHaveProperty("recipientAddressErrors", expect.any(Function));
    const draft = { ...foreign, countryCode: " es " };
    const before = { ...draft };
    expect(addresses.recipientAddressErrors(draft)).toEqual({
      postalCode: "required",
      province: "required",
    });
    expect(addresses.recipientAddressErrors({ ...draft, countryCode: "FR" })).toEqual({});
    expect(draft).toEqual(before);
    expect(addresses.recipientAddressErrors(spanish)).toEqual({});
    expect(addresses.composeRecipientAddress(spanish)).toBe("2 Main Street, 28013 Madrid, Madrid");
  });
  it.each(["00000", "99999", "1234", "A1 B2"])(
    "refuses Spanish postcode %s without applying it abroad",
    (postalCode) => {
      expect(addresses).toHaveProperty("recipientAddressErrors", expect.any(Function));
      expect(addresses.recipientAddressErrors({ ...spanish, postalCode })).toEqual({
        postalCode: "invalid",
      });
      expect(addresses.recipientAddressErrors({ ...foreign, postalCode })).toEqual({});
    },
  );
  it("trims fields without erasing street commas or inserting an empty province or country suffix", () => {
    expect(addresses).toHaveProperty("composeRecipientAddress", expect.any(Function));
    const draft = {
      ...foreign,
      streetAddress: " 2 Main Street, Apartment 3 ",
      postalCode: " 75001 ",
      locality: " Paris ",
      province: " ",
    };
    const before = { ...draft };
    expect(addresses.composeRecipientAddress(draft)).toBe(
      "2 Main Street, Apartment 3, 75001 Paris",
    );
    expect(addresses.composeRecipientAddress({ ...draft, province: "North district" })).toBe(
      "2 Main Street, Apartment 3, 75001 Paris, North district",
    );
    expect(draft).toEqual(before);
  });
});
