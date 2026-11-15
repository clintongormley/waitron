import { describe, expect, it } from "vitest";
import { appliedVatClass, DINING_POLICIES, DININGS } from "./index.js";

describe("dining", () => {
  it("names the two ways an order is eaten and the three department policies", () => {
    expect(DININGS).toEqual(["eat_in", "takeaway"]);
    expect(DINING_POLICIES).toEqual(["eat_in", "takeaway", "till_choice"]);
  });

  it("applies the takeaway class to a takeaway line and the main class otherwise", () => {
    const line = { vatClass: "reduced", takeawayVatClass: "general" } as const;
    expect(appliedVatClass("takeaway", line)).toBe("general");
    expect(appliedVatClass("eat_in", line)).toBe("reduced");
  });
});
