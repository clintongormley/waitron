import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../i18n/t.js";
import { productName } from "./product-name.js";
import type { TillProduct } from "../api/client.js";

function product(descriptions: Record<string, string>): TillProduct {
  return {
    id: "p1",
    descriptions,
    pricingUnit: "each",
    unitPrice: "1.00",
    vatClass: "general",
    category: null,
    allergens: null,
  };
}

// setLocale mutates module-level state; put it back so the default the other suites rely on holds.
afterEach(() => setLocale("es-ES"));

describe("productName", () => {
  it("uses the current locale's description", () => {
    setLocale("es-ES");
    expect(productName(product({ "es-ES": "Café", en: "Coffee" }))).toBe("Café");
  });

  it("falls back to any available description when the current locale is missing", () => {
    setLocale("es-ES");
    expect(productName(product({ en: "Coffee" }))).toBe("Coffee");
  });

  it("falls back to the product id when there is no description at all", () => {
    expect(productName(product({}))).toBe("p1");
  });

  it("reads an EXPLICIT locale over the current one — the legal receipt renders in the invoice locale", () => {
    // The operator UI is Spanish, but the ticket asks for the English description by locale: names
    // are data keyed by locale, so passing one overrides the module-level current locale.
    setLocale("es-ES");
    expect(productName(product({ "es-ES": "Café", en: "Coffee" }), "en")).toBe("Coffee");
  });
});
