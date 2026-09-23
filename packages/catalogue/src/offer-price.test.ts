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

  it("never skips a set value for a less specific one", () => {
    // The variant's own price is blank, its menu price is not: the menu price wins, not the
    // parent's menu price below it.
    expect(resolveOfferPrice({ ...chain, variantPrice: null })).toBe("6.00");
  });

  it("treats an override of zero as a price, not a blank", () => {
    expect(resolveOfferPrice({ ...chain, variantMenuPrice: decimal("0.00") })).toBe("0.00");
    expect(
      resolveOfferPrice({ ...chain, variantMenuPrice: null, variantPrice: decimal("0.00") }),
    ).toBe("0.00");
  });
});
