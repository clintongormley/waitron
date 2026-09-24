import { describe, expect, it } from "vitest";
import { decimal, percentOf } from "./money.js";

describe("percentOf", () => {
  it("computes 21% of a tax-exclusive line base", () => {
    expect(percentOf(decimal("10.00"), decimal("21.00"))).toBe("2.10");
  });

  it("computes 10% of a different line base", () => {
    expect(percentOf(decimal("2.10"), decimal("10.00"))).toBe("0.21");
  });

  it("takes an exact integer amount and rate to money scale", () => {
    expect(percentOf(decimal("100"), decimal("21"))).toBe("21.00");
  });

  it("accepts an integer amount with a two-place rate", () => {
    expect(percentOf(decimal("100"), decimal("21.00"))).toBe("21.00");
  });

  it("returns zero for a zero rate", () => {
    expect(percentOf(decimal("100.00"), decimal("0.00"))).toBe("0.00");
  });

  it("rounds half away from zero at the exact midpoint", () => {
    expect(percentOf(decimal("1.00"), decimal("12.50"))).toBe("0.13");
  });

  it("rounds a sub-cent result up to the nearest cent", () => {
    expect(percentOf(decimal("0.03"), decimal("21"))).toBe("0.01");
  });

  it("rounds a negative result away from zero too", () => {
    expect(percentOf(decimal("-1.00"), decimal("12.50"))).toBe("-0.13");
  });

  it("carries a negative base straight through to a negative tax (a correction)", () => {
    expect(percentOf(decimal("-100.00"), decimal("21.00"))).toBe("-21.00");
  });

  it("stays exact for a value that would carry floating-point error through a JS division", () => {
    // 3.50 * 21.00 / 100 = 0.735 exactly, a half-cent midpoint; the double nearest 0.735 is just
    // below it, so `(Number("3.50") * Number("21.00") / 100).toFixed(2)` yields "0.73".
    expect(percentOf(decimal("3.50"), decimal("21.00"))).toBe("0.74");
  });

  it("honours an explicit scale of zero", () => {
    expect(percentOf(decimal("10.00"), decimal("100.00"), 0)).toBe("10");
  });

  it("honours an explicit scale wider than amount's and rate's scales combined", () => {
    expect(percentOf(decimal("10.00"), decimal("21.00"), 7)).toBe("2.1000000");
  });
});
