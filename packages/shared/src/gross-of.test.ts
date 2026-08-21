import { describe, expect, it } from "vitest";
import { grossOf } from "./money.js";

// `grossOf` is the single per-line gross primitive both `@waitron/till`'s `lineGross` (basket + printed
// receipt) and the tab-order screen's line/total funnel through, so a rung-up row, a receipt line and
// the filed total can never round differently. These cases pin the arithmetic — the exact product taken
// to money scale, rounded half away from zero — INCLUDING the two shapes those call sites feed it (an
// `each` quantity like "2.000" and a weight quantity like "0.320"), plus the rounding boundaries.
describe("grossOf", () => {
  it("multiplies a unit price by an integer-valued quantity to money scale", () => {
    // The tab drawer's own fixture: 2 dos-café at 1.50 each = 3.00.
    expect(grossOf("1.50", "2.000")).toBe("3.00");
  });

  it("takes a single unit to money scale", () => {
    expect(grossOf("1.50", "1.000")).toBe("1.50");
  });

  it("prices a weight product's fractional quantity", () => {
    // 3.20 €/kg × 0.320 kg = 1.024, which drops to 1.02 at money scale (the third decimal, 4, is < 5).
    expect(grossOf("3.20", "0.320")).toBe("1.02");
  });

  it("keeps the full product scale before the single rounding", () => {
    // 2.005 × 1 = 2.005; the exact product is carried, then rounded ONCE at the money boundary — the
    // half-away-from-zero midpoint rounds up to 2.01, never truncates to 2.00.
    expect(grossOf("2.005", "1")).toBe("2.01");
  });

  it("rounds a just-under-half product down", () => {
    // 2.004 × 1 = 2.004 → 2.00 (the third decimal, 4, is < 5).
    expect(grossOf("2.004", "1")).toBe("2.00");
  });

  it("takes exact-integer operands to money scale", () => {
    // 5 × 3 = 15, rendered at money scale as "15.00".
    expect(grossOf("5", "3")).toBe("15.00");
  });

  it("stays exact for a value a JS float multiply would corrupt", () => {
    // 0.1 × 3 is 0.30000000000000004 in IEEE 754; computed via BigInt throughout, the representation
    // error never has anywhere to enter.
    expect(grossOf("0.10", "3")).toBe("0.30");
  });

  it("validates each operand through `decimal`, rejecting a non-decimal string", () => {
    // A malformed operand is refused at `decimal`, never coerced — the same guard every money op uses.
    expect(() => grossOf("abc", "1")).toThrow();
  });
});
