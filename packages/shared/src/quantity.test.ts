import { describe, expect, it } from "vitest";
import { perDishOptionQuantity } from "./quantity.js";

describe("perDishOptionQuantity", () => {
  it("recovers the per-dish count from a combined child quantity", () => {
    // combined 6 = dish 3 × per-option 2 → 2 per dish
    expect(perDishOptionQuantity("6", "3")).toBe(2);
  });

  it("returns 1 for a plain modifier on a multi-quantity dish", () => {
    // combined 3 = dish 3 × per-option 1 → 1 per dish
    expect(perDishOptionQuantity("3", "3")).toBe(1);
  });

  it("returns the per-option count on a single dish", () => {
    // combined 2 = dish 1 × per-option 2 → 2 per dish
    expect(perDishOptionQuantity("2", "1")).toBe(2);
  });
});
