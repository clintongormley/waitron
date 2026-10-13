import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./invoice-recipient-dialog.js";
import type { InvoiceDeliveryOptions } from "../api/client.js";
import type {
  InvoiceRecipientDetail,
  TillInvoiceRecipientDialog,
} from "./invoice-recipient-dialog.js";

class RecipientLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  submitted: InvoiceRecipientDetail[] = [];
  override render() {
    return html`<till-invoice-recipient-dialog
        @invoice-recipient-cancel=${() => this.closes++}
        @invoice-recipient-confirm=${(event: CustomEvent<InvoiceRecipientDetail>) => this.submitted.push(event.detail)}
      ></till-invoice-recipient-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("recipient-leave-test-app", RecipientLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount() {
  const { el: app } = await mountWidget<RecipientLeaveApp>("recipient-leave-test-app", {});
  const form = app.shadowRoot!.querySelector("till-invoice-recipient-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
async function fill(form: TillInvoiceRecipientDialog, name: string, value: string) {
  const field = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[name=${name}]`,
  )!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await form.updateComplete;
  return input;
}
async function question(app: RecipientLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
function cancel(form: TillInvoiceRecipientDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
for (const action of ["Cancel", "Escape"]) {
  it(`recipient ${action} keeps the edited value and focus, then discards once`, async () => {
    const { app, form } = await mount();
    const input = await fill(form, "legalName", "Ana García");
    if (action === "Cancel") cancel(form);
    else await userEvent.keyboard("{Escape}");
    const q = await question(app);
    expect(q.open).toBe(true);
    expect(app.closes).toBe(0);
    expect(app.submitted).toEqual([]);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(input.value).toBe("Ana García");
    if (action === "Escape")
      expect(
        input.getRootNode() instanceof ShadowRoot &&
          (input.getRootNode() as ShadowRoot).activeElement,
      ).toBe(input);
    cancel(form);
    await question(app);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => app.closes).toBe(1);
    expect(form.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
    expect(input.value).toBe("");
    expect(app.submitted).toEqual([]);
    expect(unload()).toBe(false);
  });
}
for (const name of ["taxId", "legalName", "address", "postalCode", "locality", "province"]) {
  it(`recipient ${name} retains invalid input and clears its warning on a normalized revert`, async () => {
    const { app, form } = await mount();
    await fill(form, name, "invalid");
    expect(unload()).toBe(true);
    await fill(form, name, "  ");
    expect(unload()).toBe(false);
    cancel(form);
    await expect.poll(() => app.closes).toBe(1);
    expect((await question(app)).open).toBe(false);
  });
}
it("a refusal rerender retains the recipient draft and pending decision", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "taxId", "12345678A");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  form.refusal = "Check customer details";
  form.refusalField = "taxId";
  await form.updateComplete;
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(input.value).toBe("12345678A");
  expect(unload()).toBe(true);
});
it("departed recipient controls cannot emit a submission or cancellation", async () => {
  const { app, form } = await mount();
  await fill(form, "legalName", "Ana");
  const oldCancel = form.shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!;
  form.remove();
  oldCancel.click();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(app.closes).toBe(0);
  expect(unload()).toBe(false);
});

async function valid(form: TillInvoiceRecipientDialog) {
  for (const [name, value] of [
    ["taxId", "12345678Z"],
    ["legalName", "Ana García"],
    ["address", "Calle Mayor 1"],
    ["postalCode", "28013"],
    ["locality", "Madrid"],
    ["province", "Madrid"],
  ])
    await fill(form, name!, value!);
}
function submit(form: TillInvoiceRecipientDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
}
function completion(form: TillInvoiceRecipientDialog) {
  return form.writeCompletion();
}

