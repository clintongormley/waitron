import { afterEach, describe, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./basket.js";
import type { TillBasket } from "./basket.js";
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

  it("a basket with diet & contains badges (dietary-classification, Task 7) has no violations", async () => {
    const store = new WorkingOrderStore();
    const salad: TillProduct = {
      ...cafe,
      id: "salad",
      descriptions: { es: "Ensalada" },
      dietDerivation: { origins: ["plant"], pending: false },
    };
    const meat: TillProduct = {
      ...cafe,
      id: "meat",
      descriptions: { es: "Chuleta" },
      dietDerivation: { origins: ["meat"], pending: false },
    };
    const mystery: TillProduct = {
      ...cafe,
      id: "mystery",
      descriptions: { es: "Plato del día" },
      dietDerivation: { origins: [], pending: true },
    };
    store.addProduct(salad, "1");
    store.addProduct(meat, "1");
    store.addProduct(mystery, "1");
    const { host } = await mountWidget<TillBasket>("till-basket", { store }, theme);
    await expectNoA11yViolations(host);
  });
});
