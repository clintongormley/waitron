import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./till-counter-screen.js";
import type { TillCounterScreen } from "./till-counter-screen.js";
import { WorkingOrderStore } from "../state/working-order.js";
import type { TillProduct } from "../api/client.js";

const products: TillProduct[] = [
  {
    id: "p1",
    descriptions: { "es-ES": "Café" },
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "general",
    category: null,
  },
  {
    id: "p2",
    descriptions: { "es-ES": "Jamón" },
    pricingUnit: "weight",
    unitPrice: "20.00",
    vatClass: "reduced",
    category: null,
  },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-counter-screen a11y (%s theme)", (theme) => {
  it("has no violations composing the four widgets over an empty basket", async () => {
    const { host } = await mountWidget<TillCounterScreen>(
      "till-counter-screen",
      { store: new WorkingOrderStore(), products, operatorName: "Ana" },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
