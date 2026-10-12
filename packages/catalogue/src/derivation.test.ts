import { describe, expect, it } from "vitest";
import { mergeAllergenMaps, republish } from "./derivation.js";

describe("mergeAllergenMaps", () => {
  it("unions keys; contains dominates may_contain", () => {
    const a = { eggs: { presence: "contains" as const } };
    const b = {
      eggs: { presence: "may_contain" as const },
      nuts: { presence: "may_contain" as const },
    };
    expect(mergeAllergenMaps(a, b)).toEqual({
      eggs: { presence: "contains" },
      nuts: { presence: "may_contain" },
    });
  });

  it("comma-joins distinct non-empty sources into one string", () => {
    const a = { eggs: { presence: "contains" as const, source: "egg" } };
    const b = { eggs: { presence: "contains" as const, source: "mayonnaise" } };
    expect(mergeAllergenMaps(a, b)).toEqual({
      eggs: { presence: "contains", source: "egg, mayonnaise" },
    });
  });

  it("sorts joined sources regardless of argument order (deterministic, not iteration order)", () => {
    const a = { eggs: { presence: "contains" as const, source: "mayonnaise" } };
    const b = { eggs: { presence: "contains" as const, source: "egg" } };
    expect(mergeAllergenMaps(a, b)).toEqual({
      eggs: { presence: "contains", source: "egg, mayonnaise" },
    });
  });

  it("keeps a lone code's own presence (may_contain stays may_contain)", () => {
    expect(mergeAllergenMaps({}, { nuts: { presence: "may_contain" as const } })).toEqual({
      nuts: { presence: "may_contain" },
    });
  });

  const gluten = (source: string) => ({ gluten: { presence: "contains" as const, source } });
  const fold = (sources: string[]) =>
    sources.map(gluten).reduce((acc, m) => mergeAllergenMaps(acc, m), {});

  it("folds three or more sources into the same sorted list whatever their order", () => {
    const expected = { gluten: { presence: "contains", source: "barley, rye, wheat" } };
    expect(fold(["barley", "rye", "wheat"])).toEqual(expected);
    expect(fold(["barley", "wheat", "rye"])).toEqual(expected);
    expect(fold(["wheat", "rye", "barley"])).toEqual(expected);
  });

  it("lists a source once when a fold meets it again", () => {
    expect(fold(["barley", "rye", "barley"])).toEqual({
      gluten: { presence: "contains", source: "barley, rye" },
    });
  });

  it("keeps a lone source exactly as written", () => {
    expect(mergeAllergenMaps(gluten("wheat flour, spelt"), {})).toEqual(
      gluten("wheat flour, spelt"),
    );
    expect(mergeAllergenMaps({}, gluten("wheat flour, spelt"))).toEqual(
      gluten("wheat flour, spelt"),
    );
    expect(mergeAllergenMaps(gluten("wheat flour, spelt"), gluten("wheat flour, spelt"))).toEqual(
      gluten("wheat flour, spelt"),
    );
  });

  it("leaves the source out when two different sources hold only commas and spaces", () => {
    const a = { gluten: { presence: "contains" as const, source: " , " } };
    const b = { gluten: { presence: "contains" as const, source: "," } };
    expect(mergeAllergenMaps(a, b)).toEqual({ gluten: { presence: "contains" } });
  });
});

describe("republish", () => {
  it("does not repeat a manual source the derived floor already lists", () => {
    expect(
      republish(
        { gluten: { presence: "contains", source: "barley" } },
        { allergens: { gluten: { presence: "contains", source: "barley, rye" } }, pending: false },
      ),
    ).toEqual({ gluten: { presence: "contains", source: "barley, rye" } });
  });

  it("is PENDING (null) when nothing is reviewed", () => {
    expect(republish(null, null)).toBeNull();
  });
  it("is PENDING (null) when the recipe has an unreviewed ingredient", () => {
    expect(
      republish({ nuts: { presence: "contains" } }, { allergens: {}, pending: true }),
    ).toBeNull();
  });
  it("returns the manual map when there is no recipe", () => {
    expect(republish({ gluten: { presence: "contains" } }, null)).toEqual({
      gluten: { presence: "contains" },
    });
  });
  it("returns {} for a product reviewed with no allergens", () => {
    expect(republish({}, null)).toEqual({});
  });
  it("unions the derived floor with manual additions (add-only)", () => {
    expect(
      republish(
        { nuts: { presence: "may_contain" } },
        { allergens: { eggs: { presence: "contains" } }, pending: false },
      ),
    ).toEqual({ eggs: { presence: "contains" }, nuts: { presence: "may_contain" } });
  });
  it("publishes a complete recipe with no manual overlay", () => {
    expect(
      republish(null, { allergens: { eggs: { presence: "contains" } }, pending: false }),
    ).toEqual({
      eggs: { presence: "contains" },
    });
  });
});
