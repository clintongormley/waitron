import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html, nothing } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./invoice-email-dialog.js";
import type {
  InvoiceEmailRefusal,
  InvoiceEmailSendDetail,
  TillInvoiceEmailDialog,
} from "./invoice-email-dialog.js";

class InvoiceEmailLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  open = true;
  refusal?: InvoiceEmailRefusal;
  busy = false;
  closes = 0;
  sent: InvoiceEmailSendDetail[] = [];
  override render() {
    return html`${
      this.open
        ? html`<till-invoice-email-dialog
            .refusal=${this.refusal}
            .busy=${this.busy}
            @invoice-email-cancel=${() => this.closes++}
            @invoice-email-send=${(event: CustomEvent<InvoiceEmailSendDetail>) => this.sent.push(event.detail)}
          ></till-invoice-email-dialog>`
        : nothing
    }${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("invoice-email-leave-test-app", InvoiceEmailLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

async function mount() {
  const { el: app } = await mountWidget<InvoiceEmailLeaveApp>("invoice-email-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("till-invoice-email-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
async function fill(form: TillInvoiceEmailDialog, value: string) {
  const field = form.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await form.updateComplete;
  return input;
}
function cancel(form: TillInvoiceEmailDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-email-cancel]")!.click();
}
function send(form: TillInvoiceEmailDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-email-send]")!.click();
}
async function question(app: InvoiceEmailLeaveApp) {
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
  it(`${action} with a typed address asks first: Keep keeps it, Discard closes without sending`, async () => {
    const { app, form } = await mount();
    const input = await fill(form, "ana@example.com");
    if (action === "Cancel") cancel(form);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(app.closes).toBe(0);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(input.value).toBe("ana@example.com");
    cancel(form);
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => app.closes).toBe(1);
    expect(app.sent).toEqual([]);
    expect(unload()).toBe(false);
  });
}

it("an untouched form, or one typed back to empty, closes without asking", async () => {
  const { app, form } = await mount();
  await fill(form, "ana@example.com");
  expect(unload()).toBe(true);
  await fill(form, "");
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});

it("a malformed address stays protected after the form refuses it", async () => {
  const { app, form } = await mount();
  await fill(form, "ana@");
  send(form);
  await form.updateComplete;
  expect(app.sent).toEqual([]);
  expect(unload()).toBe(true);
  cancel(form);
  expect((await question(app)).open).toBe(true);
});

it("a sent address cannot be closed away while the answer is awaited, and stays protected after a refusal", async () => {
  const { app, form } = await mount();
  await fill(form, "ana@example.com");
  send(form);
  expect(app.sent).toEqual([{ recipient: "ana@example.com" }]);
  app.busy = true;
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  expect(unload()).toBe(true);
  cancel(form);
  expect((await question(app)).open).toBe(false);
  await userEvent.keyboard("{Escape}");
  await form.updateComplete;
  expect((await question(app)).open).toBe(false);
  expect(app.closes).toBe(0);
  expect(form.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true);
  app.busy = false;
  app.refusal = { code: "invoice_delivery.email_unavailable" };
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  expect(unload()).toBe(true);
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(form.shadowRoot!.querySelector("wt-input")!.value).toBe("ana@example.com");
});

it("once the owner closes the form after a send, nothing is left to protect", async () => {
  const { app, form } = await mount();
  await fill(form, "ana@example.com");
  send(form);
  app.open = false;
  app.requestUpdate();
  await app.updateComplete;
  expect(form.isConnected).toBe(false);
  expect(unload()).toBe(false);
});

it("taken out and put back, the form keeps the typed address and still asks", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "ana@example.com");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  form.remove();
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(input.value).toBe("ana@example.com");
  expect(unload()).toBe(true);
  cancel(form);
  expect((await question(app)).open).toBe(true);
});

it("controls kept after the form leaves cannot send, cancel or change the address", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "ana@example.com");
  const sendButton = form.shadowRoot!.querySelector<HTMLElement>("[data-email-send]")!;
  form.remove();
  sendButton.click();
  cancel(form);
  input.value = "bob@example.com";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  expect(app.sent).toEqual([]);
  expect(app.closes).toBe(0);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector("wt-input")!.value).toBe("ana@example.com");
  expect(unload()).toBe(true);
});
