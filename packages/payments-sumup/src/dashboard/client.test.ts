import { describe, expect, it } from "vitest";
import { ambiguousMerchants } from "./client.js";

describe("ambiguousMerchants", () => {
  it("reads the pickable merchants off a payment.provider_merchant_ambiguous rejection", () => {
    const merchants = [
      { code: "M1", name: "One" },
      { code: "M2", name: "Two" },
    ];
    expect(
      ambiguousMerchants({ code: "payment.provider_merchant_ambiguous", params: { merchants } }),
    ).toEqual(merchants);
  });

  it("returns an empty list when the rejection carries no merchant list", () => {
    expect(ambiguousMerchants(new Error("x"))).toEqual([]);
    expect(ambiguousMerchants({ params: {} })).toEqual([]);
  });
});
