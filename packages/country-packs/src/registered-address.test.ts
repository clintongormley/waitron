import { describe, expect, it } from "vitest";
import * as countryPacks from "./index.js";
import {
  canonicalRegisteredParts,
  getCountryPack,
  joinRegisteredAddress,
  provinceOfPostalCode,
  registeredAddressErrors,
  registeredAddressParts,
  registeredLineErrors,
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

describe("canonicalRegisteredParts", () => {
  it("writes the postcode as the pack's check does and the province as the pack names it", () => {
    expect(
      canonicalRegisteredParts({ ...madrid, postalCode: " 28013 ", province: "madrid" }, spain),
    ).toEqual({ ...madrid, postalCode: "28013" });
    expect(canonicalRegisteredParts({ ...madrid, province: "28" }, spain).province).toBe("Madrid");
    expect(
      canonicalRegisteredParts(
        { ...madrid, postalCode: "15001", province: coruna.aliases![0]! },
        spain,
      ).province,
    ).toBe(coruna.name);
  });

  it("takes the postcode the pack's check gives back, not the one typed", () => {
    const pack = {
      ...spain,
      postalCode: {
        validate: (value: string) => ({
          valid: true as const,
          normalized: value.trim().toUpperCase(),
          kind: "postal-code" as const,
        }),
      },
    };
    expect(canonicalRegisteredParts({ ...madrid, postalCode: "ab1" }, pack).postalCode).toBe("AB1");
  });

  it("keeps a postcode the pack refuses and a province it does not know as given", () => {
    const parts = { ...madrid, postalCode: "99999", province: "Atlantis" };
    expect(canonicalRegisteredParts(parts, spain)).toEqual(parts);
    expect(canonicalRegisteredParts({ ...madrid, province: " " }, spain).province).toBe(" ");
  });

  it("changes nothing without a pack", () => {
    const parts = { ...madrid, postalCode: " 28013 ", province: "madrid" };
    expect(canonicalRegisteredParts(parts, undefined)).toEqual(parts);
  });
});

describe("joinRegisteredAddress with a pack", () => {
  it.each(["07", "15", "26", "35"])(
    "joins comma province %s, typed in another case, into a line that reads back",
    (code) => {
      const parts = {
        street: "Calle Real 1",
        line2: "",
        postalCode: `${code}001`,
        city: "Somewhere",
        province: area(code).name.toLocaleUpperCase(),
      };
      const line = joinRegisteredAddress(parts, spain);
      expect(line).toBe(`Calle Real 1, ${code}001 Somewhere, ${area(code).name}`);
      expect(registeredLineErrors(line, spain)).toEqual({});
    },
  );

  it("joins as without a pack when the pack is left out", () => {
    expect(joinRegisteredAddress({ ...madrid, province: "madrid" })).toBe(
      "Calle Mayor 1, 28013 Madrid, madrid",
    );
  });
});

describe("registeredLineErrors", () => {
  it("finds nothing wrong with a line that reads back into good parts", () => {
    expect(registeredLineErrors("Calle Mayor 1, 28013 Madrid, Madrid", spain)).toEqual({});
    expect(registeredLineErrors("Calle Mayor 1, 28013 Madrid", spain)).toEqual({});
  });

  it.each(["2º 1ª", "Mayor 1, Madrid", ""])("finds no postcode or city in %j", (line) => {
    expect(registeredLineErrors(line, spain)).toEqual({
      ...(line === "" ? { street: "required" } : {}),
      postalCode: "required",
      city: "required",
    });
  });

  it("cannot read back a city holding a comma", () => {
    const line = joinRegisteredAddress({ ...madrid, city: "Madrid, Centro" }, spain);
    expect(registeredLineErrors(line, spain)).toEqual({
      postalCode: "required",
      city: "required",
    });
  });

  it("finds a postcode outside the province the line names", () => {
    expect(registeredLineErrors("Calle Mayor 1, 28013 Madrid, Barcelona", spain)).toEqual({
      province: "mismatch",
    });
  });

  it("checks nothing where the pack has no postcode rule, or there is no pack", () => {
    expect(registeredLineErrors("2º 1ª", { ...spain, postalCode: undefined })).toEqual({});
    expect(registeredLineErrors("2º 1ª", undefined)).toEqual({});
  });
});

describe("provinceOfPostalCode", () => {
  it("names the area a valid postcode lies in", () => {
    expect(provinceOfPostalCode(spain, "28013")).toBe(area("28"));
    expect(provinceOfPostalCode(spain, " 07001 ")).toBe(area("07"));
  });

  it("names none for a postcode the pack refuses, a pack with no postcode rule, or no pack", () => {
    expect(provinceOfPostalCode(spain, "99999")).toBeUndefined();
    expect(provinceOfPostalCode({ ...spain, postalCode: undefined }, "28013")).toBeUndefined();
    expect(provinceOfPostalCode(undefined, "28013")).toBeUndefined();
  });
});

describe("the package's exports", () => {
  it("keeps the line-reading helpers inside the package", () => {
    expect(Object.keys(countryPacks)).not.toContain("firstWordAndRest");
    expect(Object.keys(countryPacks)).not.toContain("trailingProvince");
  });
});
