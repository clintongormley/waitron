import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillTenderPay } from "./tender-pay.js";
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

/** Taps one keypad key inside the widget and lets the parent re-render with the new value. */
async function press(el: TillTenderPay, key: string): Promise<void> {
  const pad = el.shadowRoot!.querySelector("till-numeric-pad")!;
  await (pad as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  pad.shadowRoot!.querySelector<HTMLElement>(`[data-key="${key}"]`)!.click();
  await el.updateComplete;
}

/** Taps a string of keys in order — each character is a `data-key` on the pad. */
async function type(el: TillTenderPay, keys: string): Promise<void> {
  for (const key of keys) await press(el, key);
}

/** Types free text into a `wt-input` (matched by `selector`) by driving its inner `<input>`. */
async function typeInput(el: TillTenderPay, selector: string, text: string): Promise<void> {
  const input = el.shadowRoot!.querySelector(selector) as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await input.updateComplete;
  const inner = input.shadowRoot!.querySelector("input")!;
  inner.value = text;
  inner.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

/** Types free text into the hold-label field. */
const typeLabel = (el: TillTenderPay, text: string) => typeInput(el, ".label-input", text);
/** Types free text into the card operation-number (externalRef) field. */
const typeRef = (el: TillTenderPay, text: string) => typeInput(el, ".ref-input", text);

const query = (el: TillTenderPay, selector: string) => el.shadowRoot!.querySelector(selector);
const click = (el: TillTenderPay, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();

afterEach(cleanupWidgets);

describe("till-tender-pay", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-tender-pay")).toBe(TillTenderPay);
  });

  it("disables Pay when the basket is empty", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    expect(query(el, ".pay")!.hasAttribute("disabled")).toBe(true);
    expect(el.shadowRoot!.textContent).toContain(t("action.pay"));
  });

  it("enables Pay once a line is rung up, reacting to store changes", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    store.addProduct(cafe, "2");
    await el.updateComplete;
    expect(query(el, ".pay")!.hasAttribute("disabled")).toBe(false);
  });

  it("opens the cash screen showing the total when Pay is tapped", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2"); // total 3.00
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    click(el, ".pay");
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain(t("label.total"));
    expect(el.shadowRoot!.textContent).toContain(formatMoney("3.00"));
    expect(el.shadowRoot!.textContent).toContain(t("tender.cash"));
    expect(query(el, "till-numeric-pad")).not.toBeNull();
  });

  it("shows the change once the tendered amount reaches the total", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2"); // total 3.00
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    click(el, ".pay");
    await el.updateComplete;
    await type(el, "5"); // tendered 5 → change 2.00
    expect(el.shadowRoot!.textContent).toContain(t("label.change"));
    expect(query(el, ".change")!.textContent).toContain(formatMoney("2.00"));
  });

  it("hides the change while the tender is short", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2"); // total 3.00
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    click(el, ".pay");
    await el.updateComplete;
    await type(el, "2"); // 2 < 3.00
    expect(query(el, ".change")).toBeNull();
  });

  it("disables Confirm while the tender is short and enables it at/above the total", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2"); // total 3.00
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    click(el, ".pay");
    await el.updateComplete;
    await type(el, "2");
    expect(query(el, ".confirm")!.hasAttribute("disabled")).toBe(true);
    await press(el, "backspace"); // entry back to ""
    await type(el, "3"); // exactly the total
    expect(query(el, ".confirm")!.hasAttribute("disabled")).toBe(false);
  });

  it("emits confirm-payment with the full operator-entered tendered amount", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2"); // total 3.00
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    const spy = vi.fn();
    el.addEventListener("confirm-payment", (e) => spy((e as CustomEvent).detail));
    click(el, ".pay");
    await el.updateComplete;
    await type(el, "5"); // tendered 5, not the 3.00 total
    click(el, ".confirm");
    expect(spy).toHaveBeenCalledWith({ method: "cash", amount: "5" });
  });

  it("does not emit confirm-payment for a short tender even if Confirm is force-clicked", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2"); // total 3.00
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    const spy = vi.fn();
    el.addEventListener("confirm-payment", () => spy());
    click(el, ".pay");
    await el.updateComplete;
    await type(el, "2"); // short
    click(el, ".confirm"); // disabled visually; host.click() bypasses that, the guard must not emit
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns to idle after a confirmed payment", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    click(el, ".pay");
    await el.updateComplete;
    await type(el, "5");
    click(el, ".confirm");
    await el.updateComplete;
    expect(query(el, ".pay")).not.toBeNull();
    expect(query(el, "till-numeric-pad")).toBeNull();
  });

  it("disables Pay while busy (a sale is in flight), even with a rung-up basket", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2"); // Pay would otherwise be enabled
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store, busy: true });
    // busy is the visible half of the app-level single-flight guard; dropping `|| this.busy` here
    // enables Pay mid-submit (the deletion proof).
    expect(query(el, ".pay")!.hasAttribute("disabled")).toBe(true);
  });

  it("disables Confirm while busy even when the tender covers the total", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2"); // total 3.00
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    click(el, ".pay");
    await el.updateComplete;
    await type(el, "5"); // tender ≥ total → Confirm normally enabled
    expect(query(el, ".confirm")!.hasAttribute("disabled")).toBe(false);
    el.busy = true;
    await el.updateComplete;
    expect(query(el, ".confirm")!.hasAttribute("disabled")).toBe(true);
  });

  it("guards a double Add: two rapid clicks before re-render ring the weighed line ONCE", async () => {
    const store = new WorkingOrderStore();
    const addSpy = vi.spyOn(store, "addProduct");
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    store.emit("product-selected", jamon);
    await el.updateComplete;
    await type(el, "0.320");
    // Two synchronous clicks before Lit re-renders: the first flips mode to "idle" BEFORE addProduct,
    // so the second (against the still-mounted button, product captured in its closure) is a no-op.
    // Deleting the `if (this.mode !== "weighing") return` guard rings the line twice.
    click(el, ".add");
    click(el, ".add");
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(store.lines).toHaveLength(1);
  });

  it("returns to idle from the cash screen when Cancel is tapped, emitting nothing", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    const spy = vi.fn();
    el.addEventListener("confirm-payment", () => spy());
    click(el, ".pay");
    await el.updateComplete;
    await type(el, "5"); // a tender is part-entered
    click(el, ".cancel");
    await el.updateComplete;
    expect(query(el, ".pay")).not.toBeNull(); // back to the idle Pay button
    expect(query(el, "till-numeric-pad")).toBeNull();
    expect(spy).not.toHaveBeenCalled(); // Cancel never settles the sale
    expect(store.lines).toHaveLength(1); // basket untouched
  });

  it("returns to idle from the weigh screen when Cancel is tapped, adding no line", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    store.emit("product-selected", jamon);
    await el.updateComplete;
    await type(el, "0.320");
    click(el, ".cancel");
    await el.updateComplete;
    expect(query(el, ".pay")).not.toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain(t("weigh.prompt"));
    expect(store.lines).toHaveLength(0); // the weighed product was not rung up
  });

  it("prompts for kg when a weight product is selected", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    store.emit("product-selected", jamon);
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain(t("weigh.prompt"));
    expect(query(el, "till-numeric-pad")).not.toBeNull();
  });

  it("ignores a non-weight product selection", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    store.emit("product-selected", cafe); // an `each` product never weighs
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).not.toContain(t("weigh.prompt"));
    expect(query(el, ".pay")).not.toBeNull(); // still idle
  });

  it("adds a weight line via the store and returns to idle", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    store.emit("product-selected", jamon);
    await el.updateComplete;
    await type(el, "0.320");
    click(el, ".add");
    await el.updateComplete;
    expect(store.lines).toHaveLength(1);
    expect(store.lines[0]!.product).toBe(jamon);
    expect(store.lines[0]!.quantity).toBe("0.320");
    expect(query(el, ".pay")).not.toBeNull();
  });

  it("disables Add and refuses a zero or empty weight", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    store.emit("product-selected", jamon);
    await el.updateComplete;
    expect(query(el, ".add")!.hasAttribute("disabled")).toBe(true); // empty
    click(el, ".add"); // force-click the disabled Add: the guard must no-op
    await el.updateComplete;
    expect(store.lines).toHaveLength(0);
    await type(el, "0"); // an explicit zero is still non-positive
    expect(query(el, ".add")!.hasAttribute("disabled")).toBe(true);
    click(el, ".add");
    expect(store.lines).toHaveLength(0);
  });

  it("shows a Hold button in the idle view, disabled on an empty basket", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    expect(query(el, ".hold")!.hasAttribute("disabled")).toBe(true);
    expect(el.shadowRoot!.textContent).toContain(t("action.hold"));
  });

  it("enables Hold once a line is rung up, reacting to store changes", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    store.addProduct(cafe, "2");
    await el.updateComplete;
    expect(query(el, ".hold")!.hasAttribute("disabled")).toBe(false);
  });

  it("disables Hold while busy (a sale is in flight), even with a rung-up basket", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2"); // Hold would otherwise be enabled
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store, busy: true });
    // Same visible half of the single-flight guard as Pay: a sale in flight disables Hold too, so an
    // order cannot be parked mid-settle. Dropping `|| this.busy` here enables Hold — the deletion proof.
    expect(query(el, ".hold")!.hasAttribute("disabled")).toBe(true);
  });

  it("opens the label prompt when Hold is tapped", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    click(el, ".hold");
    await el.updateComplete;
    expect(query(el, ".label-input")).not.toBeNull();
    expect(query(el, ".park")).not.toBeNull();
    expect(query(el, ".pay")).toBeNull(); // the idle Pay button is replaced by the prompt view
  });

  it("emits park-order with the entered label", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    const spy = vi.fn();
    el.addEventListener("park-order", (e) => spy((e as CustomEvent).detail));
    click(el, ".hold");
    await el.updateComplete;
    await typeLabel(el, "Mesa 4");
    click(el, ".park");
    expect(spy).toHaveBeenCalledWith({ label: "Mesa 4" });
  });

  it("emits park-order with no label when the field is left empty", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    const spy = vi.fn();
    el.addEventListener("park-order", (e) => spy((e as CustomEvent).detail));
    click(el, ".hold");
    await el.updateComplete;
    click(el, ".park"); // no label typed — the label is optional
    expect(spy).toHaveBeenCalledWith({ label: undefined });
  });

  it("returns to idle after Hold is confirmed", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    click(el, ".hold");
    await el.updateComplete;
    click(el, ".park");
    await el.updateComplete;
    expect(query(el, ".pay")).not.toBeNull(); // back to the idle view (the app clears the basket)
    expect(query(el, ".label-input")).toBeNull();
  });

  it("returns to idle from the label prompt when Cancel is tapped, emitting nothing", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    const spy = vi.fn();
    el.addEventListener("park-order", () => spy());
    click(el, ".hold");
    await el.updateComplete;
    await typeLabel(el, "Mesa 4"); // a label is part-entered
    click(el, ".cancel");
    await el.updateComplete;
    expect(query(el, ".pay")).not.toBeNull(); // back to the idle Pay button
    expect(query(el, ".label-input")).toBeNull();
    expect(spy).not.toHaveBeenCalled(); // Cancel parks nothing
    expect(store.lines).toHaveLength(1); // basket untouched
  });

  it("shows a Card button in the idle view, disabled on an empty basket", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    expect(query(el, ".pay-card")!.hasAttribute("disabled")).toBe(true);
    expect(el.shadowRoot!.textContent).toContain(t("tender.card"));
  });

  it("enables Card once a line is rung up, reacting to store changes", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    store.addProduct(cafe, "2");
    await el.updateComplete;
    expect(query(el, ".pay-card")!.hasAttribute("disabled")).toBe(false);
  });

  it("disables Card while busy (a sale is in flight), even with a rung-up basket", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2"); // Card would otherwise be enabled
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store, busy: true });
    // Same visible half of the single-flight guard as Pay/Hold: dropping `|| this.busy` enables Card.
    expect(query(el, ".pay-card")!.hasAttribute("disabled")).toBe(true);
  });

  it("opens the card screen showing the total, with no keypad, when Card is tapped", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2"); // total 3.00
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    click(el, ".pay-card");
    await el.updateComplete;
    expect(el.shadowRoot!.textContent).toContain(t("tender.card"));
    expect(el.shadowRoot!.textContent).toContain(t("label.total"));
    expect(el.shadowRoot!.textContent).toContain(formatMoney("3.00"));
    expect(query(el, "till-numeric-pad")).toBeNull(); // a card charges the exact total — no keypad
    expect(query(el, ".ref-input")).not.toBeNull(); // the optional operation-number field
  });

  it("emits confirm-payment method:card with amount == total, no change entry", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "1"); // total 1.50
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    const spy = vi.fn();
    el.addEventListener("confirm-payment", (e) => spy((e as CustomEvent).detail));
    click(el, ".pay-card");
    await el.updateComplete;
    click(el, ".confirm");
    expect(spy).toHaveBeenCalledWith({ method: "card", amount: "1.50" });
  });

  it("rides an entered externalRef along with the card tender", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "1"); // total 1.50
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    const spy = vi.fn();
    el.addEventListener("confirm-payment", (e) => spy((e as CustomEvent).detail));
    click(el, ".pay-card");
    await el.updateComplete;
    await typeRef(el, "OP-12345");
    click(el, ".confirm");
    expect(spy).toHaveBeenCalledWith({ method: "card", amount: "1.50", externalRef: "OP-12345" });
  });

  it("returns to idle after a confirmed card payment", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "1");
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    click(el, ".pay-card");
    await el.updateComplete;
    click(el, ".confirm");
    await el.updateComplete;
    expect(query(el, ".pay-card")).not.toBeNull(); // back to the idle view
    expect(query(el, ".ref-input")).toBeNull();
  });

  it("returns to idle from the card screen when Cancel is tapped, emitting nothing", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "1");
    const { el } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    const spy = vi.fn();
    el.addEventListener("confirm-payment", () => spy());
    click(el, ".pay-card");
    await el.updateComplete;
    await typeRef(el, "OP-12345"); // a ref is part-entered
    click(el, ".cancel");
    await el.updateComplete;
    expect(query(el, ".pay-card")).not.toBeNull(); // back to the idle view
    expect(query(el, ".ref-input")).toBeNull();
    expect(spy).not.toHaveBeenCalled(); // Cancel never settles the sale
    expect(store.lines).toHaveLength(1); // basket untouched
  });

  it("stops reacting to the store after disconnect", async () => {
    const store = new WorkingOrderStore();
    const { el, host } = await mountWidget<TillTenderPay>("till-tender-pay", { store });
    host.remove(); // disconnectedCallback → both subscriptions disposed
    store.addProduct(cafe, "1");
    store.emit("product-selected", jamon);
    await el.updateComplete;
    expect(query(el, ".pay")!.hasAttribute("disabled")).toBe(true); // never heard the add
    expect(el.shadowRoot!.textContent).not.toContain(t("weigh.prompt")); // never heard the pick
  });
});
