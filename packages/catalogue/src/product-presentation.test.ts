import { describe, expect, test } from "vitest";
import {
  staffPresentationName,
  customerPresentationText,
  fillBlankLocalesWithStaffName,
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
  test("names a variant line by the product and variant staff names", () => {
    expect(staffPresentationName(full)).toBe("Coffee (Large)");
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
  test("joins independently frozen customer texts in each locale", () => {
    const { product, variant } = customerPresentationText(full, "en");
    expect(joinCustomerPresentationText(product, variant, full.variantName)).toEqual({
      en: "Fresh Coffee (Large cup)",
      es: "Café recién hecho (Taza grande)",
    });
  });
  test.each<Readonly<Record<string, string>>>([{}, { en: " " }])(
    "keeps a variant readable when the frozen product map has no text: %j",
    (product) => {
      expect(joinCustomerPresentationText(product, { en: "Double" }, "Double")).toEqual({
        en: "Double",
      });
    },
  );
  test("a line naming no variant keeps the product map unchanged", () => {
    const { product, variant } = customerPresentationText({ ...full, variantName: null }, "en");
    expect(variant).toBeNull();
    expect(joinCustomerPresentationText(product, variant, null)).toEqual({
      en: "Fresh Coffee",
      es: "Café recién hecho",
    });
  });
  test("joins each half's own frozen staff fallback", () => {
    const { product, variant } = customerPresentationText(
      { ...full, customerName: null, variantCustomerName: null },
      "en",
    );
    expect(joinCustomerPresentationText(product, variant, full.variantName)).toEqual({
      en: "Coffee (Large)",
    });
  });
  test("resolves a missing variant locale independently before joining the parent", () => {
    expect(
      joinCustomerPresentationText({ en: "Coffee", es: "Café" }, { en: "Large cup" }, "Large"),
    ).toEqual({
      en: "Coffee (Large cup)",
      es: "Café (Large cup)",
    });
  });
  test("a variant map with nothing in it falls back to the variant's staff name", () => {
    expect(joinCustomerPresentationText({ en: "Coffee" }, { en: "  " }, "Large")).toEqual({
      en: "Coffee (Large)",
    });
  });
  test("a variant map with nothing in it and no variant name leaves the product text alone", () => {
    expect(joinCustomerPresentationText({ en: "Coffee" }, { en: "  " }, null)).toEqual({
      en: "Coffee",
    });
  });
});

describe("kitchenPresentationName", () => {
  test("names a variant line by the product and variant kitchen names", () => {
    expect(kitchenPresentationName(full)).toBe("COF (LG)");
  });
  test("falls back independently to each half's staff name", () => {
    expect(kitchenPresentationName({ ...full, variantKitchenName: null })).toBe("COF (Large)");
    expect(kitchenPresentationName({ ...full, kitchenName: null, variantKitchenName: null })).toBe(
      "Coffee (Large)",
    );
  });
  test("names a line with no variant by the product's kitchen name, else its staff name", () => {
    const plain = { ...full, variantName: null, variantKitchenName: null };
    expect(kitchenPresentationName(plain)).toBe("COF");
    expect(kitchenPresentationName({ ...plain, kitchenName: " " })).toBe("Coffee");
  });
});

describe("fillBlankLocalesWithStaffName", () => {
  test("gives each blank locale the staff name and keeps every stored text as it is", () => {
    expect(fillBlankLocalesWithStaffName({ en: "Large cup", es: "  ", fr: "" }, "Large")).toEqual({
      en: "Large cup",
      es: "Large",
      fr: "Large",
    });
  });
});
