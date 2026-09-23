import { describe, expect, it } from "vitest";
import { decimal } from "@waitron/shared";
import { resolveOfferPrice } from "./offer-price.js";

// Four DIFFERENT prices, one per step of spec §15.3's chain, so a step read from the wrong level
// answers a value no other step holds.
const chain = {
  variantMenuPrice: decimal("6.00"),
  variantPrice: decimal("5.50"),
  parentMenuPrice: decimal("4.50"),
  parentPrice: decimal("4.00"),
};

describe("resolveOfferPrice walks the menu price chain from the most specific step", () => {
  it("charges the variant's price on this menu when it is set", () => {
    expect(resolveOfferPrice(chain)).toBe("6.00");
  });

  it("charges the variant's own price when its menu price is blank", () => {
    expect(resolveOfferPrice({ ...chain, variantMenuPrice: null })).toBe("5.50");
  });

  it("charges the parent's price on this menu when both variant prices are blank", () => {
    expect(resolveOfferPrice({ ...chain, variantMenuPrice: null, variantPrice: null })).toBe(
      "4.50",
    );
  });

  it("charges the parent's own price when the parent's menu price is blank too", () => {
    expect(
      resolveOfferPrice({
        ...chain,
        variantMenuPrice: null,
        variantPrice: null,
        parentMenuPrice: null,
      }),
    ).toBe("4.00");
  });

  it("steps down the whole chain one blank at a time, from the most specific", () => {
    const blanked = [
      chain,
      { ...chain, variantMenuPrice: null },
      { ...chain, variantMenuPrice: null, variantPrice: null },
      { ...chain, variantMenuPrice: null, variantPrice: null, parentMenuPrice: null },
    ];
    expect(blanked.map((prices) => resolveOfferPrice(prices))).toEqual([
      "6.00",
      "5.50",
      "4.50",
      "4.00",
    ]);
  });

  it("prices a product with no variant at its menu price, else its own", () => {
    const offer = { variantMenuPrice: null, variantPrice: null, parentPrice: decimal("4.00") };
    expect(resolveOfferPrice({ ...offer, parentMenuPrice: decimal("4.50") })).toBe("4.50");
    expect(resolveOfferPrice({ ...offer, parentMenuPrice: null })).toBe("4.00");
  });

  it("never skips a set value for a less specific one", () => {
    // The variant's own price is blank, its menu price is not: the menu price wins, not the
    // parent's menu price below it.
    expect(resolveOfferPrice({ ...chain, variantPrice: null })).toBe("6.00");
    // Only the parent's menu price is blank: the variant's own prices still win over the parent's.
    expect(resolveOfferPrice({ ...chain, parentMenuPrice: null })).toBe("6.00");
    expect(resolveOfferPrice({ ...chain, variantMenuPrice: null, parentMenuPrice: null })).toBe(
      "5.50",
    );
  });

  it("treats an override of zero as a price, not a blank", () => {
    expect(resolveOfferPrice({ ...chain, variantMenuPrice: decimal("0.00") })).toBe("0.00");
    expect(
      resolveOfferPrice({ ...chain, variantMenuPrice: null, variantPrice: decimal("0.00") }),
    ).toBe("0.00");
    expect(
      resolveOfferPrice({
        ...chain,
        variantMenuPrice: null,
        variantPrice: null,
        parentMenuPrice: decimal("0.00"),
      }),
    ).toBe("0.00");
  });
});
