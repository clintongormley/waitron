import { describe, expect, it } from "vitest";
import { isFullComp } from "./full-comp.js";

function row(action: string, afterAmount: string) {
  return { action, afterAmount };
}

describe("isFullComp", () => {
  it("is true for Free whatever its amounts", () => {
    expect(isFullComp(row("comp", "0.00"))).toBe(true);
  });

  it("is true for an amount that left its subject at zero, whatever an earlier step took", () => {
    expect(isFullComp(row("discount_amount", "0.00"))).toBe(true);
  });

  it("is false for an amount that left part of the price", () => {
    expect(isFullComp(row("discount_amount", "3.00"))).toBe(false);
  });

  it("is false for a percentage, a whole one included", () => {
    expect(isFullComp(row("discount_percent", "0.00"))).toBe(false);
  });

  it("compares amounts as values, not text", () => {
    expect(isFullComp(row("discount_amount", "0.000"))).toBe(true);
  });
});
