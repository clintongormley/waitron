import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../i18n/t.js";
import { customerProductName, lineProductName, productName, unitName } from "./product-name.js";
import type { TillProduct } from "../api/client.js";
import { setContentLanguages } from "@waitron/ui";

/**
 * The staff name and the customer name are DELIBERATELY different text in every fixture here. With
 * the same text on both a test cannot tell which one the till rendered, and the assertion would hold
 * whichever the code picked.
 */
function product(over: Partial<TillProduct> = {}): TillProduct {
  return {
    id: "p1",
    name: "Coffee",
    customerName: { es: "Café recién hecho", en: "Freshly ground coffee" },
    pricingUnit: "each",
    unitPrice: "1.00",
    vatClass: "general",
    category: null,
    allergens: null,
    ...over,
  };
}

// setLocale mutates module-level state; put it back so the default the other suites rely on holds.
beforeEach(() => setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] }));

afterEach(() => {
  setLocale("es-ES");
  setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
});

describe("productName", () => {
  it("renders the staff name, not the customer translation for the current locale", () => {
    setLocale("es-ES");
    expect(productName(product())).toBe("Coffee");
  });

  it("renders the staff name under every content-language setting", () => {
    // The staff name is plain text, so nothing about the enabled languages or the site default can
    // move it. Both halves would read "Café recién hecho" if the customer map were consulted.
    setLocale("fr-FR");
    setContentLanguages({ defaultLanguage: "es", languages: ["es", "fr", "en"] });
    expect(productName(product())).toBe("Coffee");
    setLocale("en-GB");
    setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
    expect(productName(product())).toBe("Coffee");
  });

  it("renders the staff name for a product with no customer name at all", () => {
    expect(productName(product({ customerName: null }))).toBe("Coffee");
  });

  it("names the product alone — a chosen variant is joined only onto a line", () => {
    expect(productName(product({ variantId: "v1", variantName: "Large" }))).toBe("Coffee");
  });
});

describe("customerProductName", () => {
  it("reads an EXPLICIT locale over the current one — the printed sheet renders in the invoice locale", () => {
    // The operator UI is Spanish, but the printed allergen sheet asks for the English customer text
    // by locale: customer names are data keyed by locale, so passing one overrides the module-level
    // current locale. This is the assertion the old `productName(product, "en")` test made.
    setLocale("es-ES");
    setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] });
    expect(customerProductName(product(), "en")).toBe("Freshly ground coffee");
    expect(customerProductName(product(), "es")).toBe("Café recién hecho");
  });

  it("is the CUSTOMER text, never the staff name, whenever the product has one", () => {
    expect(customerProductName(product(), "es")).not.toBe("Coffee");
  });

  it("falls back to the staff name when the product has no customer text at all", () => {
    expect(customerProductName(product({ customerName: null }), "en")).toBe("Coffee");
  });

  it("falls back to the staff name when the customer map is blank", () => {
    expect(customerProductName(product({ customerName: { es: "  " } }), "es")).toBe("Coffee");
  });
});

describe("lineProductName", () => {
  it("names the line by the variant's STAFF name alone", () => {
    setLocale("es-ES");
    const line = product({
      variantId: "v1",
      variantName: "Large",
      variantCustomerName: { es: "Taza grande", en: "Large cup" },
    });
    expect(lineProductName(line)).toBe("Large");
  });

  it("names the product alone when no variant was chosen", () => {
    expect(lineProductName(product())).toBe("Coffee");
  });

  it("names the line by the variant's staff name even when the variant has no customer name", () => {
    expect(lineProductName(product({ variantId: "v1", variantName: "Small" }))).toBe("Small");
  });
});

describe("unitName", () => {
  beforeEach(() => {
    setLocale("en-GB");
    setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
  });

  it("labels a product with its unit's abbreviation, not the full name", () => {
    const p: TillProduct = {
      ...product(),
      unit: {
        id: "u",
        name: { en: "Kilogram" },
        abbreviation: { en: "kg" },
        precision: 3,
        hardwareUnit: "kg",
      },
    };
    expect(unitName(p)).toBe("kg");
  });

  it("falls back to a synthesised weight abbreviation when the product carries no unit", () => {
    const p = { ...product(), pricingUnit: "weight" as const };
    expect(unitName(p)).toBe("kg");
  });

  it("falls back to the each abbreviation for a non-weight product with no unit", () => {
    // product() defaults pricingUnit to "each".
    expect(unitName(product())).toBe("ea");
  });
});
