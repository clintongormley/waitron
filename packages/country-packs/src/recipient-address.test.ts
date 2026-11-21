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
  it.each([
    ["locality", "Centro, Madrid"],
    ["province", "Balears, Illes"],
  ] as const)("refuses a Spanish %s comma the server's check refuses", (field, value) => {
    expect(addresses).toHaveProperty("recipientAddressErrors", expect.any(Function));
    const isComplete = addresses.getCountryPack("ES")!.postalAddress!.isComplete;
    expect(isComplete(addresses.composeRecipientAddress(spanish))).toBe(true);
    const draft = { ...spanish, [field]: value };
    expect(addresses.recipientAddressErrors(draft)).toEqual({ [field]: "invalid" });
    expect(isComplete(addresses.composeRecipientAddress(draft))).toBe(false);
    expect(addresses.recipientAddressErrors({ ...draft, countryCode: "FR" })).toEqual({});
  });
  it.each([
    ["locality", "Centro, 28013 Madrid"],
    ["province", "Madrid, 28013 Madrid, Madrid"],
  ] as const)("accepts a Spanish %s comma the server's check accepts", (field, value) => {
    expect(addresses).toHaveProperty("recipientAddressErrors", expect.any(Function));
    const isComplete = addresses.getCountryPack("ES")!.postalAddress!.isComplete;
    const draft = { ...spanish, [field]: value };
    expect(addresses.recipientAddressErrors(draft)).toEqual({});
    expect(isComplete(addresses.composeRecipientAddress(draft))).toBe(true);
  });
  it("refuses both a Spanish locality and province holding commas", () => {
    expect(addresses).toHaveProperty("recipientAddressErrors", expect.any(Function));
    const draft = { ...spanish, locality: "Centro, Madrid", province: "Balears, Illes" };
    expect(addresses.recipientAddressErrors(draft)).toEqual({
      locality: "invalid",
      province: "invalid",
    });
    expect(
      addresses
        .getCountryPack("ES")!
        .postalAddress!.isComplete(addresses.composeRecipientAddress(draft)),
    ).toBe(false);
  });
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

