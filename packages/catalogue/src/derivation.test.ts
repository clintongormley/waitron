import { describe, expect, it } from "vitest";
import type { Kind, ProductAllergens } from "./allergens.js";
import { mergeAllergenMaps, republish } from "./derivation.js";

describe("mergeAllergenMaps", () => {
  const gluten = (...kinds: Kind[]): ProductAllergens => ({ gluten: { kinds } });
  const fold = (kinds: Kind[]) => kinds.map((kind) => gluten(kind)).reduce(mergeAllergenMaps, {});

  it("unions ordinary allergen codes", () => {
    expect(mergeAllergenMaps({ eggs: {} }, { eggs: {}, milk: {} })).toEqual({ eggs: {}, milk: {} });
  });
  it("keeps a lone allergen's kinds", () => {
    expect(mergeAllergenMaps({}, { nuts: { kinds: ["almonds"] } })).toEqual({
      nuts: { kinds: ["almonds"] },
    });
    expect(mergeAllergenMaps(gluten("wheat", "spelt"), {})).toEqual(gluten("spelt", "wheat"));
    expect(mergeAllergenMaps({}, gluten("wheat", "spelt"))).toEqual(gluten("spelt", "wheat"));
  });
  it("folds three kinds to the same sorted set in each order", () => {
    for (const kinds of [
      ["barley", "rye", "wheat"],
      ["barley", "wheat", "rye"],
      ["wheat", "rye", "barley"],
      ["rye", "barley", "wheat"],
      ["rye", "wheat", "barley"],
      ["wheat", "barley", "rye"],
    ] satisfies Kind[][]) {
      expect(fold(kinds)).toEqual({ gluten: { kinds: ["barley", "rye", "wheat"] } });
    }
  });
  it("lists a repeated kind once", () => {
    expect(fold(["barley", "rye", "barley"])).toEqual({ gluten: { kinds: ["barley", "rye"] } });
    expect(mergeAllergenMaps(gluten("wheat"), gluten("wheat"))).toEqual(gluten("wheat"));
  });
  it("returns independent kind arrays", () => {
    const input = gluten("wheat");
    const result = mergeAllergenMaps(input, {});
    result.gluten!.kinds!.push("barley");
    expect(input).toEqual({ gluten: { kinds: ["wheat"] } });
  });
});

describe("republish", () => {
  it("does not repeat a manual kind the derived floor already lists", () => {
    expect(
      republish(
        { gluten: { kinds: ["barley"] } },
        { allergens: { gluten: { kinds: ["barley", "rye"] } }, pending: false },
      ),
    ).toEqual({ gluten: { kinds: ["barley", "rye"] } });
  });
  it("is PENDING (null) when nothing is reviewed", () => {
    expect(republish(null, null)).toBeNull();
  });
  it("is PENDING (null) when the recipe has an unreviewed ingredient", () => {
    expect(
      republish({ nuts: { kinds: ["almonds"] } }, { allergens: {}, pending: true }),
    ).toBeNull();
  });
  it("returns the manual map when there is no recipe", () => {
    expect(republish({ gluten: { kinds: ["wheat"] } }, null)).toEqual({
      gluten: { kinds: ["wheat"] },
    });
  });
  it("returns {} for a product reviewed with no allergens", () => {
    expect(republish({}, null)).toEqual({});
  });
  it("unions the derived floor with manual additions (add-only)", () => {
    expect(
      republish({ nuts: { kinds: ["almonds"] } }, { allergens: { eggs: {} }, pending: false }),
    ).toEqual({ eggs: {}, nuts: { kinds: ["almonds"] } });
  });
  it("publishes a complete recipe with no manual overlay", () => {
    expect(republish(null, { allergens: { eggs: {} }, pending: false })).toEqual({
      eggs: {},
    });
  });
});
