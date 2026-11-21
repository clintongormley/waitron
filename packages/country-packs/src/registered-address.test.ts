import { describe, expect, it } from "vitest";
import {
  getCountryPack,
  joinRegisteredAddress,
  registeredAddressErrors,
  registeredAddressParts,
} from "./index.js";

const spain = getCountryPack("ES")!;
const area = (code: string) => spain.administrativeAreas.find((each) => each.code === code)!;
// Names spelt with Spanish letters are read from the pack: general code is English only.
const coruna = area("15");
const madrid = {
  street: "Calle Mayor 1",
  line2: "",
  postalCode: "28013",
  city: "Madrid",
  province: "Madrid",
};

describe("joinRegisteredAddress", () => {
  it("writes street, line 2, postcode city, province", () => {
    expect(joinRegisteredAddress({ ...madrid, line2: "3º B" })).toBe(
      "Calle Mayor 1, 3º B, 28013 Madrid, Madrid",
    );
  });

  it("leaves out blank parts and trims the rest", () => {
    expect(
      joinRegisteredAddress({
        street: " Calle Mayor 1 ",
        line2: "  ",
        postalCode: " ",
        city: " Somewhere ",
        province: "",
      }),
    ).toBe("Calle Mayor 1, Somewhere");
    expect(
      joinRegisteredAddress({ street: "", line2: "", postalCode: "", city: "", province: "" }),
    ).toBe("");
  });
});

describe("registeredAddressParts", () => {
  it.each([
    ["Carrer Major 1", "07001", "Palma", "07"],
    ["Calle Real 1", "15001", coruna.aliases![0]!, "15"],
    ["Calle Portales 1", "26001", "Calahorra", "26"],
    ["Calle Triana 1", "35002", "Las Palmas de Gran Canaria", "35"],
  ])("reads the comma province after %j", (street, postalCode, city, code) => {
    const province = area(code).name;
    expect(province).toContain(", ");
    const line = `${street}, ${postalCode} ${city}, ${province}`;
    const parts = registeredAddressParts(line, spain);
    expect(parts).toEqual({ street, line2: "", postalCode, city, province });
    expect(joinRegisteredAddress(parts)).toBe(line);
  });

  it("keeps a comma in the street and an empty line 2, with a postcode starting with 0", () => {
    const line = "Carrer de Mallorca, 123, 08010 Barcelona, Barcelona";
    const parts = registeredAddressParts(line, spain);
    expect(parts).toEqual({
      street: "Carrer de Mallorca, 123",
      line2: "",
      postalCode: "08010",
      city: "Barcelona",
      province: "Barcelona",
    });
    expect(joinRegisteredAddress(parts)).toBe(line);
  });

  it("reads a province that names the city", () => {
    expect(registeredAddressParts("2º 1ª, 08010 Barcelona, Barcelona", spain)).toEqual({
      street: "2º 1ª",
      line2: "",
      postalCode: "08010",
      city: "Barcelona",
      province: "Barcelona",
    });
  });

  it("trims leading and trailing spaces, joining back trimmed", () => {
    const parts = registeredAddressParts("  Calle Mayor 1, 28013 Madrid, Madrid  ", spain);
    expect(parts).toEqual(madrid);
    expect(joinRegisteredAddress(parts)).toBe("Calle Mayor 1, 28013 Madrid, Madrid");
  });

  it("takes no province from a line that ends at the city, and fills it from the postcode", () => {
    expect(registeredAddressParts("Calle X 1, 28013 Madrid", spain)).toEqual({
      street: "Calle X 1",
      line2: "",
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
    });
  });

  it("puts a line that ends in a province name but holds no postcode whole into the street", () => {
    expect(registeredAddressParts("Calle Mayor 1, Centro, Madrid", spain)).toEqual({
      street: "Calle Mayor 1, Centro, Madrid",
      line2: "",
      postalCode: "",
      city: "",
      province: "",
    });
  });

  it.each([
    "2º 1ª",
    "",
    "Calle Mayor 1, 99999 Madrid",
    "Calle Mayor 1,  28013 Madrid",
    "Calle Mayor 1 , 28013 Madrid",
  ])("puts %j whole into the street when it holds no postcode or does not join back", (line) => {
    expect(registeredAddressParts(line, spain)).toEqual({
      street: line.trim(),
      line2: "",
      postalCode: "",
      city: "",
      province: "",
    });
  });

  it("passes over a longer area name the line ends with when no postcode and city come before it", () => {
    const pack = {
      ...spain,
      administrativeAreas: [
        { code: "A", name: "07001 Palma, Illes", postalPrefixes: [] },
        { code: "B", name: "Illes", postalPrefixes: ["07"] },
      ],
    };
    expect(registeredAddressParts("Carrer Major 1, 07001 Palma, Illes", pack)).toEqual({
      street: "Carrer Major 1",
      line2: "",
      postalCode: "07001",
      city: "Palma",
      province: "Illes",
    });
  });

  it("leaves the province empty where no area claims the postcode", () => {
    expect(
      registeredAddressParts("Calle Mayor 1, 28013 Madrid", { ...spain, administrativeAreas: [] })
        .province,
    ).toBe("");
  });

  it("puts the whole line in the street for a pack with no postcode check", () => {
    const pack = { ...spain, postalCode: undefined };
    expect(registeredAddressParts("Calle Mayor 1, 28013 Madrid", pack).street).toBe(
      "Calle Mayor 1, 28013 Madrid",
    );
  });
});

describe("registeredAddressErrors", () => {
  it("accepts a complete address, with or without a province", () => {
    expect(registeredAddressErrors(madrid, spain)).toEqual({});
    expect(registeredAddressErrors({ ...madrid, province: " " }, spain)).toEqual({});
    expect(registeredAddressErrors({ ...madrid, province: "madrid" }, spain)).toEqual({});
  });

  it("requires street, postcode and city, and checks no province without a postcode", () => {
    expect(
      registeredAddressErrors(
        { street: " ", line2: "", postalCode: "", city: "", province: "Barcelona" },
        spain,
      ),
    ).toEqual({ street: "required", postalCode: "required", city: "required" });
  });

  it.each(["99999", "1234", "A1 B2"])("refuses the postcode %j", (postalCode) => {
    expect(registeredAddressErrors({ ...madrid, postalCode }, spain)).toEqual({
      postalCode: "invalid",
    });
  });

  it("refuses a province the postcode does not lie in, or that the country does not know", () => {
    expect(registeredAddressErrors({ ...madrid, province: "Barcelona" }, spain)).toEqual({
      province: "mismatch",
    });
    expect(registeredAddressErrors({ ...madrid, province: "Atlantis" }, spain)).toEqual({
      province: "mismatch",
    });
  });

  it("accepts a province by its other name", () => {
    expect(
      registeredAddressErrors(
        { ...madrid, postalCode: "15001", city: "Ferrol", province: coruna.aliases![0]! },
        spain,
      ),
    ).toEqual({});
  });

  it("checks no province where the postcode names no area", () => {
    const gb = getCountryPack("GB")!;
    expect(
      registeredAddressErrors(
        { ...madrid, postalCode: "SW1A 2AA", city: "London", province: "Westminster" },
        gb,
      ),
    ).toEqual({});
  });
});
