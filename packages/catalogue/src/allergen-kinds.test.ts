import { describe, expect, it } from "vitest";
import { validateAllergens, type ProductAllergens } from "./allergens.js";
import { mergeAllergenMaps } from "./derivation.js";

describe("allergen kinds", () => {
  it("accepts declarations with cereal and nut kinds and no presence metadata", () => {
    expect(
      validateAllergens({
        gluten: { kinds: ["wheat", "rye", "barley", "oats", "spelt", "kamut"] },
        nuts: {
          kinds: [
            "almonds",
            "hazelnuts",
            "walnuts",
            "cashews",
            "pecans",
            "brazil_nuts",
            "pistachios",
            "macadamia",
          ],
        },
        milk: {},
      }),
    ).toEqual({
      gluten: { kinds: ["wheat", "rye", "barley", "oats", "spelt", "kamut"] },
      nuts: {
        kinds: [
          "almonds",
          "hazelnuts",
          "walnuts",
          "cashews",
          "pecans",
          "brazil_nuts",
          "pistachios",
          "macadamia",
        ],
      },
      milk: {},
    });
  });

  it.each(["gluten", "nuts"])("requires a nonempty kind list for %s", (code) => {
    for (const entry of [{}, { kinds: [] }]) {
      expect(() => validateAllergens({ [code]: entry })).toThrowError(
        expect.objectContaining({ code: "allergen.kinds_required", params: { code } }),
      );
    }
  });

  it.each([
    ["nuts", { kinds: ["wheat"] }],
    ["gluten", { kinds: ["almonds"] }],
    ["nuts", { kinds: ["unknown"] }],
    ["milk", { kinds: ["wheat"] }],
    ["milk", { kinds: [] }],
    ["milk", { kinds: undefined }],
    ["gluten", { kinds: "wheat" }],
    ["gluten", { kinds: null }],
    ["gluten", { kinds: [42] }],
    ["gluten", { kinds: new Array(1) }],
    ["milk", null],
    ["milk", []],
    ["milk", "contains"],
    ["milk", { presence: "contains" }],
    ["milk", { source: "cream" }],
    ["milk", { unknown: true }],
  ])("refuses an invalid kind declaration for %s: %j", (code, entry) => {
    expect(() => validateAllergens({ [code as string]: entry })).toThrowError(
      expect.objectContaining({ code: "allergen.invalid_kind", params: { code } }),
    );
  });

  it("unions codes and kinds without losing either overlay or changing inputs", () => {
    const manual: ProductAllergens = { gluten: { kinds: ["wheat", "barley"] }, milk: {} };
    const recipe: ProductAllergens = {
      gluten: { kinds: ["rye", "wheat"] },
      nuts: { kinds: ["almonds"] },
    };
    const original = structuredClone({ manual, recipe });
    const expected = {
      gluten: { kinds: ["barley", "rye", "wheat"] },
      milk: {},
      nuts: { kinds: ["almonds"] },
    };
    expect(mergeAllergenMaps(manual, recipe)).toEqual(expected);
    expect(mergeAllergenMaps(recipe, manual)).toEqual(expected);
    expect({ manual, recipe }).toEqual(original);
  });
});
