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
  test("names a variant line by the variant's staff name alone", () => {
    expect(staffPresentationName(full)).toBe("Large");
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
  test("names a variant line by the variant's frozen customer text in each locale", () => {
    const { product, variant } = customerPresentationText(full, "en");
    expect(joinCustomerPresentationText(product, variant, full.variantName)).toEqual({
      en: "Large cup",
      es: "Taza grande",
    });
  });
  test("a line naming no variant keeps the product map unchanged", () => {
    const { product, variant } = customerPresentationText({ ...full, variantName: null }, "en");
    expect(variant).toBeNull();
    expect(joinCustomerPresentationText(product, variant, null)).toEqual({
      en: "Fresh Coffee",
      es: "Café recién hecho",
    });
  });
  test("carries the variant's own frozen fallback through, never the product's", () => {
    const { product, variant } = customerPresentationText(
      { ...full, customerName: null, variantCustomerName: null },
      "en",
    );
    expect(joinCustomerPresentationText(product, variant, full.variantName)).toEqual({
      en: "Large",
    });
  });
  test("a locale the variant map lacks takes the variant's stored language, not the product's text", () => {
    expect(
      joinCustomerPresentationText({ en: "Coffee", es: "Café" }, { en: "Large" }, "Large"),
    ).toEqual({
      en: "Large",
      es: "Large",
    });
  });
  test("a variant map with nothing in it falls back to the variant's staff name", () => {
    expect(joinCustomerPresentationText({ en: "Coffee" }, { en: "  " }, "Large")).toEqual({
      en: "Large",
    });
  });
  test("a variant map with nothing in it and no variant name leaves the product text alone", () => {
    expect(joinCustomerPresentationText({ en: "Coffee" }, { en: "  " }, null)).toEqual({
      en: "Coffee",
    });
  });
});

describe("kitchenPresentationName", () => {
  test("names a variant line by the variant's kitchen name alone", () => {
    expect(kitchenPresentationName(full)).toBe("LG");
  });
  test("falls back to the variant's staff name, never the product's kitchen name", () => {
    expect(kitchenPresentationName({ ...full, variantKitchenName: null })).toBe("Large");
    expect(kitchenPresentationName({ ...full, kitchenName: null, variantKitchenName: null })).toBe(
      "Large",
    );
  });
  test("names a line with no variant by the product's kitchen name, else its staff name", () => {
    const plain = { ...full, variantName: null, variantKitchenName: null };
    expect(kitchenPresentationName(plain)).toBe("COF");
    expect(kitchenPresentationName({ ...plain, kitchenName: " " })).toBe("Coffee");
  });
});
