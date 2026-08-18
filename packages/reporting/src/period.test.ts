import { describe, expect, it } from "vitest";
import { validatePeriod, type LiquidationPeriod } from "./period.js";

describe("validatePeriod", () => {
  it("accepts a valid month, quarter and year", () => {
    expect(() => validatePeriod(2026, { kind: "month", month: 8 })).not.toThrow();
    expect(() => validatePeriod(2026, { kind: "quarter", quarter: 2 })).not.toThrow();
    expect(() => validatePeriod(2026, { kind: "year" })).not.toThrow();
  });
  it("rejects a non-four-digit year in every period kind", () => {
    for (const p of [
      { kind: "month", month: 8 },
      { kind: "quarter", quarter: 1 },
      { kind: "year" },
    ] as LiquidationPeriod[]) {
      expect(() => validatePeriod(226, p)).toThrow(/year/);
      expect(() => validatePeriod(10000, p)).toThrow(/year/);
    }
  });
  it("rejects an out-of-range month and quarter", () => {
    expect(() => validatePeriod(2026, { kind: "month", month: 0 })).toThrow(/month/);
    expect(() => validatePeriod(2026, { kind: "month", month: 13 })).toThrow(/month/);
    expect(() => validatePeriod(2026, { kind: "quarter", quarter: 0 })).toThrow(/quarter/);
    expect(() => validatePeriod(2026, { kind: "quarter", quarter: 5 })).toThrow(/quarter/);
  });
});
