import { afterEach, describe, expect, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./tender-pay.js";
import type { TillTenderPay } from "./tender-pay.js";
import type { TillProduct } from "../api/client.js";
import { page } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";

const cafe: TillProduct = {
  id: "cafe",
  name: "Café",
  customerName: { es: "Café para el cliente" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

const jamon: TillProduct = {
  id: "jamon",
  name: "Jamón",
  customerName: { es: "Jamón para el cliente" },
  pricingUnit: "weight",
  unitPrice: "10.00",
  vatClass: "reduced",
  category: "charcutería",
  allergens: null,
};

afterEach(cleanupWidgets);

describe.each(["en-GB", "es-ES"])("A738 Park dialog %s", (locale) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([390, 1280])("fits its native controls and has no violations at %i", async (width) => {
      const before = { locale: currentLocale(), width: innerWidth, height: innerHeight };
      await page.viewport(width, width === 390 ? 844 : 800);
      setLocale(locale);
      try {
        const store = new WorkingOrderStore();
        store.addProduct({ ...cafe, name: "Staff coffee" }, "1");
        const { el, host } = await mountWidget<TillTenderPay>("till-tender-pay", { store }, theme);
        el.shadowRoot!.querySelector<HTMLElement>(".hold")!.click();
        await el.updateComplete;
        const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
        await dialog.updateComplete;
        const field = el.shadowRoot!.querySelector("wt-input")!;
        await field.updateComplete;
        const input = field.shadowRoot!.querySelector("input")!;
        expect(field.required).toBe(false);
        expect(input.value).toBe("");
        expect(field.shadowRoot!.activeElement).toBe(input);
        const label = field.shadowRoot!.querySelector<HTMLElement>(".field-label")!;
        const style = getComputedStyle(label);
        const measure = document.createElement("canvas").getContext("2d")!;
        measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        expect(label.clientWidth).toBeGreaterThanOrEqual(
          measure.measureText(label.textContent!).width,
        );
        expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true);
        const controls = [
          input,
          ...[...el.shadowRoot!.querySelectorAll("wt-button")].flatMap((button) => [
            ...button.shadowRoot!.querySelectorAll("button"),
          ]),
        ];
        for (const control of controls) {
          const box = control.getBoundingClientRect();
          expect(box.height).toBeGreaterThanOrEqual(
            parseFloat(getComputedStyle(el).getPropertyValue("--wt-tap-min")),
          );
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(width);
          expect(box.bottom).toBeLessThanOrEqual(innerHeight);
        }
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        await expectNoA11yViolations(host);
        await page.screenshot({
          path: `__screenshots__/a738-park/${locale}-${theme}-${width}.png`,
        });
      } finally {
        setLocale(before.locale);
        await page.viewport(before.width, before.height);
      }
    });
  });
});

describe.each(["light", "dark"] as const)("till-tender-pay a11y (%s theme)", (theme) => {
  it.each(["cash", "card"] as const)(
    "has no violations while reconciling an unanswered %s payment",
    async (method) => {
      const store = new WorkingOrderStore();
      const { host } = await mountWidget<TillTenderPay>(
        "till-tender-pay",
        {
          store,
          confirmation: {
            tender:
              method === "cash"
                ? { method, amount: "150.00" }
                : { method, amount: "120.00", externalRef: "operation-17" },
            outstanding: "120.00",
            guests: 4,
          },
        },
        theme,
      );
      await expectNoA11yViolations(host);
    },
  );

  it("has no violations in the idle Pay view", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { host } = await mountWidget<TillTenderPay>("till-tender-pay", { store }, theme);
    await expectNoA11yViolations(host);
  });

  it("has no violations in the idle Pay view with the guests field", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { host } = await mountWidget<TillTenderPay>(
      "till-tender-pay",
      { store, asksGuests: true, receiptGuests: 4 },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with the guests field empty", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { host } = await mountWidget<TillTenderPay>(
      "till-tender-pay",
      { store, asksGuests: true, receiptGuests: null },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with the guests field marked invalid", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { el, host } = await mountWidget<TillTenderPay>(
      "till-tender-pay",
      { store, asksGuests: true, receiptGuests: null },
      theme,
    );
    const stepper =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-number-stepper"]>('[name="guests"]')!;
    await stepper.updateComplete;
    const input = stepper.shadowRoot!.querySelector("input")!;
    input.value = "0";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>(".pay")!.click();
    await el.updateComplete;
    expect(stepper.error).not.toBe("");
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

  it("has no violations in the idle Pay view on a device that does not take cash", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { host } = await mountWidget<TillTenderPay>(
      "till-tender-pay",
      { store, takesCash: false },
      theme,
    );
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

  it("has no violations in the idle Pay view with Place order (Modes I/T, order stage)", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { host } = await mountWidget<TillTenderPay>(
      "till-tender-pay",
      { store, mode: "ticket_then_pay", stage: "order" },
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

  it("has no violations on the card outcome screen (Retry / Cancel)", async () => {
    const store = new WorkingOrderStore();
    const { host } = await mountWidget<TillTenderPay>(
      "till-tender-pay",
      { store, cardOutcome: { outcome: "declined" } },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it.each([{ outcome: "timeout" }, { outcome: "declined", failureReason: "lost_card" }] as const)(
    "has no violations on $outcome / $failureReason",
    async (cardOutcome) => {
      const { host } = await mountWidget<TillTenderPay>(
        "till-tender-pay",
        { store: new WorkingOrderStore(), cardOutcome },
        theme,
      );
      await expectNoA11yViolations(host);
    },
  );

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

  const readers = [
    { id: "r1", name: "Front counter", provider: "stripe_terminal" as const },
    { id: "r2", name: "Bar", provider: "stripe_terminal" as const, online: false },
  ];

  it("has no violations on the idle screen with the reader name + change-reader control shown", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { host } = await mountWidget<TillTenderPay>(
      "till-tender-pay",
      { store, cardProvider: "stripe_terminal", activeReaders: readers, defaultReaderId: "r1" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with the reader picker dialog open, including an offline-marked reader", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { el, host } = await mountWidget<TillTenderPay>(
      "till-tender-pay",
      { store, cardProvider: "stripe_terminal", activeReaders: readers, defaultReaderId: "r1" },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>(".change-reader")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
