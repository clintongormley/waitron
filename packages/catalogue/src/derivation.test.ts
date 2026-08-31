import { describe, expect, it } from "vitest";
import { deriveAsServedAllergens, mergeAllergenMaps, republish } from "./derivation.js";

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

describe("deriveAsServedAllergens (Cautious policy)", () => {
  it("unreviewed base → pending, adds shown, removes IGNORED", () => {
    const r = deriveAsServedAllergens(null, [
      { add: { milk: { presence: "contains" } }, remove: ["gluten"] },
    ]);
    expect(r).toEqual({
      allergens: { milk: { presence: "contains" } },
      pending: true,
      removed: [],
    });
  });

  it("reviewed base → base minus removes, plus adds", () => {
    const r = deriveAsServedAllergens(
      { gluten: { presence: "contains" }, milk: { presence: "contains" } },
      [{ add: null, remove: ["gluten"] }],
    );
    expect(r).toEqual({
      allergens: { milk: { presence: "contains" } },
      pending: false,
      removed: ["gluten"],
    });
  });

  it("a remove clears may_contain too, not only contains", () => {
    const r = deriveAsServedAllergens({ nuts: { presence: "may_contain" } }, [
      { add: null, remove: ["nuts"] },
    ]);
    expect(r).toEqual({ allergens: {}, pending: false, removed: ["nuts"] });
  });

  it("cross-option conflict: remove + add of same code → ADD WINS", () => {
    const r = deriveAsServedAllergens({ gluten: { presence: "contains" } }, [
      { add: null, remove: ["gluten"] },
      { add: { gluten: { presence: "contains" } }, remove: null },
    ]);
    expect(r).toEqual({
      allergens: { gluten: { presence: "contains" } },
      pending: false,
      removed: [],
    });
  });

  it("a code removed by one option but ADDED by another is NOT in `removed` (add wins → still on the plate)", () => {
    const r = deriveAsServedAllergens(
      { gluten: { presence: "contains" }, milk: { presence: "contains" } },
      [
        { add: null, remove: ["gluten", "milk"] },
        { add: { gluten: { presence: "contains" } }, remove: null },
      ],
    );
    // gluten was re-added so it stays on the plate and is NOT "removed"; milk stays removed.
    expect(r).toEqual({
      allergens: { gluten: { presence: "contains" } },
      pending: false,
      removed: ["milk"],
    });
  });

  it("empty options echo a reviewed base unchanged", () => {
    const base = { eggs: { presence: "contains" } } as const;
    expect(deriveAsServedAllergens(base, [])).toEqual({
      allergens: base,
      pending: false,
      removed: [],
    });
  });

  it("reviewed-none base (`{}`) with an add → the add, not pending", () => {
    const r = deriveAsServedAllergens({}, [
      { add: { milk: { presence: "contains" } }, remove: null },
    ]);
    expect(r).toEqual({
      allergens: { milk: { presence: "contains" } },
      pending: false,
      removed: [],
    });
  });

  it("null base with no options → empty + pending", () => {
    expect(deriveAsServedAllergens(null, [])).toEqual({
      allergens: {},
      pending: true,
      removed: [],
    });
  });
});
