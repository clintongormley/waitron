import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { AdjustmentReason } from "../api/client.js";
import "./invoice-correction-dialog.js";
import type {
  InvoiceCorrectionApi,
  TillInvoiceCorrectionDialog,
} from "./invoice-correction-dialog.js";

const reason = {
  id: "overcharged",
  name: "Overcharged",
  kind: "void",
  actions: ["cancel"],
  noteRequired: false,
  maxPercentBp: null,
  maxAmount: null,
} as AdjustmentReason;
const api: InvoiceCorrectionApi = {
  readInvoiceCorrectionLines: async () => ({
    lines: [
      {
        id: "steak",
        descriptions: { en: "Steak" },
        rate: "21.00",
        gross: "12.10",
        left: "12.10",
      },
    ],
    moneyRefundable: "12.10",
  }),
  getRefundableTenders: async () => [],
  listAdjustmentReasons: async () => [reason],
  previewInvoiceCorrection: async (_saleId, request) => ({
    gross: request.gross,
    vatBreakdown: [{ rate: "21.00", base: "5.00", tax: "1.05" }],
    moneyRefundable: "12.10",
  }),
};

class InvoiceCorrectionLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  confirms = 0;
  override render() {
    return html`<till-invoice-correction-dialog
        .api=${api}
        saleId="sale-1"
        invoiceNumber="T/12"
        namesLocale="en"
        @invoice-correction-close=${() => this.closes++}
        @invoice-correction-confirm=${() => this.confirms++}
      ></till-invoice-correction-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("invoice-correction-leave-test-app", InvoiceCorrectionLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

async function mount() {
  const { el: app } = await mountWidget<InvoiceCorrectionLeaveApp>(
    "invoice-correction-leave-test-app",
    {},
  );
  const form = app.shadowRoot!.querySelector("till-invoice-correction-dialog")!;
  await vi.waitFor(() => expect(form.shadowRoot!.querySelector("[name=gross]")).not.toBeNull());
  return { app, form };
}
const gross = (form: TillInvoiceCorrectionDialog) =>
  form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-price-input"]>("[name=gross]")!;
async function type(form: TillInvoiceCorrectionDialog, value: string) {
  await userEvent.fill(page.elementLocator(gross(form).shadowRoot!.querySelector("input")!), value);
  await form.updateComplete;
}
async function toggleSteak(form: TillInvoiceCorrectionDialog) {
  form.shadowRoot!.querySelector("wt-switch")!.shadowRoot!.querySelector("input")!.click();
  await form.updateComplete;
}
async function question(app: InvoiceCorrectionLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
const closing = (form: TillInvoiceCorrectionDialog) =>
  new Promise<void>((resolve) =>
    form.addEventListener("invoice-correction-close", () => resolve(), { once: true }),
  );

it("Escape keeps the typed money and picked dish until Discard, and never confirms", async () => {
  const { app, form } = await mount();
  await toggleSteak(form);
  await type(form, "6.05");
  expect(unload()).toBe(true);
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  expect(q.open).toBe(true);
  expect(app.closes).toBe(0);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(gross(form).value).toBe("6.05");
  expect(form.shadowRoot!.querySelector("wt-switch")!.checked).toBe(true);
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(true);
  const closed = closing(form);
  (await question(app)).shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await closed;
  expect(app.closes).toBe(1);
  expect(app.confirms).toBe(0);
  expect(unload()).toBe(false);
});

it("a dish picked and put back, with no money typed, closes without a question", async () => {
  const { app, form } = await mount();
  await toggleSteak(form);
  expect(unload()).toBe(true);
  await toggleSteak(form);
  expect(unload()).toBe(false);
  const closed = closing(form);
  form.shadowRoot!.querySelector<HTMLElement>("[data-close]")!.click();
  await closed;
  expect((await question(app)).open).toBe(false);
});

it("busy Cancel and Escape cannot discard the staged correction", async () => {
  const { app, form } = await mount();
  await type(form, "6.05");
  form.busy = true;
  await form.updateComplete;
  form.shadowRoot!.querySelector<HTMLElement>("[data-close]")!.click();
  await userEvent.keyboard("{Escape}");
  expect((await question(app)).open).toBe(false);
  expect(app.closes).toBe(0);
  expect(unload()).toBe(true);
});

it("disconnect drops a pending question; reconnect keeps the draft unsaved", async () => {
  const { app, form } = await mount();
  await type(form, "6.05");
  await userEvent.keyboard("{Escape}");
  const q = await question(app);
  expect(q.open).toBe(true);
  form.remove();
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  app.shadowRoot!.append(form);
  await form.updateComplete;
  expect(gross(form).value).toBe("6.05");
  expect(unload()).toBe(true);
});