describe("recipientAddressFields", () => {
  it.each([
    [
      "ES",
      "Calle Mayor 1, 2º B, 28013 Madrid, Madrid",
      {
        streetAddress: "Calle Mayor 1, 2º B",
        postalCode: "28013",
        locality: "Madrid",
        province: "Madrid",
      },
    ],
    [
      "ES",
      "Calle Mayor 1, 08001 Sant Adria de Besos, Barcelona",
      {
        streetAddress: "Calle Mayor 1",
        postalCode: "08001",
        locality: "Sant Adria de Besos",
        province: "Barcelona",
      },
    ],
    [
      "FR",
      "2 Main Street, Paris",
      {
        streetAddress: "2 Main Street",
        postalCode: "",
        locality: "Paris",
        province: "",
      },
    ],
    [
      "FR",
      "2 Main Street, 75001 Paris",
      {
        streetAddress: "2 Main Street",
        postalCode: "75001",
        locality: "Paris",
        province: "",
      },
    ],
    [
      "US",
      "1 Broadway, New York, NY",
      {
        streetAddress: "1 Broadway",
        postalCode: "",
        locality: "New York",
        province: "NY",
      },
    ],
    [
      "IT",
      "Via Roma 3, 00100 Roma, RM",
      {
        streetAddress: "Via Roma 3",
        postalCode: "00100",
        locality: "Roma",
        province: "RM",
      },
    ],
    [
      "GB",
      "10 Downing Street, SW1A 2AA London",
      {
        streetAddress: "10 Downing Street",
        postalCode: "SW1A",
        locality: "2AA London",
        province: "",
      },
    ],
    [
      "ES",
      "Calle Mayor 1",
      {
        streetAddress: "Calle Mayor 1",
        postalCode: "",
        locality: "",
        province: "",
      },
    ],
    [
      "ES",
      "Calle Mayor 1, Madrid, Madrid",
      {
        streetAddress: "Calle Mayor 1",
        postalCode: "",
        locality: "Madrid",
        province: "Madrid",
      },
    ],
    ["FR", "", { streetAddress: "", postalCode: "", locality: "", province: "" }],
    // Composed from street "2 Rue du Port, Bâtiment B" and locality "Paris".
    [
      "FR",
      "2 Rue du Port, Bâtiment B, Paris",
      {
        streetAddress: "2 Rue du Port",
        postalCode: "",
        locality: "Bâtiment B",
        province: "Paris",
      },
    ],
    [
      "GB",
      "10 Downing Street, SW1A   2AA London",
      {
        streetAddress: "10 Downing Street",
        postalCode: "",
        locality: "SW1A   2AA London",
        province: "",
      },
    ],
    [
      "ES",
      "Calle Mayor 1 , 2º B, 28013 Madrid",
      {
        streetAddress: "Calle Mayor 1 , 2º B, 28013 Madrid",
        postalCode: "",
        locality: "",
        province: "",
      },
    ],
  ])(
    "splits a %s address %j into fields that compose back to the same text",
    (countryCode, address, fields) => {
      const split = addresses.recipientAddressFields(address, countryCode);
      expect(split).toEqual(fields);
      expect(addresses.composeRecipientAddress({ ...split, countryCode })).toBe(address);
    },
  );

  it.each(["Calle Mayor 1 , 2º B", "Calle Mayor 1,  2º B"])(
    "splits a valid Spanish draft whose street is %j back into its typed fields",
    (streetAddress) => {
      const draft = { ...spanish, streetAddress };
      expect(addresses.recipientAddressErrors(draft)).toEqual({});
      const line = addresses.composeRecipientAddress(draft);
      expect(line).toBe(`${streetAddress}, 28013 Madrid, Madrid`);
      expect(addresses.recipientAddressFields(line, "ES")).toEqual({
        streetAddress,
        postalCode: "28013",
        locality: "Madrid",
        province: "Madrid",
      });
    },
  );

  it.each([
    " Calle Mayor 1, Madrid ",
    "a, , b, c",
    ", a, b",
    "a,  b, c",
    "a, b , c",
    "a, 1\t b",
    "a, 1 \tb",
  ])("gives back %j, trimmed, when composed", (address) => {
    const split = addresses.recipientAddressFields(address, "ES");
    expect(addresses.composeRecipientAddress({ ...split, countryCode: "ES" })).toBe(address.trim());
  });

  it("composes a Spanish, French, British and American draft back to the same text, keeping a Spanish street's commas in the street", () => {
    for (const draft of [
      { ...spanish, streetAddress: "Av. de la Paz, 4, portal 2" },
      spanish,
      foreign,
      { ...foreign, countryCode: "GB", postalCode: "SW1A 2AA", locality: "London" },
      { ...foreign, countryCode: "US", locality: "New York", province: "NY" },
    ]) {
      const composed = addresses.composeRecipientAddress(draft);
      const split = addresses.recipientAddressFields(composed, draft.countryCode);
      expect(addresses.composeRecipientAddress({ ...split, countryCode: draft.countryCode })).toBe(
        composed,
      );
    }
    const spanishSplit = addresses.recipientAddressFields(
      addresses.composeRecipientAddress({
        ...spanish,
        streetAddress: "Av. de la Paz, 4, portal 2",
      }),
      "ES",
    );
    expect(spanishSplit).toEqual({
      streetAddress: "Av. de la Paz, 4, portal 2",
      postalCode: "28013",
      locality: "Madrid",
      province: "Madrid",
    });
  });
});

describe("recipientAddressFields reading a Spanish province name", () => {
  const spain = addresses.getCountryPack("ES")!;
  const area = (code: string) => spain.administrativeAreas.find((each) => each.code === code)!;
  // Names spelt with Spanish letters are read from the pack: general code is English only.
  const corunaCity = area("15").aliases![0]!;

  it.each([
    ["Carrer Major 1", "07001", "Palma", "07"],
    ["Calle Real 1", "15001", corunaCity, "15"],
    ["Calle Portales 1", "26001", "Calahorra", "26"],
    ["Calle Triana 1", "35002", "Las Palmas de Gran Canaria", "35"],
  ])("reads the comma province after %j", (streetAddress, postalCode, locality, code) => {
    const province = area(code).name;
    expect(province).toContain(", ");
    const address = `${streetAddress}, ${postalCode} ${locality}, ${province}`;
    const split = addresses.recipientAddressFields(address, "ES");
    expect(split).toEqual({ streetAddress, postalCode, locality, province });
    expect(addresses.composeRecipientAddress({ ...split, countryCode: "ES" })).toBe(address);
  });

  it.each([
    ["28013", "Madrid", "28"],
    ["15001", corunaCity, "15"],
  ])("reads %j, with no street, as postcode, city and province", (postalCode, locality, code) => {
    const province = area(code).name;
    const address = `${postalCode} ${locality}, ${province}`;
    const split = addresses.recipientAddressFields(address, "ES");
    expect(split).toEqual({ streetAddress: "", postalCode, locality, province });
    expect(addresses.composeRecipientAddress({ ...split, countryCode: "ES" })).toBe(address);
  });

  it("splits an address of a country it does not know as before", () => {
    expect(addresses.recipientAddressFields("1 Broadway, New York, NY", "XX")).toEqual({
      streetAddress: "1 Broadway",
      postalCode: "",
      locality: "New York",
      province: "NY",
    });
  });
});
