import { describe, expect, it } from "vitest";
import { itemCount, type DraftEntry } from "./draft-groups.js";

const entry = (quantity: string, wholeUnits = true): DraftEntry => ({ quantity, wholeUnits });

describe("itemCount", () => {
  it("counts a line sold by the unit by its quantity, and a weighed line as one item", () => {
    expect(itemCount(entry("3"))).toBe(3);
    expect(itemCount(entry("3.000"))).toBe(3);
    expect(itemCount(entry("0.450", false))).toBe(1);
    expect(itemCount(entry("2", false))).toBe(1);
  });
});
