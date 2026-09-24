import { describe, expect, it } from "vitest";
import { grossOf } from "./money.js";

describe("grossOf", () => {
  it("multiplies a unit price by an integer-valued quantity to money scale", () => {
    expect(grossOf("1.50", "2.000")).toBe("3.00");
  });

  it("takes a single unit to money scale", () => {
    expect(grossOf("1.50", "1.000")).toBe("1.50");
  });

  it("prices a weight product's fractional quantity", () => {
    expect(grossOf("3.20", "0.320")).toBe("1.02");
  });

  it("keeps the full product scale before the single rounding", () => {
    expect(grossOf("2.005", "1")).toBe("2.01");
  });

  it("rounds a just-under-half product down", () => {
    expect(grossOf("2.004", "1")).toBe("2.00");
  });

  it("takes exact-integer operands to money scale", () => {
    expect(grossOf("5", "3")).toBe("15.00");
  });

  it("stays exact for a value a JS float multiply would corrupt", () => {
    // 0.1 × 3 is 0.30000000000000004 in IEEE 754.
    expect(grossOf("0.10", "3")).toBe("0.30");
  });

  it("validates each operand through `decimal`, rejecting a non-decimal string", () => {
    expect(() => grossOf("abc", "1")).toThrow();
  });
});
