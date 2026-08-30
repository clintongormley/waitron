import { afterEach, describe, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./product-grid.js";
import type { TillProductGrid } from "./product-grid.js";
import type { TillProduct } from "../api/client.js";

const cafe: TillProduct = {
  id: "cafe",
  descriptions: { es: "Café" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

const jamon: TillProduct = {
  id: "jamon",
  descriptions: { es: "Jamón" },
  pricingUnit: "weight",
  unitPrice: "10.00",
  vatClass: "reduced",
  category: "charcutería",
  allergens: null,
};

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-product-grid a11y (%s theme)", (theme) => {
  it("a grid of each and weight tiles has no violations", async () => {
    const store = new WorkingOrderStore();
    const { host } = await mountWidget<TillProductGrid>(
      "till-product-grid",
      { products: [cafe, jamon], store },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
