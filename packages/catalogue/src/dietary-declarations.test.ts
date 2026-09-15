import { describe, expect, it } from "vitest";
import {
  expandDietaryDeclarations,
  validateDietaryDeclarations,
  validateDietarySuitability,
} from "./dietary-declarations.js";

describe("direct dietary declarations", () => {
  it("infers vegetarian/no meat/no fish from vegan without inferring halal or kosher", () => {
    expect(expandDietaryDeclarations(["vegan"])).toEqual([
      "vegan",
      "vegetarian",
      "no_meat",
      "no_fish",
    ]);
    expect(expandDietaryDeclarations(["vegetarian", "halal"])).toEqual([
      "vegetarian",
      "halal",
      "no_meat",
      "no_fish",
    ]);
    expect(expandDietaryDeclarations([])).toEqual([]);
    expect(expandDietaryDeclarations(["kosher"])).toEqual(["kosher"]);
  });
  it.each([null, {}, ["meat"], ["vegan", "vegan"], [false]])(
    "rejects invalid declarations %j",
    (input) => {
      expect(() => validateDietaryDeclarations(input)).toThrow(
        expect.objectContaining({ code: "diet.declaration_invalid" }),
      );
    },
  );
});

describe("positive dietary suitability", () => {
  it("accepts the four positive suitability labels and rejects the retired ones", () => {
    expect(validateDietarySuitability(["vegan", "halal"])).toEqual(["vegan", "halal"]);
    expect(() => validateDietarySuitability(["no_meat"])).toThrow(
      expect.objectContaining({ code: "diet.declaration_invalid" }),
    );
  });
  it.each([null, {}, ["no_fish"], ["vegan", "vegan"], [false], ["meat"]])(
    "rejects invalid suitability %j",
    (input) => {
      expect(() => validateDietarySuitability(input)).toThrow(
        expect.objectContaining({ code: "diet.declaration_invalid" }),
      );
    },
  );
});
