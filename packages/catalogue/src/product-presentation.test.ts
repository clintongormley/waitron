import { describe, expect, test } from "vitest";
import {
  staffPresentationName,
  customerPresentationText,
  joinCustomerPresentationText,
  kitchenPresentationName,
  type ProductPresentation,
} from "./product-presentation.js";

const full: ProductPresentation = {
  name: "Coffee",
  customerName: { en: "Fresh Coffee", es: "Café recién hecho" },
  kitchenName: "COF",
  variantName: "Large",
  variantCustomerName: { en: "Large cup", es: "Taza grande" },
  variantKitchenName: "LG",
};

describe("staffPresentationName", () => {
  test("joins product and variant staff names", () => {
    expect(staffPresentationName(full)).toBe("Coffee · Large");
  });
  test("product only when no variant", () => {
    expect(staffPresentationName({ ...full, variantName: null })).toBe("Coffee");
  });
});

describe("customerPresentationText", () => {
  test("uses the customer name maps as-is", () => {
    expect(customerPresentationText(full, "en")).toEqual({
      product: { en: "Fresh Coffee", es: "Café recién hecho" },
      variant: { en: "Large cup", es: "Taza grande" },
    });
  });
  test("falls back to staff name under the default language when customer name is blank", () => {
    expect(
      customerPresentationText({ ...full, customerName: null, variantCustomerName: null }, "en"),
    ).toEqual({
      product: { en: "Coffee" },
      variant: { en: "Large" },
    });
  });
});

describe("joinCustomerPresentationText", () => {
  test("joins the two frozen maps per locale", () => {
    const { product, variant } = customerPresentationText(full, "en");
    expect(joinCustomerPresentationText(product, variant)).toEqual({
      en: "Fresh Coffee · Large cup",
      es: "Café recién hecho · Taza grande",
    });
  });
  test("a line naming no variant keeps the product map unchanged", () => {
    const { product, variant } = customerPresentationText({ ...full, variantName: null }, "en");
    expect(variant).toBeNull();
    expect(joinCustomerPresentationText(product, variant)).toEqual({
      en: "Fresh Coffee",
      es: "Café recién hecho",
    });
  });
  test("carries each side's own frozen fallback through", () => {
    const { product, variant } = customerPresentationText(
      { ...full, customerName: null, variantCustomerName: null },
      "en",
    );
    expect(joinCustomerPresentationText(product, variant)).toEqual({ en: "Coffee · Large" });
  });
  test("a locale on one side only takes the other side's stored language rather than a blank half", () => {
    expect(joinCustomerPresentationText({ en: "Coffee", es: "Café" }, { en: "Large" })).toEqual({
      en: "Coffee · Large",
      es: "Café · Large",
    });
  });
  test("a variant map with nothing in it leaves the product text alone", () => {
    expect(joinCustomerPresentationText({ en: "Coffee" }, { en: "  " })).toEqual({ en: "Coffee" });
  });
});

describe("kitchenPresentationName", () => {
  test("uses kitchen names, joined", () => {
    expect(kitchenPresentationName(full)).toBe("COF · LG");
  });
  test("falls back to staff names when kitchen names are blank", () => {
    expect(kitchenPresentationName({ ...full, kitchenName: null, variantKitchenName: null })).toBe(
      "Coffee · Large",
    );
  });
});
