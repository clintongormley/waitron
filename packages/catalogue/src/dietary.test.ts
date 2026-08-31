import { describe, it, expect } from "vitest";
import {
  deriveDietProfile,
  overlayDietProfile,
  deriveAsServedDiet,
  validateOrigin,
  assertDietOverrideDisjoint,
  type DietDerivation,
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
