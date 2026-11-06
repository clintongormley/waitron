import { describe, expect, it } from "vitest";
import { isProductOrdering, PRODUCT_ORDERINGS } from "./product-ordering.js";

describe("isProductOrdering", () => {
  it("accepts each ordering, in their stored order", () => {
    expect(PRODUCT_ORDERINGS).toEqual(["public", "staff_only", "not_sold_separately"]);
    for (const ordering of PRODUCT_ORDERINGS) expect(isProductOrdering(ordering)).toBe(true);
  });

  it("refuses anything else", () => {
    for (const value of ["Public", "", null, undefined, 1, ["public"]]) {
      expect(isProductOrdering(value)).toBe(false);
    }
  });
});
