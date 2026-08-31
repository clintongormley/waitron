import { describe, it, expect } from "vitest";
import {
  deriveDietProfile,
  overlayDietProfile,
  deriveAsServedDiet,
  validateOrigin,
  validateOrigins,
  validateContainsTag,
  validateDietOverride,
  assertDietOverrideDisjoint,
  type DietDerivation,
  type DietOverride,
  type DietProfile,
} from "./dietary.js";

describe("deriveDietProfile", () => {
  it("all-plant, reviewed → vegan+vegetarian yes, no contains", () => {
    expect(deriveDietProfile({ origins: ["plant"], pending: false })).toEqual({
      vegan: "yes",
      vegetarian: "yes",
      contains: [],
    });
  });
  it("dairy present → vegetarian yes, vegan no", () => {
    expect(deriveDietProfile({ origins: ["dairy", "plant"], pending: false })).toEqual({
      vegan: "no",
      vegetarian: "yes",
      contains: [],
    });
  });
  it("meat present → both no, contains meat", () => {
    expect(deriveDietProfile({ origins: ["meat", "plant"], pending: false })).toEqual({
      vegan: "no",
      vegetarian: "no",
      contains: ["meat"],
    });
  });
  it("fish present → both no, contains fish", () => {
    expect(deriveDietProfile({ origins: ["fish"], pending: false })).toEqual({
      vegan: "no",
      vegetarian: "no",
      contains: ["fish"],
    });
  });
  it("other_animal (gelatine) → vegetarian no", () => {
    expect(
      deriveDietProfile({ origins: ["other_animal", "plant"], pending: false }).vegetarian,
    ).toBe("no");
  });
  it("PENDING withholds vegan/veg but NOT a known contains-meat", () => {
    expect(deriveDietProfile({ origins: ["meat"], pending: true })).toEqual({
      vegan: "unknown",
      vegetarian: "unknown",
      contains: ["meat"],
    });
  });
  it("PENDING all-plant → unknown, NOT vegan (cautious)", () => {
    expect(deriveDietProfile({ origins: ["plant"], pending: true })).toEqual({
      vegan: "unknown",
      vegetarian: "unknown",
      contains: [],
    });
  });
});

describe("overlayDietProfile", () => {
  const base: DietProfile = { vegan: "unknown", vegetarian: "unknown", contains: [] };
  it("override forces a label", () => {
    expect(overlayDietProfile(base, { vegan: "yes" }).vegan).toBe("yes");
  });
  it("halal/kosher appear only from the override", () => {
    const out = overlayDietProfile(base, { halal: "yes" });
    expect(out.halal).toBe("yes");
    expect(out.kosher).toBeUndefined();
  });
  it("kosher passes through from the override", () => {
    const out = overlayDietProfile(base, { kosher: "no" });
    expect(out.kosher).toBe("no");
    expect(out.halal).toBeUndefined();
  });
  it("addContains adds, removeContains removes, result sorted", () => {
    expect(
      overlayDietProfile(
        { ...base, contains: ["meat"] },
        { addContains: ["fish"], removeContains: ["meat"] },
      ).contains,
    ).toEqual(["fish"]);
  });
});

describe("deriveAsServedDiet", () => {
  it("remove dairy from a reviewed {plant,dairy} → vegan", () => {
    const d: DietDerivation = { origins: ["dairy", "plant"], pending: false };
    expect(deriveAsServedDiet(d, null, [{ add: null, remove: ["dairy"] }]).vegan).toBe("yes");
  });
  it("add meat → not vegetarian, contains meat", () => {
    const d: DietDerivation = { origins: ["plant"], pending: false };
    const out = deriveAsServedDiet(d, null, [{ add: ["meat"], remove: null }]);
    expect(out).toMatchObject({ vegan: "no", vegetarian: "no", contains: ["meat"] });
  });
  it("CRUX: remove over a PENDING base cannot manufacture vegan", () => {
    const d: DietDerivation = { origins: ["dairy"], pending: true };
    expect(deriveAsServedDiet(d, null, [{ add: null, remove: ["dairy"] }]).vegan).toBe("unknown");
  });
  it("CRUX: add meat downgrades even when base is pending", () => {
    const d: DietDerivation = { origins: ["plant"], pending: true };
    expect(deriveAsServedDiet(d, null, [{ add: ["meat"], remove: null }]).contains).toEqual([
      "meat",
    ]);
  });

  // The as-served cap (final-review fix): an option ADD can only DOWNGRADE a forced-positive
  // vegan/vegetarian label — never let the owner's forced positive stand on a plate an added origin
  // has made unsuitable. Prove-by-deletion target: remove the cap and the first two fail.
  it("CAP: forced vegan:'yes' + add meat → vegan:'no', contains meat (false positive prevented)", () => {
    const d: DietDerivation = { origins: ["plant"], pending: false };
    const out = deriveAsServedDiet(d, { vegan: "yes" }, [{ add: ["meat"], remove: null }]);
    expect(out.vegan).toBe("no");
    expect(out.contains).toContain("meat");
  });
  it("CAP: forced vegetarian:'yes' + add meat → vegetarian:'no'", () => {
    const d: DietDerivation = { origins: ["plant"], pending: false };
    const out = deriveAsServedDiet(d, { vegetarian: "yes" }, [{ add: ["meat"], remove: null }]);
    expect(out.vegetarian).toBe("no");
  });
  it("CAP: forced vegan:'yes' + add dairy → vegan:'no' but vegetarian:'yes' (dairy is veg-ok)", () => {
    const d: DietDerivation = { origins: ["plant"], pending: false };
    const out = deriveAsServedDiet(d, { vegan: "yes" }, [{ add: ["dairy"], remove: null }]);
    expect(out.vegan).toBe("no");
    expect(out.vegetarian).toBe("yes");
  });
  it("CAP: forced vegan:'yes' with NO incompatible add (only a remove) still stands", () => {
    const d: DietDerivation = { origins: ["dairy"], pending: false };
    const out = deriveAsServedDiet(d, { vegan: "yes" }, [{ add: null, remove: ["dairy"] }]);
    expect(out.vegan).toBe("yes"); // base override preserved — no add downgraded it
  });
  it("CAP: halal/kosher forced values are UNCHANGED by an add (no origin→halal/kosher signal)", () => {
    const d: DietDerivation = { origins: ["plant"], pending: false };
    const out = deriveAsServedDiet(d, { halal: "yes", kosher: "yes" }, [
      { add: ["meat"], remove: null },
    ]);
    expect(out.halal).toBe("yes");
    expect(out.kosher).toBe("yes");
  });

  it("add WINS over a remove of the same origin across options (cross-option conflict)", () => {
    const d: DietDerivation = { origins: ["meat", "plant"], pending: false };
    const out = deriveAsServedDiet(d, null, [
      { add: null, remove: ["meat"] },
      { add: ["meat"], remove: null },
    ]);
    expect(out.contains).toContain("meat");
  });
});

