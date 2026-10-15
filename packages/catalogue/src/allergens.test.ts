import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { ALLERGEN_CODES, validateAllergens } from "./allergens.js";

describe("ALLERGEN_CODES", () => {
  it("is the closed EU-14 list", () => {
    expect(ALLERGEN_CODES).toHaveLength(14);
    expect(ALLERGEN_CODES).toContain("gluten");
    expect(ALLERGEN_CODES).toContain("molluscs");
    expect(new Set(ALLERGEN_CODES).size).toBe(14);
  });
});

describe("validateAllergens", () => {
  it("accepts an empty object (reviewed, none of the 14)", () => {
    expect(validateAllergens({})).toEqual({});
  });

  it("accepts a declaration with cereal and nut kinds", () => {
    const a = {
      gluten: { kinds: ["wheat"] },
      nuts: { kinds: ["almonds"] },
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

  it("rejects an unknown kind", () => {
    try {
      validateAllergens({ gluten: { kinds: ["unknown"] } });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("allergen.invalid_kind");
    }
  });

  it("rejects a non-object value", () => {
    expect(() => validateAllergens("gluten")).toThrow(AppError);
  });

  it("rejects a non-string kind", () => {
    try {
      validateAllergens({ gluten: { kinds: [42] } });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("allergen.invalid_kind");
    }
  });

  it("accepts a kind list unchanged", () => {
    const a = { gluten: { kinds: ["wheat"] } };
    expect(validateAllergens(a)).toEqual(a);
  });

  it("accepts an ordinary allergen without kinds", () => {
    const a = { milk: {} };
    expect(validateAllergens(a)).toEqual(a);
  });
});
