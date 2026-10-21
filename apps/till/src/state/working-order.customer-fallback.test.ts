import { afterEach, describe, expect, it, vi } from "vitest";
import { priceBasket } from "@waitron/catalogue/src/pricing.js";
import { currentContentLanguages, setContentLanguages } from "@waitron/ui";
import { WorkingOrderStore } from "./working-order.js";

const original = currentContentLanguages();
afterEach(() => {
  setContentLanguages(original);
});

describe("till future customer preparation", () => {
  it("passes independently resolved names and staff units to real pricing without changing source facts", () => {
    setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
    const product = {
      id: "dish",
      name: "Staff dish",
      customerName: { fr: "Other dish" },
      variantId: "variant",
      variantName: "Staff large",
      variantCustomerName: { es: "Requested large" },
      unitPrice: "12.10",
      vatClass: "general" as const,
      category: null,
      allergens: null,
      unit: {
        id: "unit",
        staffName: "Staff portion",
        staffAbbreviation: "sp",
        name: { fr: "Other portion" },
        abbreviation: { fr: "op" },
        precision: 0,
        hardwareUnit: null,
      },
    };
    const before = structuredClone(product);
    const price = vi.fn(priceBasket);
    const store = new WorkingOrderStore(price);
    store.addProduct(product, "2");
    expect(store.vatBreakdown).toEqual([{ rate: "21.00", base: "20.00", tax: "4.20" }]);
    expect(store.total).toBe("24.20");
    const [basket] = price.mock.calls.at(-1)!;
    expect(basket[0]!.product.descriptions).toEqual({
      fr: "Other dish",
      en: "Staff dish",
      es: "Staff dish",
    });
    expect(basket[0]!.product.variantDescriptions).toEqual({
      es: "Requested large",
      en: "Staff large",
    });
    expect(basket[0]!.product.unit.abbreviation).toEqual({ en: "sp" });
    expect(product).toEqual(before);
  });
});
