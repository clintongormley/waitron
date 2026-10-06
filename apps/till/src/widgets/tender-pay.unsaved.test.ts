import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, type WtInput } from "@waitron/ui";
import { WorkingOrderStore } from "../state/working-order.js";
import type { TillProduct } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import {
  type TillTenderPay,
  type ConfirmPaymentDetail,
  type CollectCardDetail,
} from "./tender-pay.js";
import "./tender-pay.js";

const product: TillProduct = {
  id: "coffee",
  name: "Staff coffee",
  customerName: { en: "Customer coffee" },
  unit: {
    id: "each",
    name: { en: "unit" },
    abbreviation: { en: "ea" },
    precision: 0,
    hardwareUnit: null,
  },
  unitPrice: "3.00",
  vatClass: "general",
  category: null,
  allergens: null,
};
const weighed: TillProduct = {
  ...product,
  id: "weighed",
  name: "Staff cheese",
  customerName: { en: "Customer cheese" },
  unit: {
    id: "kg",
    name: { en: "kilogram" },
    abbreviation: { en: "kg" },
    precision: 3,
    hardwareUnit: "kg",
  },
  unitPrice: "10.00",
};
class TenderLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  readonly store = new WorkingOrderStore();
  payments: ConfirmPaymentDetail[] = [];
  collects: CollectCardDetail[] = [];
  parks: unknown[] = [];
  constructor() {
    super();
    this.store.addProduct(product, "1");
  }
  override render() {
    return html`<till-tender-pay
        .store=${this.store}
        @confirm-payment=${(e: CustomEvent<ConfirmPaymentDetail>) => this.payments.push(e.detail)}
        @collect-card=${(e: CustomEvent<CollectCardDetail>) => this.collects.push(e.detail)}
        @park-order=${(e: CustomEvent) => this.parks.push(e.detail)}
      ></till-tender-pay>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("tender-leave-test-app", TenderLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount() {
  const { el: app } = await mountWidget<TenderLeaveApp>("tender-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("till-tender-pay")!;
  await form.updateComplete;
  return { app, form };
}
async function click(form: TillTenderPay, selector: string) {
  form.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
  await form.updateComplete;
}
async function fill(form: TillTenderPay, selector: string, value: string) {
  const field = form.shadowRoot!.querySelector<WtInput>(selector)!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await form.updateComplete;
  return input;
}
async function press(form: TillTenderPay, key: string) {
  const pad = form.shadowRoot!.querySelector("till-numeric-pad")!;
  await pad.updateComplete;
  pad.shadowRoot!.querySelector<HTMLElement>(`[data-key="${key}"]`)!.click();
  await form.updateComplete;
}
async function question(app: TenderLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
async function choose(app: TenderLeaveApp, decision: "keep" | "discard") {
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
for (const kind of ["cash", "weight", "label", "reference"] as const) {
  it(`${kind} Cancel keeps the raw entry until local Discard without a command`, async () => {
    const { app, form } = await mount();
    let input: HTMLInputElement | undefined;
    if (kind === "cash") {
      await click(form, ".pay");
      await press(form, "5");
      await press(form, ".");
    }
    if (kind === "weight") {
      app.store.emit("product-selected", weighed);
      await form.updateComplete;
      await press(form, "1");
      await press(form, ".");
    }
    if (kind === "label") {
      await click(form, ".hold");
      input = await fill(form, ".label-input", "  Guest 07  ");
    }
    if (kind === "reference") {
      await click(form, ".pay-card");
      input = await fill(form, ".ref-input", "  TX-007  ");
    }
    expect(unload()).toBe(true);
    await click(form, ".cancel");
    expect((await question(app)).open).toBe(true);
    await choose(app, "keep");
    if (input) {
      expect(input.value).toBe(kind === "label" ? "  Guest 07  " : "  TX-007  ");
      expect((input.getRootNode() as ShadowRoot).activeElement).toBe(input);
    } else
      expect(form.shadowRoot!.querySelector("till-numeric-pad")!.value).toBe(
        kind === "cash" ? "5." : "1.",
      );
    await click(form, ".cancel");
    await choose(app, "discard");
    await expect.poll(() => form.shadowRoot!.querySelector(".pay") !== null).toBe(true);
    expect(app.payments).toEqual([]);
    expect(app.collects).toEqual([]);
    expect(app.parks).toEqual([]);
    expect(app.store.lines.map((line) => [line.product.id, line.quantity])).toEqual([
      ["coffee", "1"],
    ]);
    expect(unload()).toBe(false);
  });
}
it("reverted reference and zero cash close directly", async () => {
  const { app, form } = await mount();
  await click(form, ".pay-card");
  await fill(form, ".ref-input", "typed");
  await fill(form, ".ref-input", "  ");
  expect(unload()).toBe(false);
  await click(form, ".cancel");
  expect((await question(app)).open).toBe(false);
  await click(form, ".pay");
  await press(form, "0");
  await press(form, ".");
  expect(unload()).toBe(false);
  await click(form, ".cancel");
  expect(form.shadowRoot!.querySelector(".pay")).not.toBeNull();
});
it("explicit cash/manual-card/hold/weight actions consume only their input and preserve exact bodies", async () => {
  const { app, form } = await mount();
  const protectedAtSubmit: boolean[] = [];
  form.addEventListener("confirm-payment", () => protectedAtSubmit.push(unload()));
  form.addEventListener("park-order", () => protectedAtSubmit.push(unload()));
  await click(form, ".pay");
  await press(form, "5");
  await press(form, ".");
  await click(form, ".confirm");
  await click(form, ".pay-card");
  await fill(form, ".ref-input", "  TX-007  ");
  await click(form, ".confirm");
  await click(form, ".hold");
  await fill(form, ".label-input", "  Guest 07  ");
  await click(form, ".park");
  app.store.emit("product-selected", weighed);
  await form.updateComplete;
  await press(form, "1");
  await press(form, ".");
  await click(form, ".add");
  expect(app.payments).toEqual([
    { method: "cash", amount: "5" },
    { method: "card", amount: "3.00", externalRef: "TX-007" },
  ]);
  expect(app.parks).toEqual([{ label: "Guest 07" }]);
  expect(protectedAtSubmit).toEqual([false, false, false]);
  expect(app.store.lines.map((line) => [line.product.id, line.quantity])).toEqual([
    ["coffee", "1"],
    ["weighed", "1"],
  ]);
  expect(unload()).toBe(false);
  expect((await question(app)).open).toBe(false);
});
it("disconnect aborts a pending Cancel and reconnect keeps the opening baseline", async () => {
  const { app, form } = await mount();
  await click(form, ".hold");
  const input = await fill(form, ".label-input", "Guest");
  await click(form, ".cancel");
  const q = await question(app);
  expect(q.open).toBe(true);
  form.remove();
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  input.value = "departed";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector<WtInput>(".label-input")!.value).toBe("Guest");
  expect(unload()).toBe(true);
  await click(form, ".cancel");
  expect((await question(app)).open).toBe(true);
  await choose(app, "discard");
  expect(app.parks).toEqual([]);
});
it("busy entry controls do not discard or submit a staged reference", async () => {
  const { app, form } = await mount();
  await click(form, ".pay-card");
  const input = await fill(form, ".ref-input", "TX-007");
  const cancel = form.shadowRoot!.querySelector<HTMLElement>(".cancel")!;
  const confirm = form.shadowRoot!.querySelector<HTMLElement>(".confirm")!;
  form.busy = true;
  await form.updateComplete;
  cancel.click();
  confirm.click();
  input.value = "busy";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await form.updateComplete;
  expect((await question(app)).open).toBe(false);
  expect(app.payments).toEqual([]);
  form.busy = false;
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector<WtInput>(".ref-input")!.value).toBe("TX-007");
  await click(form, ".cancel");
  expect((await question(app)).open).toBe(true);
});
it("tip and offline consent protect page leave but cash Cancel preserves them independently", async () => {
  const { app, form } = await mount();
  form.cardProvider = "stripe_on_device";
  form.tipsEnabled = true;
  await form.updateComplete;
  await fill(form, ".tip-input", "0.30");
  const sw = form.shadowRoot!.querySelector("wt-switch")!;
  await sw.updateComplete;
  sw.shadowRoot!.querySelector<HTMLInputElement>("input")!.click();
  await form.updateComplete;
  expect(unload()).toBe(true);
  await click(form, ".pay");
  await press(form, "5");
  await click(form, ".cancel");
  await choose(app, "discard");
  expect(form.shadowRoot!.querySelector<WtInput>(".tip-input")!.value).toBe("0.30");
  expect(form.shadowRoot!.querySelector("wt-switch")!.checked).toBe(true);
  expect(unload()).toBe(true);
  let left = 0;
  const leaving = app.leave.coordinator.request({
    scopes: [form],
    reason: "navigation",
    proceed: () => {
      left++;
    },
  });
  expect((await question(app)).open).toBe(true);
  await choose(app, "keep");
  await leaving;
  expect(left).toBe(0);
  await click(form, ".pay-card");
  expect(app.collects).toEqual([{ tip: "0.30", allowOffline: true }]);
  expect(unload()).toBe(false);
  await click(form, ".cancel");
  expect((await question(app)).open).toBe(false);
});
it("successful explicit submission invalidates an older Cancel answer", async () => {
  const { app, form } = await mount();
  await click(form, ".pay-card");
  await fill(form, ".ref-input", "TX-007");
  await click(form, ".cancel");
  const q = await question(app);
  expect(q.open).toBe(true);
  await click(form, ".confirm");
  await expect.poll(() => q.open).toBe(false);
  expect(app.payments).toEqual([{ method: "card", amount: "3.00", externalRef: "TX-007" }]);
  expect(unload()).toBe(false);
});
it("replacing a staged weight asks and Keep retains the original product and raw quantity", async () => {
  const { app, form } = await mount();
  app.store.emit("product-selected", weighed);
  await form.updateComplete;
  await press(form, "1");
  await press(form, ".");
  app.store.emit("product-selected", {
    ...weighed,
    id: "other",
    name: "Other staff dish",
    unitPrice: "20.00",
  });
  expect((await question(app)).open).toBe(true);
  await choose(app, "keep");
  expect(form.shadowRoot!.querySelector("till-numeric-pad")!.value).toBe("1.");
  await click(form, ".add");
  expect(app.store.lines[1]!.product.id).toBe("weighed");
  expect(app.store.lines[1]!.quantity).toBe("1");
});
it("departed controls cannot overwrite a later tender attempt", async () => {
  const { app, form } = await mount();
  await click(form, ".pay-card");
  const input = await fill(form, ".ref-input", "TX-007");
  await click(form, ".confirm");
  await click(form, ".pay-card");
  input.value = "old event";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector<WtInput>(".ref-input")!.value).toBe("");
  expect(unload()).toBe(false);
  await click(form, ".confirm");
  expect(app.payments).toEqual([
    { method: "card", amount: "3.00", externalRef: "TX-007" },
    { method: "card", amount: "3.00" },
  ]);
});
it("reverted extras are exempt, and page Discard restores extras without charging", async () => {
  const { app, form } = await mount();
  form.cardProvider = "stripe_on_device";
  form.tipsEnabled = true;
  await form.updateComplete;
  await fill(form, ".tip-input", "0.30");
  await fill(form, ".tip-input", "0.00");
  expect(unload()).toBe(false);
  await fill(form, ".tip-input", "0.30");
  let left = 0;
  const leaving = app.leave.coordinator.request({
    scopes: [form],
    reason: "navigation",
    proceed: () => {
      left++;
    },
  });
  expect((await question(app)).open).toBe(true);
  await choose(app, "discard");
  await leaving;
  await form.updateComplete;
  expect(left).toBe(1);
  expect(form.shadowRoot!.querySelector<WtInput>(".tip-input")!.value).toBe("");
  expect(app.collects).toEqual([]);
  expect(unload()).toBe(false);
});

it("reader preference makes hidden simulator choices exempt and re-exposes their staged value", async () => {
  const { app, form } = await mount();
  form.cardProvider = "simulator";
  form.activeReaders = [{ id: "demo", name: "Demo", provider: "simulator" }];
  await form.updateComplete;
  await click(form, '[data-test="simulation-declined"]');
  expect(unload()).toBe(true);
  await click(form, ".change-reader");
  form.shadowRoot!.querySelector("till-reader-picker")!.dispatchEvent(
    new CustomEvent("reader-chosen", {
      detail: { readerId: "demo" },
      bubbles: true,
      composed: true,
    }),
  );
  await form.updateComplete;
  expect(unload()).toBe(false);
  await click(form, ".change-reader");
  form.shadowRoot!.querySelector("till-reader-picker")!.dispatchEvent(
    new CustomEvent("reader-chosen", {
      detail: { readerId: null },
      bubbles: true,
      composed: true,
    }),
  );
  await form.updateComplete;
  expect(unload()).toBe(true);
  await click(form, ".pay-card");
  expect(app.collects).toEqual([{ simulationOutcome: "declined" }]);
  expect((await question(app)).open).toBe(false);
});
