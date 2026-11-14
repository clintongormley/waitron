import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { AdjustmentReason } from "../api/client.js";
import { InvoiceCorrectionSession } from "../state/invoice-correction.js";
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
  previewInvoiceCorrection: (saleId, request) => preview(saleId, request),
  getInvoiceCorrection: vi.fn(),
  fileInvoiceCorrection: vi.fn(),
  closeInvoiceCorrection: vi.fn(),
  listApprovers: vi.fn(),
};
const answered: InvoiceCorrectionApi["previewInvoiceCorrection"] = async (_saleId, request) => ({
  gross: request.gross,
  vatBreakdown: [{ rate: "21.00", base: "5.00", tax: "1.05" }],
  moneyRefundable: "12.10",
});
let preview = answered;
const openInvoiceCorrection = vi.fn(() => new Promise<never>(() => {}));
const session = new InvoiceCorrectionSession(
  { deviceId: "device-1", personId: "staff-1" },
  { openInvoiceCorrection, giveInvoiceCorrectionCash: vi.fn() },
);

class InvoiceCorrectionLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  override render() {
    return html`<till-invoice-correction-dialog
        .api=${api}
        .session=${session}
        saleId="sale-1"
        invoiceNumber="T/12"
        namesLocale="en"
        @invoice-correction-close=${() => this.closes++}
      ></till-invoice-correction-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("invoice-correction-leave-test-app", InvoiceCorrectionLeaveApp);
beforeEach(() => {
  setLocale("en");
  preview = answered;
  openInvoiceCorrection.mockClear();
});
afterEach(() => {
  cleanupWidgets();
  localStorage.clear();
});

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
  expect(openInvoiceCorrection).not.toHaveBeenCalled();
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

it("a correction discarded while its preview is asked again is never confirmed", async () => {
  const calls: Array<() => void> = [];
  preview = vi.fn(async (saleId, request) => {
    if (calls.length === 0) {
      calls.push(() => {});
      throw new TypeError("Failed to fetch");
    }
    await new Promise<void>((resolve) => calls.push(resolve));
    return answered(saleId, request);
  });
  const { app, form } = await mount();
  await type(form, "6.05");
  form.shadowRoot!.querySelector("wt-combobox[name=reason]")!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "overcharged" },
      bubbles: true,
      composed: true,
    }),
  );
  await form.updateComplete;

  form.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  await userEvent.keyboard("{Escape}");
  const closed = closing(form);
  (await question(app)).shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await closed;
  calls[1]!();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(app.closes).toBe(1);
  expect(openInvoiceCorrection).not.toHaveBeenCalled();
});

it("a correction whose window is taken away while its preview is asked again is never confirmed", async () => {
  let release!: () => void;
  let calls = 0;
  preview = vi.fn(async (saleId, request) => {
    if (++calls === 1) throw new TypeError("Failed to fetch");
    await new Promise<void>((resolve) => (release = resolve));
    return answered(saleId, request);
  });
  const { form } = await mount();
  await type(form, "6.05");
  form.shadowRoot!.querySelector("wt-combobox[name=reason]")!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "overcharged" },
      bubbles: true,
      composed: true,
    }),
  );
  await form.updateComplete;

  form.shadowRoot!.querySelector<HTMLElement>("[data-confirm]")!.click();
  await vi.waitFor(() => expect(calls).toBe(2));
  form.remove();
  release();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(openInvoiceCorrection).not.toHaveBeenCalled();
});
