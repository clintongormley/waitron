import { afterEach, describe, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./tender-pay.js";
import type { TillTenderPay } from "./tender-pay.js";
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

describe.each(["light", "dark"] as const)("till-tender-pay a11y (%s theme)", (theme) => {
  it("has no violations in the idle Pay view", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { host } = await mountWidget<TillTenderPay>("till-tender-pay", { store }, theme);
    await expectNoA11yViolations(host);
  });

  it("has no violations on the cash screen", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { el, host } = await mountWidget<TillTenderPay>("till-tender-pay", { store }, theme);
    el.shadowRoot!.querySelector<HTMLElement>(".pay")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations on the weigh screen", async () => {
    const store = new WorkingOrderStore();
    const { el, host } = await mountWidget<TillTenderPay>("till-tender-pay", { store }, theme);
    store.emit("product-selected", jamon);
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations on the hold label prompt", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { el, host } = await mountWidget<TillTenderPay>("till-tender-pay", { store }, theme);
    el.shadowRoot!.querySelector<HTMLElement>(".hold")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations on the card screen (operation-number field has an accessible name)", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { el, host } = await mountWidget<TillTenderPay>("till-tender-pay", { store }, theme);
    el.shadowRoot!.querySelector<HTMLElement>(".pay-card")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
