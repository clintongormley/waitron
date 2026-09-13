import { describe, expect, it } from "vitest";
import {
  applyDietaryEffects,
  expandDietaryDeclarations,
  validateDietaryDeclarations,
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
  it("an unconfigured food-changing extra makes suitability unknown", () => {
    expect(applyDietaryEffects(["vegan", "halal", "kosher"], [null])).toEqual([]);
  });
  it("bacon invalidates vegan and vegetarian without upgrading any other declaration", () => {
    expect(applyDietaryEffects(["vegan"], [{ invalidates: ["no_meat"] }])).toEqual(["no_fish"]);
    expect(applyDietaryEffects([], [{ invalidates: [] }])).toEqual([]);
  });
  it("a reviewed neutral effect preserves declarations and effect order cannot restore invalidated labels", () => {
    expect(applyDietaryEffects(["vegan", "halal"], [{ invalidates: [] }])).toEqual([
      "vegan",
      "vegetarian",
      "halal",
      "no_meat",
      "no_fish",
    ]);
    const first = { invalidates: ["vegetarian" as const] };
    const neutral = { invalidates: [] };
    expect(applyDietaryEffects(["vegan"], [first, neutral])).toEqual(["no_meat", "no_fish"]);
    expect(applyDietaryEffects(["vegan"], [neutral, first])).toEqual(["no_meat", "no_fish"]);
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
