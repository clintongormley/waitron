import { describe, expect, it } from "vitest";
import type { Kind, ProductAllergens } from "@waitron/shared";
import { mergeAllergenMaps, publishedAllergens } from "./derivation.js";

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

describe("publishedAllergens", () => {
  it("is null when nothing is reviewed", () => {
    expect(publishedAllergens(null)).toBeNull();
  });
  it("returns the declaration", () => {
    expect(publishedAllergens({ gluten: { kinds: ["wheat"] } })).toEqual({
      gluten: { kinds: ["wheat"] },
    });
  });
  it("returns {} for a product reviewed with no allergens", () => {
    expect(publishedAllergens({})).toEqual({});
  });
  it("sorts and de-duplicates kinds", () => {
    expect(publishedAllergens({ nuts: { kinds: ["walnuts", "almonds", "almonds"] } })).toEqual({
      nuts: { kinds: ["almonds", "walnuts"] },
    });
  });
});
