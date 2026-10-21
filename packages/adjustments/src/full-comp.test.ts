import { describe, expect, it } from "vitest";
import { isFullComp } from "./full-comp.js";

function row(action: string, beforeAmount: string, afterAmount: string, nominalValue = "12.00") {
  return { action, beforeAmount, afterAmount, nominalValue };
}

describe("isFullComp", () => {
  it("is true for Free whatever its amounts", () => {
    expect(isFullComp(row("comp", "6.00", "0.00"))).toBe(true);
  });

  it("is true for an amount that took the item's whole list value", () => {
    expect(isFullComp(row("discount_amount", "12.00", "0.00"))).toBe(true);
  });

  it("is false for an amount that took what an earlier comp left", () => {
    expect(isFullComp(row("discount_amount", "6.00", "0.00"))).toBe(false);
  });

  it("is false for an amount that left part of the price", () => {
    expect(isFullComp(row("discount_amount", "12.00", "3.00"))).toBe(false);
  });

  it("is false for a percentage, a whole one included", () => {
    expect(isFullComp(row("discount_percent", "12.00", "0.00"))).toBe(false);
  });

  it("compares amounts as values, not text", () => {
    expect(isFullComp(row("discount_amount", "12.0", "0", "12.00"))).toBe(true);
  });

  it("compares amounts exactly, not as floating-point numbers", () => {
    expect(Number("12.0000000000000001")).toBe(Number("12.00"));
    expect(isFullComp(row("discount_amount", "12.0000000000000001", "0.00", "12.00"))).toBe(false);
  });
});
