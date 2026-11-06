import { describe, it, expect } from "vitest";
import type { AppError } from "../errors.js";
import {
  deriveDietProfile,
  overlayDietProfile,
  validateOrigin,
  validateContainsTag,
  validateDietOverride,
  assertDietOverrideDisjoint,
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
  it("with no override returns the derived profile with its contains-tags sorted", () => {
    const derived: DietProfile = { vegan: "no", vegetarian: "no", contains: ["meat", "fish"] };
    expect(overlayDietProfile(derived, null)).toEqual({
      vegan: "no",
      vegetarian: "no",
      contains: ["fish", "meat"],
    });
    expect(derived.contains).toEqual(["meat", "fish"]);
  });
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

describe("validateContainsTag (Task 4)", () => {
  it("accepts meat/fish only — an otherwise-valid origin is rejected", () => {
    expect(validateContainsTag("meat")).toBe("meat");
    expect(validateContainsTag("fish")).toBe("fish");
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

describe("diet refusals and the override's edges", () => {
  function refusal(call: () => unknown): { code: string; params: unknown } {
    try {
      call();
    } catch (e) {
      return { code: (e as AppError).code, params: (e as AppError).params };
    }
    throw new Error("should have thrown");
  }

  it("refuses an unknown origin and a tag outside meat and fish, echoing the value", () => {
    expect(refusal(() => validateOrigin("rock"))).toEqual({
      code: "diet.invalid_origin",
      params: { origin: "rock" },
    });
    expect(refusal(() => validateOrigin(5))).toEqual({
      code: "diet.invalid_origin",
      params: { origin: "5" },
    });
    expect(refusal(() => validateContainsTag("plant"))).toEqual({
      code: "diet.invalid_origin",
      params: { origin: "plant" },
    });
  });

  it("names the field and value of a bad label, and the list that is not a list", () => {
    expect(
      refusal(() => validateDietOverride({ halal: "maybe" } as unknown as DietOverride)),
    ).toEqual({ code: "diet.invalid_label", params: { field: "halal", value: "maybe" } });
    expect(
      refusal(() => validateDietOverride({ removeContains: "fish" } as unknown as DietOverride)),
    ).toEqual({ code: "diet.invalid_origin", params: { origin: "fish" } });
    expect(
      refusal(() => validateDietOverride({ addContains: ["fish"], removeContains: ["fish"] })),
    ).toEqual({ code: "diet.add_remove_conflict", params: { tag: "fish" } });
  });

  it("accepts an override of labels alone", () => {
    const override: DietOverride = { vegan: "no" };
    expect(validateDietOverride(override)).toBe(override);
  });

  it("counts dairy, egg and honey as vegetarian", () => {
    for (const origin of ["dairy", "egg", "honey"] as const)
      expect(deriveDietProfile({ origins: [origin], pending: false }).vegetarian).toBe("yes");
  });

  it("keeps the derived tags, overrides each label, sorts, and adds halal and kosher only when set", () => {
    const derived: DietProfile = { vegan: "no", vegetarian: "yes", contains: ["meat"] };
    expect(overlayDietProfile(derived, { vegetarian: "no" })).toStrictEqual({
      vegan: "no",
      vegetarian: "no",
      contains: ["meat"],
    });
    expect(overlayDietProfile(derived, { addContains: ["fish"], kosher: "yes" })).toStrictEqual({
      vegan: "no",
      vegetarian: "yes",
      contains: ["fish", "meat"],
      kosher: "yes",
    });
    expect(overlayDietProfile(derived, { halal: "no" })).toStrictEqual({
      vegan: "no",
      vegetarian: "yes",
      contains: ["meat"],
      halal: "no",
    });
  });
});
