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
});
