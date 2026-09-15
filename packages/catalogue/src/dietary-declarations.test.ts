import { describe, expect, it } from "vitest";
import { expandDietaryDeclarations, validateDietaryDeclarations } from "./dietary-declarations.js";

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
