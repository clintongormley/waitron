import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../i18n/t.js";
import { productName } from "./product-name.js";
import type { TillProduct } from "../api/client.js";
import { setContentLanguages } from "@waitron/ui";

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
beforeEach(() => setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] }));

afterEach(() => {
  setLocale("es-ES");
  setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
});

describe("productName", () => {
  it("uses the site default for a missing translation regardless of object order", () => {
    setLocale("fr-FR");
    setContentLanguages({ defaultLanguage: "es", languages: ["es", "fr", "en"] });
    expect(productName(product({ en: "Bread", es: "Pan" }))).toBe("Pan");
  });
  it("uses the current locale's description", () => {
    setLocale("es-ES");
    expect(productName(product({ "es-ES": "Café", en: "Coffee" }))).toBe("Café");
  });

  it("region-strips es-ES to bare es for BARE-keyed catalogue content (Feature B)", () => {
    // /api/products returns bare-keyed content ({ en, es }); `en` is first, so without the
    // region-strip tier this would resolve Object.values()[0] = "Coffee" under the es-ES till.
    setLocale("es-ES");
    expect(productName(product({ en: "Coffee", es: "Café" }))).toBe("Café");
  });

  it("falls back to the configured English default when the current locale is missing", () => {
    setLocale("es-ES");
    setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
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
