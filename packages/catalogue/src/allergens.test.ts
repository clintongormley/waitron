import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { ALLERGEN_CODES, validateAllergens } from "./allergens.js";

describe("ALLERGEN_CODES", () => {
  it("is the closed EU-14 list", () => {
    expect(ALLERGEN_CODES).toHaveLength(14);
    expect(ALLERGEN_CODES).toContain("gluten");
    expect(ALLERGEN_CODES).toContain("molluscs");
    expect(new Set(ALLERGEN_CODES).size).toBe(14); // no dups
  });
});

describe("validateAllergens", () => {
  it("accepts an empty object (reviewed, none of the 14)", () => {
    expect(validateAllergens({})).toEqual({});
  });

  it("accepts a full valid declaration with an optional source", () => {
    const a = {
      gluten: { presence: "contains", source: "wheat" },
      nuts: { presence: "may_contain" },
    };
    expect(validateAllergens(a)).toEqual(a);
  });

  it("rejects an unknown allergen code", () => {
    expect(() => validateAllergens({ gluteen: { presence: "contains" } })).toThrow(AppError);
    try {
      validateAllergens({ gluteen: { presence: "contains" } });
    } catch (e) {
      expect((e as AppError).code).toBe("allergen.invalid_code");
    }
  });

  it("rejects a bad presence value", () => {
    try {
      validateAllergens({ gluten: { presence: "maybe" } });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("allergen.invalid_presence");
    }
  });

  it("rejects a non-object value", () => {
    expect(() => validateAllergens("gluten")).toThrow(AppError);
  });
});