it("a successful recipient choice commits normalized submitted fields and invalidates a pending Cancel", async () => {
  const { app, form } = await mount();
  await valid(form);
  submit(form);
  expect(app.submitted).toEqual([
    {
      invoiceType: "F1",
      recipient: {
        taxId: "12345678Z",
        legalName: "Ana García",
        address: "Calle Mayor 1, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    },
  ]);
  const accepted = completion(form);
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  expect(accepted()).toBe(true);
  await expect.poll(() => q.open).toBe(false);
  expect(unload()).toBe(false);
  expect(app.closes).toBe(0);
  expect(form.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
});
it("an accepted recipient save commits only submitted fields; newer edits survive and revert canonically", async () => {
  const { app, form } = await mount();
  await valid(form);
  submit(form);
  const accepted = completion(form);
  const input = await fill(form, "legalName", "Newer name");
  expect(accepted()).toBe(false);
  expect(input.value).toBe("Newer name");
  expect(form.shadowRoot!.querySelector("wt-dialog")!.open).toBe(true);
  await fill(form, "taxId", " 12345678z ");
  await fill(form, "legalName", " Ana García ");
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("a refused recipient choice remains dirty without a second submission on Keep", async () => {
  const { app, form } = await mount();
  await valid(form);
  submit(form);
  form.refusal = "Save refused";
  await form.updateComplete;
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(app.submitted).toHaveLength(1);
  expect(unload()).toBe(true);
});
it("reconnecting a retained recipient keeps its opening baseline and invalidates old completion", async () => {
  const { app, form } = await mount();
  await valid(form);
  submit(form);
  const accepted = completion(form);
  form.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(unload()).toBe(true);
  expect(accepted()).toBe(false);
  cancel(form);
  expect((await question(app)).open).toBe(true);
});
it("detached Save and Enter controls cannot submit an otherwise valid recipient", async () => {
  const { app, form } = await mount();
  await valid(form);
  const save = form.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!;
  const input = form
    .shadowRoot!.querySelector("wt-input[name=legalName]")!
    .shadowRoot!.querySelector("input")!;
  form.remove();
  save.click();
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(app.submitted).toEqual([]);
});

it("departed input events cannot change the retained recipient on reconnection", async () => {
  const { app, form } = await mount();
  const input = await fill(form, "legalName", "Opening edit");
  form.remove();
  input.value = "Departed edit";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=legalName]")!
      .value,
  ).toBe("Opening edit");
  expect(unload()).toBe(true);
});

it("a recipient left detached for a moment still asks before discarding once reattached", async () => {
  const { app, form } = await mount();
  await fill(form, "legalName", "Opening edit");
  form.remove();
  await form.updateComplete;
  app.shadowRoot!.appendChild(form);
  await form.updateComplete;
  expect(unload()).toBe(true);
  cancel(form);
  expect((await question(app)).open).toBe(true);
});

class DeliveryLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  saved?: InvoiceRecipientDetail["delivery"];
  options: InvoiceDeliveryOptions = {
    invoicePrinter: { id: "pp-office", name: "Office HP" },
    emailAvailable: false,
  };
  closes = 0;
  submitted: InvoiceRecipientDetail[] = [];
  override render() {
    return html`<till-invoice-recipient-dialog
        .deliveryOptions=${this.options}
        .savedDelivery=${this.saved}
        @invoice-recipient-cancel=${() => this.closes++}
        @invoice-recipient-confirm=${(event: CustomEvent<InvoiceRecipientDetail>) => this.submitted.push(event.detail)}
      ></till-invoice-recipient-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("recipient-delivery-leave-test-app", DeliveryLeaveApp);

async function mountDelivery(props: Partial<DeliveryLeaveApp> = {}) {
  const { el: app } = await mountWidget<DeliveryLeaveApp>(
    "recipient-delivery-leave-test-app",
    props,
  );
  const form = app.shadowRoot!.querySelector("till-invoice-recipient-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
function deliveryField(form: TillInvoiceRecipientDialog) {
  return form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    "wt-combobox[name=delivery]",
  )!;
}
async function chooseDelivery(form: TillInvoiceRecipientDialog, value: string) {
  const field = deliveryField(form);
  field.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
  await field.updateComplete;
  const index = field.options.findIndex((option) => option.value === value);
  field.shadowRoot!.querySelectorAll<HTMLElement>("[role=option]")[index]!.click();
  await form.updateComplete;
}

it("a changed delivery choice asks before discarding, Keep keeps it, and choosing the receipt again is clean", async () => {
  const { app, form } = await mountDelivery();
  expect(unload()).toBe(false);
  await chooseDelivery(form, "a4");
  expect(unload()).toBe(true);
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(deliveryField(form).value).toBe("a4");
  expect(app.closes).toBe(0);
  await chooseDelivery(form, "receipt");
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
});

it("discarding a changed delivery choice closes without sending it", async () => {
  const { app, form } = await mountDelivery();
  await chooseDelivery(form, "a4");
  cancel(form);
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => app.closes).toBe(1);
  expect(app.submitted).toEqual([]);
  expect(unload()).toBe(false);
});

it("a refused A4 choice stays dirty and keeps A4 chosen for the retry", async () => {
  const { app, form } = await mountDelivery();
  await valid(form);
  await chooseDelivery(form, "a4");
  submit(form);
  form.refusal = "That invoice printer is unavailable";
  await form.updateComplete;
  expect(unload()).toBe(true);
  expect(deliveryField(form).value).toBe("a4");
  submit(form);
  expect(app.submitted.map((detail) => detail.delivery)).toEqual([
    { medium: "a4", pagePrinterId: "pp-office" },
    { medium: "a4", pagePrinterId: "pp-office" },
  ]);
});

it("a saved choice the field does not offer opens clean, and choosing it again after a change is clean", async () => {
  const { form } = await mountDelivery({
    saved: { medium: "email", recipient: "ana@example.com" },
  });
  expect(deliveryField(form).value).toBe("saved");
  expect(unload()).toBe(false);
  await chooseDelivery(form, "receipt");
  expect(unload()).toBe(true);
  await chooseDelivery(form, "saved");
  expect(unload()).toBe(false);
});

it("a saved A4 opened on the current printer instead counts as a change: Cancel asks first", async () => {
  const { app, form } = await mountDelivery({
    saved: { medium: "a4", pagePrinterId: "pp-retired" },
  });
  expect(deliveryField(form).value).toBe("a4");
  expect(unload()).toBe(true);
  cancel(form);
  expect((await question(app)).open).toBe(true);
  expect(app.closes).toBe(0);
});

const emailOptions = {
  invoicePrinter: { id: "pp-office", name: "Office HP" },
  emailAvailable: true,
};

it("a typed email address asks before discarding, and stops counting once another delivery is chosen", async () => {
  const { app, form } = await mountDelivery({ options: emailOptions });
  expect(unload()).toBe(false);
  await chooseDelivery(form, "email");
  await fill(form, "email", "ana@example.com");
  expect(unload()).toBe(true);
  await chooseDelivery(form, "receipt");
  expect(unload()).toBe(false);
  await chooseDelivery(form, "email");
  expect(unload()).toBe(true);
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=email]")!
      .value,
  ).toBe("ana@example.com");
  expect(app.closes).toBe(0);
});

it("a saved email opens clean on Email, and a changed address asks before discarding", async () => {
  const { app, form } = await mountDelivery({
    options: emailOptions,
    saved: { medium: "email", recipient: "ana@example.com" },
  });
  expect(deliveryField(form).value).toBe("email");
  expect(unload()).toBe(false);
  await fill(form, "email", "ana@example.org");
  expect(unload()).toBe(true);
  await fill(form, "email", " ana@example.com ");
  expect(unload()).toBe(false);
  await fill(form, "email", "ana@example.org");
  cancel(form);
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => app.closes).toBe(1);
  expect(app.submitted).toEqual([]);
});
