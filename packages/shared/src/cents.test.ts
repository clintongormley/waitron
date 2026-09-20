import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import { centsToDecimal, decimalToCents } from "./cents.js";
import { decimal, MAX_MONEY_INTEGER_DIGITS } from "./money.js";

describe("centsToDecimal", () => {
  it("renders a count of cents as a two-place decimal", () => {
    expect(centsToDecimal(1234)).toBe("12.34");
  });

  it("keeps the two places when the amount is under a euro", () => {
    expect(centsToDecimal(5)).toBe("0.05");
  });

  it("renders zero as 0.00, never as a bare 0", () => {
    // The literal is what a receipt prints and what a fiscal record hashes, so the scale is part
    // of the value: "0" and "0.00" are the same amount and different bytes.
    expect(centsToDecimal(0)).toBe("0.00");
  });

  it("keeps a negative amount negative", () => {
    expect(centsToDecimal(-5)).toBe("-0.05");
  });

  it("refuses a value that is not a whole number of cents", () => {
    // Half a cent cannot be stored and cannot be spent. A caller holding one has divided
    // somewhere without deciding how to round, and rounding silently here would hide it.
    expect(() => centsToDecimal(12.5)).toThrow(AppError);
  });

  it("refuses a value that is not finite", () => {
    expect(() => centsToDecimal(Number.NaN)).toThrow(AppError);
  });
});

describe("decimalToCents", () => {
  it("counts the cents in a two-place decimal", () => {
    expect(decimalToCents(decimal("12.34"))).toBe(1234);
  });

  it("pads a decimal that carries fewer places than two", () => {
    expect(decimalToCents(decimal("12.3"))).toBe(1230);
    expect(decimalToCents(decimal("12"))).toBe(1200);
  });

  it("rounds a third decimal place half away from zero", () => {
    // The rule the decimal column applied on the way in, kept unchanged: this is the boundary
    // where a fiscal amount is decided, and half to even would move a cent on exactly the values
    // that sit on the boundary.
    expect(decimalToCents(decimal("0.005"))).toBe(1);
    expect(decimalToCents(decimal("-0.005"))).toBe(-1);
    expect(decimalToCents(decimal("0.004"))).toBe(0);
  });

  it("round-trips the largest amount the money scale admits", () => {
    // 12 integer digits is the widest amount this system stores, and it is 99999999999999 cents —
    // well inside the 9007199254740991 a JavaScript number counts exactly, so no amount in range
    // can lose a cent to the number type.
    const widest = decimal("9".repeat(MAX_MONEY_INTEGER_DIGITS) + ".99");
    expect(decimalToCents(widest)).toBe(99999999999999);
    expect(99999999999999).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(centsToDecimal(decimalToCents(widest))).toBe(widest);
  });

  it("refuses an amount wider than the money scale admits", () => {
    expect(() => decimalToCents(decimal("1" + "0".repeat(MAX_MONEY_INTEGER_DIGITS)))).toThrow(
      AppError,
    );
  });
});
