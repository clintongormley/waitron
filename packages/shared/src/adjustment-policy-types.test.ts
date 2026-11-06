import { describe, expect, it } from "vitest";
import { ADJUSTMENT_ACTIONS, REASON_KINDS } from "./adjustment-policy-types.js";

// The database's enum CHECKs are built from these lists in this order.
describe("adjustment policy lists", () => {
  it("has the two reason kinds, in order", () => expect(REASON_KINDS).toEqual(["void", "comp"]));
  it("has the four adjustment actions, in order", () =>
    expect(ADJUSTMENT_ACTIONS).toEqual(["cancel", "comp", "discount_percent", "discount_amount"]));
});
