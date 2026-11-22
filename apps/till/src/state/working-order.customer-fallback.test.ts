import { describe, expect, it } from "vitest";
import { WorkingOrderStore } from "./working-order.js";

describe("WorkingOrderStore.addProduct", () => {
  it("totals a product without changing its source facts", () => {
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
    const store = new WorkingOrderStore();
    store.addProduct(product, "2");
    expect(store.total).toBe("24.20");
    expect(product).toEqual(before);
  });
});
