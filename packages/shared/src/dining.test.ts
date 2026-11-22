import { describe, expect, it } from "vitest";
import { DINING_POLICIES, DININGS } from "./index.js";

describe("dining", () => {
  it("names the two ways an order is eaten and the three department policies", () => {
    expect(DININGS).toEqual(["eat_in", "takeaway"]);
    expect(DINING_POLICIES).toEqual(["eat_in", "takeaway", "till_choice"]);
  });
});
