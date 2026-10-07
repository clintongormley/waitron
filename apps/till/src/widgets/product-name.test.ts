import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../i18n/t.js";
import {
  customerProductName,
  lineProductName,
  productName,
  soldByTheUnit,
  unitName,
} from "./product-name.js";
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

  it("names the product alone — a chosen variant names only a line", () => {
    expect(productName(product({ variantId: "v1", variantName: "Large" }))).toBe("Coffee");
  });
});

describe("customerProductName", () => {
  it("reads an EXPLICIT locale over the current one — the printed sheet renders in the invoice locale", () => {
    setLocale("es-ES");
    setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] });
    expect(customerProductName(product(), "en")).toBe("Freshly ground coffee");
    expect(customerProductName(product(), "es")).toBe("Café recién hecho");
  });

  it("does not substitute another content language for the printed sheet's language", () => {
    setContentLanguages({ defaultLanguage: "ca", languages: ["ca", "en"] });
    expect(customerProductName(product({ customerName: { ca: "Cafè" } }), "en-GB")).toBe("Coffee");
    expect(
      customerProductName(product({ customerName: { en: "English coffee", ca: "Cafè" } }), "es-ES"),
    ).toBe("Coffee");
  });

  it("does not print stored customer text in a disabled language", () => {
    setContentLanguages({ defaultLanguage: "ca", languages: ["ca", "en"] });
    expect(
      customerProductName(
        product({ customerName: { es: "Café del cliente", en: "English coffee", ca: "Cafè" } }),
        "es-ES",
      ),
    ).toBe("Coffee");
  });

  it("uses the customer text when the requested enabled translation exists", () => {
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
  it("names the line by the product and variant STAFF names", () => {
    setLocale("es-ES");
    const line = product({
      variantId: "v1",
      variantName: "Large",
      variantCustomerName: { es: "Taza grande", en: "Large cup" },
    });
    expect(lineProductName(line)).toBe("Coffee (Large)");
  });

  it("names the product alone when no variant was chosen", () => {
    expect(lineProductName(product())).toBe("Coffee");
  });

  it("names the line by the variant's staff name even when the variant has no customer name", () => {
    expect(lineProductName(product({ variantId: "v1", variantName: "Small" }))).toBe(
      "Coffee (Small)",
    );
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

describe("soldByTheUnit", () => {
  const unit = (precision: number, hardwareUnit: "kg" | null) => ({
    id: "u1",
    name: { en: "unit" },
    abbreviation: { en: "u" },
    precision,
    hardwareUnit,
  });

  it("is true only for a whole-number unit no scale weighs", () => {
    expect(soldByTheUnit(product())).toBe(true);
    expect(soldByTheUnit(product({ pricingUnit: "weight" }))).toBe(false);
    expect(soldByTheUnit(product({ unit: unit(0, null) }))).toBe(true);
    expect(soldByTheUnit(product({ unit: unit(2, null) }))).toBe(false);
    expect(soldByTheUnit(product({ unit: unit(0, "kg") }))).toBe(false);
  });
});

describe("unit labels without ids", () => {
  it("labels the legacy each product in Spanish when Spanish is the only content language", () => {
    setLocale("es-ES");
    setContentLanguages({ defaultLanguage: "es", languages: ["es"] });
    expect(unitName(product())).toBe("ud");
  });

  it("labels the legacy weighed product in Spanish when Spanish is the only content language", () => {
    setLocale("es-ES");
    setContentLanguages({ defaultLanguage: "es", languages: ["es"] });
    expect(unitName(product({ pricingUnit: "weight" }))).toBe("kg");
  });

  it("uses the enabled full name when the abbreviation has no enabled text", () => {
    setContentLanguages({ defaultLanguage: "es", languages: ["es"] });
    expect(
      unitName(
        product({
          unit: {
            id: "d6a9d42f-9252-4a83-b722-0fd7f951e9a0",
            name: { es: "Caja" },
            abbreviation: { en: "box" },
            precision: 0,
            hardwareUnit: null,
          },
        }),
        "es-ES",
      ),
    ).toBe("Caja");
  });

  it("uses the content default abbreviation when the requested translation is missing", () => {
    setContentLanguages({ defaultLanguage: "en", languages: ["es", "en"] });
    expect(
      unitName(
        product({
          unit: {
            id: "d6a9d42f-9252-4a83-b722-0fd7f951e9a0",
            name: { en: "Box" },
            abbreviation: { en: "box" },
            precision: 0,
            hardwareUnit: null,
          },
        }),
        "es-ES",
      ),
    ).toBe("box");
  });

  it("returns no label when neither map holds enabled text", () => {
    setContentLanguages({ defaultLanguage: "es", languages: ["es"] });
    expect(
      unitName(
        product({
          unit: {
            id: "d6a9d42f-9252-4a83-b722-0fd7f951e9a0",
            name: { en: "Box" },
            abbreviation: { en: "box" },
            precision: 0,
            hardwareUnit: null,
          },
        }),
        "es-ES",
      ),
    ).toBe("");
  });
});
