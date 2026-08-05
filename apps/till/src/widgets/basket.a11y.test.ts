import { afterEach, describe, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./basket.js";
import type { TillBasket } from "./basket.js";
import type { TillProduct } from "../api/client.js";

const cafe: TillProduct = {
  id: "cafe",
  descriptions: { "es-ES": "Café" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
};

const jamon: TillProduct = {
  id: "jamon",
  descriptions: { "es-ES": "Jamón" },
  pricingUnit: "weight",
  unitPrice: "10.00",
  vatClass: "reduced",
  category: "charcutería",
};

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-basket a11y (%s theme)", (theme) => {
  it("an empty basket has no violations", async () => {
    const store = new WorkingOrderStore();
    const { host } = await mountWidget<TillBasket>("till-basket", { store }, theme);
    await expectNoA11yViolations(host);
  });

  it("a populated basket (with remove controls) has no violations", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    store.addProduct(jamon, "0.320");
    const { host } = await mountWidget<TillBasket>("till-basket", { store }, theme);
    await expectNoA11yViolations(host);
  });
});
