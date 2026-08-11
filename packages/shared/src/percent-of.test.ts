import { describe, expect, it } from "vitest";
import { decimal, percentOf } from "./money.js";

// These assertions are the behavioural contract hoisted out of packages/core/src/vat.test.ts when
// `percentOf` moved into @waitron/shared. Every case that suite pinned is reproduced here (including
// its explicit scale-0 and scale-7 cases), plus new exact-integer, sub-cent-rounding, and
// negative-base cases the refactor brief called for, so deleting the core suite drops no case.
describe("percentOf", () => {
  it("computes 21% of a tax-exclusive line base", () => {
    expect(percentOf(decimal("10.00"), decimal("21.00"))).toBe("2.10");
  });

  it("computes 10% of a different line base", () => {
    expect(percentOf(decimal("2.10"), decimal("10.00"))).toBe("0.21");
  });

  it("takes an exact integer amount and rate to money scale", () => {
    // 100 * 21 / 100 = 21, rendered at the default money scale as "21.00".
    expect(percentOf(decimal("100"), decimal("21"))).toBe("21.00");
  });

  it("accepts an integer amount with a two-place rate", () => {
    expect(percentOf(decimal("100"), decimal("21.00"))).toBe("21.00");
  });

  it("returns zero for a zero rate", () => {
    expect(percentOf(decimal("100.00"), decimal("0.00"))).toBe("0.00");
  });

  it("rounds half away from zero at the exact midpoint", () => {
    // 12.5% of 1.00 = 0.125, which sits exactly on the rounding boundary between 0.12 and 0.13.
    expect(percentOf(decimal("1.00"), decimal("12.50"))).toBe("0.13");
  });

  it("rounds a sub-cent result up to the nearest cent", () => {
    // 21% of 0.03 = 0.0063, which rounds to 0.01 at money scale (the third decimal, 6, is >= 5).
    expect(percentOf(decimal("0.03"), decimal("21"))).toBe("0.01");
  });

  it("rounds a negative result away from zero too", () => {
    expect(percentOf(decimal("-1.00"), decimal("12.50"))).toBe("-0.13");
  });

  it("carries a negative base straight through to a negative tax (a correction)", () => {
    // A correction line's base is negative, and its tax must be the negative of the positive case.
    expect(percentOf(decimal("-100.00"), decimal("21.00"))).toBe("-21.00");
  });

  it("stays exact for a value that would carry floating-point error through a JS division", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE 754; this is the money-domain analogue, computed here via BigInt
    // throughout rather than `Number`, so the classic representation error never has anywhere to
    // enter.
    expect(percentOf(decimal("30.00"), decimal("10.00"))).toBe("3.00");
  });

  it("honours an explicit scale of zero", () => {
    // 100% of 10.00 is 10.00, rendered with zero decimal places as the whole number "10".
    expect(percentOf(decimal("10.00"), decimal("100.00"), 0)).toBe("10");
  });

  it("honours an explicit scale wider than amount's and rate's scales combined", () => {
    // Exercises the "shift up" branch (target scale wider than the exact product already provides)
    // rather than leaving it an untested assumption.
    expect(percentOf(decimal("10.00"), decimal("21.00"), 7)).toBe("2.1000000");
  });
});
