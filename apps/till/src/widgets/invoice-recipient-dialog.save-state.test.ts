import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./invoice-recipient-dialog.js";
import type {
  InvoiceRecipientDetail,
  TillInvoiceRecipientDialog,
} from "./invoice-recipient-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));

async function mount(props: Partial<TillInvoiceRecipientDialog> = {}) {
  const { el } = await mountWidget<TillInvoiceRecipientDialog>(
    "till-invoice-recipient-dialog",
    props,
  );
  return el;
}
function saveButton(el: TillInvoiceRecipientDialog) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-invoice-save]")!;
}
function field(el: TillInvoiceRecipientDialog, name: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`wt-input[name=${name}]`)!;
}
function bottom(el: TillInvoiceRecipientDialog) {
  return el.shadowRoot!.querySelector("wt-form-actions")!;
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(el: TillInvoiceRecipientDialog) {
  await el.updateComplete;
  const save = saveButton(el);
  await save.updateComplete;
  return {
    variant: save.variant,
    disabled: save.disabled,
    innerDisabled: save.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
async function type(el: TillInvoiceRecipientDialog, name: string, value: string) {
  const input = field(el, name);
  await input.updateComplete;
  await userEvent.fill(page.elementLocator(input.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
function confirmations(el: TillInvoiceRecipientDialog) {
  const sent: InvoiceRecipientDetail[] = [];
  el.addEventListener("invoice-recipient-confirm", (event) =>
    sent.push((event as CustomEvent<InvoiceRecipientDetail>).detail),
  );
  return sent;
}
const fieldNames = ["taxId", "legalName", "address", "postalCode", "locality", "province"];

it("opens with Save quiet and disabled", async () => {
  const el = await mount();
  expect(await saveState(el)).toEqual(quiet);
});

it("typing into one field makes Save primary and enabled, and clearing it makes Save quiet again", async () => {
  const el = await mount();
  await type(el, "legalName", "Ana García");
  expect(await saveState(el)).toEqual(ready);
  await type(el, "legalName", "");
  expect(await saveState(el)).toEqual(quiet);
});

it("a changed form that is still incomplete shows its field errors on the press, and keeps Save primary but disabled", async () => {
  const el = await mount();
  const sent = confirmations(el);
  await type(el, "legalName", "Ana García");
  saveButton(el).click();
  await el.updateComplete;
  expect(sent).toEqual([]);
  expect(field(el, "legalName").error).toBe("");
  expect(field(el, "taxId").error).toBe(t("invoice.tax_id_invalid"));
  expect(field(el, "province").error).toBe(t("invoice.province_required"));
  expect(bottom(el).error).toBe(t("form.fix_fields"));
  expect(await saveState(el)).toEqual({
    variant: "primary",
    disabled: true,
    innerDisabled: true,
  });
});

// A host `.click()` reaches Save's listener even while its inner button is disabled, so this
// presses the host: what it proves is that the handler itself sends nothing for an untouched form.
it("a press that reaches Save's handler on an untouched form sends nothing and marks no field", async () => {
  const el = await mount();
  const sent = confirmations(el);
  saveButton(el).click();
  await el.updateComplete;
  expect(sent).toEqual([]);
  for (const name of fieldNames) expect(field(el, name).error).toBe("");
  expect(bottom(el).error).toBe("");
});

it("Enter in a field on an untouched form sends nothing and marks no field", async () => {
  const el = await mount();
  const sent = confirmations(el);
  field(el, "taxId")
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await el.updateComplete;
  expect(sent).toEqual([]);
  for (const name of fieldNames) expect(field(el, name).error).toBe("");
});

it("opened with a server refusal but untouched, Save is quiet and the refusal still shows", async () => {
  const el = await mount({ refusal: "The server could not be reached", refusalField: "" });
  expect(await saveState(el)).toEqual(quiet);
  expect(bottom(el).error).toBe("The server could not be reached");
});
