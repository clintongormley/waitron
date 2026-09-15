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
});

describe("republish", () => {
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
