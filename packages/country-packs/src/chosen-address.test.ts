import { describe, expect, it } from "vitest";
import { areaOfChosenAddress, getCountryPack } from "./index.js";

const spain = getCountryPack("ES")!;
const madrid = {
  lines: ["Calle Mayor 1"],
  locality: "Madrid",
  administrativeAreaCode: "28",
  postalCode: "28013",
  countryCode: "ES",
};

describe("an address chosen from the search", () => {
  it("lies in the area its area code names, ahead of its postcode's", () => {
    expect(areaOfChosenAddress(spain, { ...madrid, postalCode: "08001" })?.name).toBe("Madrid");
  });

  it("lies in its postcode's area when it names no area, or one the country does not know", () => {
    const noCode = {
      lines: madrid.lines,
      locality: madrid.locality,
      postalCode: "08001",
      countryCode: "ES",
    };
    expect(areaOfChosenAddress(spain, noCode)?.name).toBe("Barcelona");
    expect(
      areaOfChosenAddress(spain, { ...madrid, administrativeAreaCode: "ZZ", postalCode: "08001" })
        ?.name,
    ).toBe("Barcelona");
  });

  it("lies in no area when neither its area code nor a valid postcode names one", () => {
    expect(
      areaOfChosenAddress(spain, { ...madrid, administrativeAreaCode: "ZZ", postalCode: "x" }),
    ).toBeUndefined();
  });
});
