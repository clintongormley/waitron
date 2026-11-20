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

const passport: InvoiceRecipientDetail["recipient"] = {
  taxId: "X1234567",
  identifierType: "passport",
  identifierCountryCode: "FR",
  legalName: "Ana García",
  address: "Calle Mayor 1, 2º B, 28013 Madrid, Madrid",
  countryCode: "ES",
};
const a4 = { medium: "a4", pagePrinterId: "pp-office" } as const;

class SavedRecipientApp extends LitElement {
  readonly leave = new LeaveController(this);
  recipient?: InvoiceRecipientDetail["recipient"] | null = passport;
  saved?: InvoiceRecipientDetail["delivery"] = a4;
  options: InvoiceDeliveryOptions = {
    invoicePrinter: { id: "pp-office", name: "Office HP" },
    emailAvailable: false,
    emailNeedsReceiptContact: false,
  };
  closes = 0;
  submitted: InvoiceRecipientDetail[] = [];
  override render() {
    return html`<till-invoice-recipient-dialog
        .deliveryOptions=${this.options}
        .savedDelivery=${this.saved}
        .savedRecipient=${this.recipient}
        @invoice-recipient-cancel=${() => this.closes++}
        @invoice-recipient-confirm=${(event: CustomEvent<InvoiceRecipientDetail>) => this.submitted.push(event.detail)}
      ></till-invoice-recipient-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("recipient-saved-test-app", SavedRecipientApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

async function mount(props: Partial<SavedRecipientApp> = {}) {
  const { el: app } = await mountWidget<SavedRecipientApp>("recipient-saved-test-app", props);
  const form = app.shadowRoot!.querySelector("till-invoice-recipient-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
function control(form: TillInvoiceRecipientDialog, name: string) {
  return form.shadowRoot!.querySelector<
    HTMLElementTagNameMap["wt-input"] | HTMLElementTagNameMap["wt-combobox"]
  >(`[name=${name}]`)!;
}
function values(form: TillInvoiceRecipientDialog) {
  return Object.fromEntries(
    [
      "identifierType",
      "identifierCountryCode",
      "taxId",
      "legalName",
      "address",
      "postalCode",
      "locality",
      "province",
      "countryCode",
      "delivery",
    ].map((name) => [name, control(form, name)?.value]),
  );
}
function saveButton(form: TillInvoiceRecipientDialog) {
  return form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-invoice-save]")!;
}
async function saveState(form: TillInvoiceRecipientDialog) {
  await form.updateComplete;
  const save = saveButton(form);
  await save.updateComplete;
  return { variant: save.variant, disabled: save.disabled };
}
async function fill(form: TillInvoiceRecipientDialog, name: string, value: string) {
  const field = control(form, name) as HTMLElementTagNameMap["wt-input"];
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  await userEvent.fill(page.elementLocator(input), value);
  await form.updateComplete;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

it("opens with every field of the saved recipient and its delivery filled in", async () => {
  const { form } = await mount();
  expect(values(form)).toEqual({
    identifierType: "passport",
    identifierCountryCode: "FR",
    taxId: "X1234567",
    legalName: "Ana García",
    address: "Calle Mayor 1, 2º B",
    postalCode: "28013",
    locality: "Madrid",
    province: "Madrid",
    countryCode: "ES",
    delivery: "a4",
  });
});

it("reads a saved recipient without an identifier type as a tax number", async () => {
  const { form } = await mount({
    recipient: {
      taxId: "B12345674",
      legalName: "Acme SL",
      address: "Calle Mayor 1, 28013 Madrid, Madrid",
      countryCode: "ES",
    },
  });
  expect(values(form)).toMatchObject({
    identifierType: "tax-number",
    taxId: "B12345674",
    legalName: "Acme SL",
    address: "Calle Mayor 1",
  });
});

it("keeps Use full invoice quiet and disabled until a field changes", async () => {
  const { form } = await mount();
  expect(await saveState(form)).toEqual({ variant: "secondary", disabled: true });
  await fill(form, "legalName", "Ana García López");
  expect(await saveState(form)).toEqual({ variant: "primary", disabled: false });
});

it("sends the edited recipient, with the rest of the saved one unchanged, on Use full invoice", async () => {
  const { app, form } = await mount();
  await fill(form, "legalName", "Ana García López");
  saveButton(form).click();
  await form.updateComplete;
  expect(app.submitted).toEqual([
    {
      invoiceType: "F1",
      recipient: { ...passport, legalName: "Ana García López" },
      delivery: a4,
    },
  ]);
});

it("closes on Cancel without asking about unsaved changes when nothing changed", async () => {
  const { app, form } = await mount();
  expect(unload()).toBe(false);
  form.shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
  await expect.poll(() => app.closes).toBe(1);
  expect(app.submitted).toEqual([]);
  await app.updateComplete;
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")?.open ?? false).toBe(false);
});

it("opens blank without a saved recipient", async () => {
  const { form } = await mount({ recipient: null, saved: undefined });
  expect(values(form)).toMatchObject({ taxId: "", legalName: "", address: "", countryCode: "ES" });
});
