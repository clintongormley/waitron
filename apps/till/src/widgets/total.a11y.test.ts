import { afterEach, describe, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./total.js";
import type { TillTotal } from "./total.js";
import type { TillProduct } from "../api/client.js";

const cafe: TillProduct = {
  id: "cafe",
  descriptions: { "es-ES": "Café" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
};

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-total a11y (%s theme)", (theme) => {
  it("has no violations showing a total", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { host } = await mountWidget<TillTotal>("till-total", { store }, theme);
    await expectNoA11yViolations(host);
  });
});
