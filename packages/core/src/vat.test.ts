import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { percentOf } from "./vat.js";

describe("percentOf", () => {
  it("computes 21% of a tax-exclusive line base", () => {
    expect(percentOf(decimal("10.00"), decimal("21.00"))).toBe("2.10");
  });

  it("computes 10% of a different line base", () => {
    expect(percentOf(decimal("2.10"), decimal("10.00"))).toBe("0.21");
  });

  it("accepts an integer amount with no decimal point at all", () => {
    expect(percentOf(decimal("100"), decimal("21.00"))).toBe("21.00");
  });

  it("returns zero for a zero rate", () => {
    expect(percentOf(decimal("100.00"), decimal("0.00"))).toBe("0.00");
  });

  it("rounds half away from zero at the exact midpoint", () => {
    // 12.5% of 1.00 = 0.125, which sits exactly on the rounding boundary between 0.12 and 0.13.
    expect(percentOf(decimal("1.00"), decimal("12.50"))).toBe("0.13");
  });

  it("rounds a negative result away from zero too", () => {
    expect(percentOf(decimal("-1.00"), decimal("12.50"))).toBe("-0.13");
  });

  it("stays exact for a value that would carry floating-point error through a JS division", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE 754; this is the money-domain analogue, computed here via BigInt
    // throughout rather than `Number`, so the classic representation error never has anywhere to
    // enter.
    expect(percentOf(decimal("30.00"), decimal("10.00"))).toBe("3.00");
  });

  it("honours an explicit scale of zero", () => {
    // 100% of 10.00 is 10.00, rendered with zero decimal places as the whole number "10" — the
    // `render` helper's integer-only (no decimal point) formatting path.
    expect(percentOf(decimal("10.00"), decimal("100.00"), 0)).toBe("10");
  });

  it("honours an explicit scale wider than amount's and rate's scales combined", () => {
    // Unreachable through this file's own real callers (record-sale.ts always asks for the
    // default two-decimal money scale, and a.scale + r.scale + 2 is always at least 4 for a
    // two-decimal amount and a two-decimal rate), but the function is written to stay total
    // rather than to assume its only caller's shape — this exercises the "shift up" branch
    // (target scale wider than the exact product already provides) rather than leaving it an
    // untested assumption.
    expect(percentOf(decimal("10.00"), decimal("21.00"), 7)).toBe("2.1000000");
  });
});
