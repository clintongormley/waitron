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

  it("has no violations in the idle Place view (Modes I/T, order stage)", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { host } = await mountWidget<TillTenderPay>(
      "till-tender-pay",
      { store, mode: "invoice_first", stage: "order" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations in the idle Collect view (Modes I/T, collect stage)", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { host } = await mountWidget<TillTenderPay>(
      "till-tender-pay",
      { store, mode: "ticket_then_pay", stage: "collect" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  // Integrated card terminal (sub-project 7, Task 9): the collecting spinner (entered via a real
  // Card tap) and the card_outcome screen (entered reactively off `cardOutcome`, driven directly into
  // the state below rather than through a round trip — see the widget's own `willUpdate` doc), plus
  // the idle-screen tip/offline-consent affordances, in BOTH themes.
  it("has no violations on the collecting screen (integrated card, entered via a real Card tap)", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { el, host } = await mountWidget<TillTenderPay>(
      "till-tender-pay",
      { store, cardProvider: "stripe_terminal" },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>(".pay-card")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations on the card_outcome screen (retry / switch-tender / wait)", async () => {
    const store = new WorkingOrderStore();
    const { host } = await mountWidget<TillTenderPay>(
      "till-tender-pay",
      { store, cardOutcome: "declined" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations on the idle screen with the tip field and offline-consent toggle shown", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { host } = await mountWidget<TillTenderPay>(
      "till-tender-pay",
      { store, cardProvider: "stripe_on_device", tipsEnabled: true },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
