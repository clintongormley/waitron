import { MAX_QUANTITY_INTEGER_DIGITS } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import { assertQuantityPrecision, validateUnitPrecision } from "./units.js";

describe("unit validation", () => {
  it.each([0, 1, 2, 3])("accepts precision %s", (precision) => {
    expect(validateUnitPrecision(precision)).toBe(precision);
  });

  it.each([-1, 4, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid precision %s",
    (precision) => {
      expect(() => validateUnitPrecision(precision)).toThrowError(
        expect.objectContaining({ code: "unit.precision_invalid" }),
      );
    },
  );

  it.each([
    ["1", 0],
    ["1.000", 0],
    ["0.125", 3],
    ["4.20", 2],
    ["999999999.999", 3],
  ] as const)("accepts quantity %s at precision %s", (quantity, precision) => {
    expect(assertQuantityPrecision(quantity, precision, { positive: true })).toBe(quantity);
  });

  it.each([
    ["", 3, "format"],
    ["NaN", 3, "format"],
    ["1e3", 3, "format"],
    ["-1", 3, "positive"],
    ["0", 3, "positive"],
    ["1.234", 2, "precision"],
    ["1.2345", 3, "precision"],
    ["1000000000", 3, "limit"],
  ] as const)("rejects quantity %s at precision %s", (quantity, precision, reason) => {
    expect(() => assertQuantityPrecision(quantity, precision, { positive: true })).toThrowError(
      expect.objectContaining({ code: "quantity.invalid", params: { reason } }),
    );
  });

  it("agrees with the converter's integer-digit bound for a quantity", () => {
    // The two boundary cases above are written out as literals, so they say nothing about the
    // quantity column at all. This case builds both boundaries from
    // `MAX_QUANTITY_INTEGER_DIGITS` — `@waitron/shared`'s scales module, where the converter
    // enforces the same bound — so the two stay in step: a validator refusing values the
    // converter accepts is the failure this catches, and it is the one that arrives the day that
    // bound moves. (The `bigint` column itself has no integer-digit bound any more; nine digits is
    // what the retired `numeric(12, 3)` admitted, and the converter is where that refusal now
    // lives.) What it does NOT establish is that the validator READS that constant. Restore a
    // private copy of 9 here and this still passes; the two numbers agreeing is all it checks.
    const widest = "9".repeat(MAX_QUANTITY_INTEGER_DIGITS);
    expect(assertQuantityPrecision(`${widest}.999`, 3, { positive: true })).toBe(`${widest}.999`);
    const tooWide = `1${"0".repeat(MAX_QUANTITY_INTEGER_DIGITS)}`;
    expect(() => assertQuantityPrecision(tooWide, 3, { positive: true })).toThrowError(
      expect.objectContaining({ code: "quantity.invalid", params: { reason: "limit" } }),
    );
  });
});
