import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { BillPaymentView } from "../api/client.js";
import type { RefundAsk } from "../state/bill-payment.js";
import "./bill-refund-dialog.js";
import type { TillBillRefundDialog } from "./bill-refund-dialog.js";

const payment: BillPaymentView = {
  id: "pay-1",
  submissionId: "sub-1",
  kind: "contribution",
  shareOf: null,
  method: "cash",
  entry: null,
  applied: "50.00",
  tip: "5.00",
  tendered: "55.00",
  change: "0.00",
  state: "received",
  createdAt: "2026-09-30T20:00:00.000Z",
  receivedAt: "2026-09-30T20:00:00.000Z",
  lines: [],
  refunds: [],
};
class RefundLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  suggested: string | null = null;
  closes = 0;
  submitted: RefundAsk[] = [];
  override render() {
    return html`<till-bill-refund-dialog
        .payment=${payment}
        .suggested=${this.suggested}
        @bill-refund-close=${() => this.closes++}
        @bill-refund-continue=${(event: CustomEvent<RefundAsk>) => this.submitted.push(event.detail)}
      ></till-bill-refund-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("refund-leave-test-app", RefundLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount(suggested: string | null = null) {
  const { el: app } = await mountWidget<RefundLeaveApp>("refund-leave-test-app", { suggested });
  const form = app.shadowRoot!.querySelector("till-bill-refund-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
async function fill(form: TillBillRefundDialog, name: string, value: string) {
  const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[name=${name}]`,
  )!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await form.updateComplete;
  return input;
}
async function part(form: TillBillRefundDialog, value = "part") {
  form.shadowRoot!.querySelector<HTMLInputElement>(`input[value=${value}]`)!.click();
  await form.updateComplete;
}
function cancel(form: TillBillRefundDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-refund-close]")!.click();
}
async function question(app: RefundLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
for (const action of ["Cancel", "Escape"]) {
  it(`refund ${action} retains amount and reason until Discard without issuing a refund`, async () => {
    const { app, form } = await mount();
    await part(form);
    await fill(form, "amount", "12.50");
    const input = await fill(form, "reason", "  Charged twice  ");
    if (action === "Cancel") cancel(form);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(app.closes).toBe(0);
    expect(app.submitted).toEqual([]);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(input.value).toBe("  Charged twice  ");
    expect((input.getRootNode() as ShadowRoot).activeElement).toBe(input);
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=amount]")!.value,
    ).toBe("12.50");
    cancel(form);
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => app.closes).toBe(1);
    await form.updateComplete;
    expect(form.shadowRoot!.querySelector("[name=amount]")).toBeNull();
    expect(input.value).toBe("");
    expect(app.submitted).toEqual([]);
    expect(unload()).toBe(false);
  });
}
it("an untouched or reverted refund closes directly", async () => {
  const { app, form } = await mount();
  await fill(form, "reason", "Too much");
  expect(unload()).toBe(true);
  await part(form);
  await fill(form, "amount", "10.00");
  await part(form, "whole");
  await fill(form, "reason", "   ");
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("suggested refund defaults are clean and normalized amount reverts are clean", async () => {
  const { app, form } = await mount("12.50");
  expect(unload()).toBe(false);
  await fill(form, "amount", "15.00");
  expect(unload()).toBe(true);
  await fill(form, "amount", "12.5");
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("invalid refund input remains protected and submission keeps the exact request body", async () => {
  const { app, form } = await mount();
  await part(form);
  await fill(form, "amount", "invalid");
  await fill(form, "reason", "Too much");
  form.shadowRoot!.querySelector<HTMLElement>("[data-refund-continue]")!.click();
  await form.updateComplete;
  expect(app.submitted).toEqual([]);
  expect(unload()).toBe(true);
  await fill(form, "amount", "12.50");
  await fill(form, "reason", "  Charged twice  ");
  form.shadowRoot!.querySelector<HTMLElement>("[data-refund-continue]")!.click();
  expect(app.submitted).toEqual([
    { appliedAmount: "12.50", tipAmount: "0.00", reason: "Charged twice" },
  ]);
  expect((await question(app)).open).toBe(false);
  form.refusal = { code: "network" };
  await form.updateComplete;
  expect(unload()).toBe(true);
  cancel(form);
  expect((await question(app)).open).toBe(true);
});
it("busy refund entry cannot dismiss, resubmit or ask on Escape", async () => {
  const { app, form } = await mount();
  await fill(form, "reason", "Too much");
  form.busy = true;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  cancel(form);
  form.shadowRoot!.querySelector<HTMLElement>("[data-refund-continue]")!.click();
  await userEvent.keyboard("{Escape}");
  expect(app.submitted).toEqual([]);
  expect(app.closes).toBe(0);
  expect((await question(app)).open).toBe(false);
});
it("disconnect aborts a refund question and reconnect retains the original baseline", async () => {
  const { app, form } = await mount();
  await fill(form, "reason", "Too much");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.remove();
  await expect.poll(() => q.open).toBe(false);
  discard.click();
  expect(app.closes).toBe(0);
  expect(unload()).toBe(false);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=reason]")!.value,
  ).toBe("Too much");
  expect(unload()).toBe(true);
});
it("an untouched refund closes without a question or request and ignores delayed native reports", async () => {
  const { app, form } = await mount();
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
  const dialog = form.shadowRoot!.querySelector("wt-dialog")!;
  dialog.shadowRoot!.querySelector("dialog")!.dispatchEvent(new Event("close"));
  expect(app.closes).toBe(1);
  expect(app.submitted).toEqual([]);
});
it("departed refund controls cannot submit, dismiss or edit the retained draft", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "reason", "Charged twice");
  const submit = form.shadowRoot!.querySelector<HTMLElement>("[data-refund-continue]")!;
  form.remove();
  submit.click();
  cancel(form);
  input.value = "Changed after departure";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  expect(app.submitted).toEqual([]);
  expect(app.closes).toBe(0);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(input.value).toBe("Charged twice");
  expect(unload()).toBe(true);
});
it("successful refund close invalidates an outstanding Discard before host teardown", async () => {
  const { app, form } = await mount();
  await fill(form, "reason", "Charged twice");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  const discard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.closeSaved();
  expect(unload()).toBe(false);
  await expect.poll(() => q.open).toBe(false);
  discard.click();
  expect(app.closes).toBe(0);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=reason]")!.value,
  ).toBe("Charged twice");
});
it("terminal confirmation keeps the reason protected until actual acceptance", async () => {
  const { app, form } = await mount();
  await fill(form, "reason", "Charged twice");
  form.terminal = true;
  await form.updateComplete;
  form.shadowRoot!.querySelector<HTMLElement>("[data-refund-terminal-done]")!.click();
  expect(app.submitted).toEqual([
    { appliedAmount: "50.00", tipAmount: "5.00", reason: "Charged twice", manualConfirmed: true },
  ]);
  expect((await question(app)).open).toBe(false);
  expect(unload()).toBe(true);
  cancel(form);
  expect((await question(app)).open).toBe(true);
});