describe("validateOrigin / assertDietOverrideDisjoint", () => {
  it("accepts a valid origin, rejects junk", () => {
    expect(validateOrigin("meat")).toBe("meat");
    expect(() => validateOrigin("wombat")).toThrow();
  });
  it("rejects an override that adds and removes the same tag", () => {
    expect(() =>
      assertDietOverrideDisjoint({ addContains: ["meat"], removeContains: ["meat"] }),
    ).toThrow();
    expect(() =>
      assertDietOverrideDisjoint({ addContains: ["meat"], removeContains: ["fish"] }),
    ).not.toThrow();
  });
  it("is a no-op when the override is null or only one side is present", () => {
    expect(() => assertDietOverrideDisjoint(null)).not.toThrow();
    expect(() => assertDietOverrideDisjoint({ addContains: ["meat"] })).not.toThrow();
    expect(() => assertDietOverrideDisjoint({ removeContains: ["meat"] })).not.toThrow();
  });
});

describe("validateOrigins (Task 4)", () => {
  it("returns the narrowed list for valid origins", () => {
    expect(validateOrigins(["meat", "dairy"])).toEqual(["meat", "dairy"]);
    expect(validateOrigins([])).toEqual([]);
  });
  it("rejects a non-array and a non-origin entry", () => {
    expect(() => validateOrigins("meat")).toThrow(/diet.invalid_origin/);
    expect(() => validateOrigins(["meat", "wombat"])).toThrow(/diet.invalid_origin/);
  });
});

describe("validateContainsTag (Task 4)", () => {
  it("accepts meat/fish only — an otherwise-valid origin is rejected", () => {
    expect(validateContainsTag("meat")).toBe("meat");
    expect(validateContainsTag("fish")).toBe("fish");
    // "plant" is a valid ORIGIN but not a contains-tag → rejected.
    expect(() => validateContainsTag("plant")).toThrow(/diet.invalid_origin/);
    expect(() => validateContainsTag("wombat")).toThrow(/diet.invalid_origin/);
    expect(() => validateContainsTag(7)).toThrow(/diet.invalid_origin/);
  });
});

describe("validateDietOverride (Task 4)", () => {
  it("returns null for a null override", () => {
    expect(validateDietOverride(null)).toBeNull();
  });
  it("accepts a well-formed override and returns it", () => {
    const ov: DietOverride = { vegan: "no", halal: "yes", addContains: ["meat"] };
    expect(validateDietOverride(ov)).toBe(ov);
  });
  it("rejects a bad label with diet.invalid_label naming the field", () => {
    expect(() => validateDietOverride({ vegan: "maybe" } as never)).toThrow(/diet.invalid_label/);
    expect(() => validateDietOverride({ kosher: "sometimes" } as never)).toThrow(
      /diet.invalid_label/,
    );
  });
  it("rejects a non-contains-tag in addContains/removeContains", () => {
    expect(() => validateDietOverride({ addContains: ["plant"] } as never)).toThrow(
      /diet.invalid_origin/,
    );
    expect(() => validateDietOverride({ removeContains: "meat" } as never)).toThrow(
      /diet.invalid_origin/,
    );
  });
  it("rejects a conflicting override with diet.add_remove_conflict", () => {
    expect(() => validateDietOverride({ addContains: ["meat"], removeContains: ["meat"] })).toThrow(
      /diet.add_remove_conflict/,
    );
  });
});
