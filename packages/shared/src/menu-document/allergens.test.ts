import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
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

describe("validateAllergens refuses a malformed declaration body", () => {
  function codeOf(value: unknown): string {
    try {
      validateAllergens(value);
    } catch (e) {
      return (e as AppError).code;
    }
    throw new Error("should have thrown");
  }

  it("refuses a declaration that is not an object", () => {
    expect(codeOf({ milk: "contains" })).toBe("allergen.invalid_kind");
    expect(codeOf({ milk: null })).toBe("allergen.invalid_kind");
    expect(codeOf({ milk: [] })).toBe("allergen.invalid_kind");
  });

  it("refuses a declaration carrying a key other than kinds", () => {
    expect(codeOf({ milk: { presence: "contains" } })).toBe("allergen.invalid_kind");
  });

  it("refuses kinds on an allergen that has none, and kinds that are not a list", () => {
    expect(codeOf({ milk: { kinds: ["wheat"] } })).toBe("allergen.invalid_kind");
    expect(codeOf({ gluten: { kinds: "wheat" } })).toBe("allergen.invalid_kind");
  });

  it("requires kinds on cereals and nuts", () => {
    expect(codeOf({ gluten: {} })).toBe("allergen.kinds_required");
    expect(codeOf({ nuts: { kinds: [] } })).toBe("allergen.kinds_required");
  });
});
