import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./invoice-recipient-dialog.js";
import type {
  InvoiceRecipientDetail,
  TillInvoiceRecipientDialog,
} from "./invoice-recipient-dialog.js";

afterEach(cleanupWidgets);
beforeEach(() => setLocale("en"));
async function mount() {
  return (await mountWidget<TillInvoiceRecipientDialog>("till-invoice-recipient-dialog", {})).el;
}
async function edit(el: TillInvoiceRecipientDialog, name: string, value: string) {
  const control = el.shadowRoot!.querySelector(`wt-input[name=${name}],wt-combobox[name=${name}]`);
  expect(control, `rendered ${name}`).not.toBeNull();
  control!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
function save(el: TillInvoiceRecipientDialog) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-invoice-save]")!;
}
function sent(el: TillInvoiceRecipientDialog) {
  const values: InvoiceRecipientDetail[] = [];
  el.addEventListener("invoice-recipient-confirm", (e) =>
    values.push((e as CustomEvent<InvoiceRecipientDetail>).detail),
  );
  return values;
}
async function address(el: TillInvoiceRecipientDialog) {
  for (const [name, value] of [
    ["legalName", "Customer"],
    ["address", "2 Main Street"],
    ["locality", "Paris"],
  ])
    await edit(el, name!, value!);
}
it("submits a normalized Spanish identifier with a foreign address and optional foreign fields", async () => {
  const el = await mount();
  const values = sent(el);
  await address(el);
  await edit(el, "countryCode", "FR");
  await edit(el, "taxId", " b12345674 ");
  save(el).click();
  expect(values).toEqual([
    {
      invoiceType: "F1",
      recipient: {
        taxId: "B12345674",
        legalName: "Customer",
        address: "2 Main Street, Paris",
        countryCode: "FR",
      },
    },
  ]);
});
it.each(["FR", "ES"])(
  "submits an explicit passport without changing its text with postal %s",
  async (country) => {
    const el = await mount();
    const values = sent(el);
    await address(el);
    if (country === "ES") {
      await edit(el, "postalCode", "28013");
      await edit(el, "province", "Madrid");
    }
    await edit(el, "countryCode", country);
    await edit(el, "identifierType", "passport");
    await edit(el, "identifierCountryCode", "FR");
    await edit(el, "taxId", " Ab-09 /xy ");
    save(el).click();
    expect(values).toEqual([
      {
        invoiceType: "F1",
        recipient: {
          taxId: " Ab-09 /xy ",
          identifierType: "passport",
          identifierCountryCode: "FR",
          legalName: "Customer",
          address: country === "ES" ? "2 Main Street, 28013 Paris, Madrid" : "2 Main Street, Paris",
          countryCode: country,
        },
      },
    ]);
  },
);
it("never copies postal country into a newly chosen document's issuer", async () => {
  const el = await mount();
  await edit(el, "countryCode", "FR");
  await edit(el, "identifierType", "passport");
  const issuer = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    "[name=identifierCountryCode]",
  )!;
  expect(issuer.value).toBe("");
  expect(issuer.required).toBe(true);
  await edit(el, "taxId", "P123");
  save(el).click();
  await el.updateComplete;
  expect(issuer.error).not.toBe("");
  expect(save(el).disabled).toBe(true);
  await edit(el, "identifierCountryCode", "FR");
  expect(issuer.error).toBe("");
});
it("requires an explicit identifier and explains how to return without saving", async () => {
  const el = await mount();
  await address(el);
  await edit(el, "countryCode", "FR");
  save(el).click();
  await el.updateComplete;
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=taxId]")!;
  expect(field.error).toBe(t("invoice.identifier_required"));
  expect(field.error).toContain("Cancel");
});
it("keeps submitted country and document metadata in completion comparisons", async () => {
  const el = await mount();
  await address(el);
  await edit(el, "countryCode", "FR");
  await edit(el, "identifierType", "passport");
  await edit(el, "identifierCountryCode", "FR");
  await edit(el, "taxId", "P123");
  save(el).click();
  const complete = el.writeCompletion();
  await edit(el, "identifierCountryCode", "GB");
  expect(complete()).toBe(false);
  expect(save(el).disabled).toBe(false);
  await edit(el, "identifierCountryCode", "FR");
  expect(save(el).disabled).toBe(true);
  await edit(el, "countryCode", "IE");
  expect(save(el).disabled).toBe(false);
});
it("treats foreign outer whitespace as a real edit while normalizing domestic comparison", async () => {
  const el = await mount();
  await address(el);
  await edit(el, "countryCode", "FR");
  await edit(el, "identifierType", "passport");
  await edit(el, "identifierCountryCode", "FR");
  await edit(el, "taxId", "P123");
  save(el).click();
  const complete = el.writeCompletion();
  await edit(el, "taxId", " P123 ");
  expect(complete()).toBe(false);
  expect(save(el).disabled).toBe(false);
});
it("retains address fields across country switches and refuses unsupported ES document types", async () => {
  const el = await mount();
  await edit(el, "postalCode", "28013");
  await edit(el, "province", "Madrid");
  await edit(el, "countryCode", "FR");
  await edit(el, "countryCode", "ES");
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=postalCode]")!.value,
  ).toBe("28013");
  await edit(el, "identifierType", "other-document");
  await edit(el, "identifierCountryCode", "ES");
  await edit(el, "taxId", "P123");
  save(el).click();
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=identifierType]")!
      .error,
  ).not.toBe("");
});

it("clears a hidden issuer refusal when returning to Spanish tax identification", async () => {
  const el = await mount();
  await edit(el, "identifierType", "passport");
  el.refusal = "Choose the issuer";
  el.refusalField = "identifierCountryCode";
  await el.updateComplete;
  const edited: string[] = [];
  el.addEventListener("invoice-recipient-edit", (event) =>
    edited.push((event as CustomEvent<{ field: string }>).detail.field),
  );
  await edit(el, "identifierType", "tax-number");
  expect(edited).toEqual(["identifierCountryCode"]);
});

it("keeps Save and Cancel in the dialog footer while the longer address form scrolls", async () => {
  const el = await mount();
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.slot).toBe("footer");
});

it.each([
  ["identifierType", "residence-country-id"],
  ["identifierCountryCode", "GB"],
  ["countryCode", "IE"],
])("retains a newer %s choice after the submitted save completes", async (field, value) => {
  const el = await mount();
  await address(el);
  await edit(el, "countryCode", "FR");
  await edit(el, "identifierType", "passport");
  await edit(el, "identifierCountryCode", "FR");
  await edit(el, "taxId", "P123");
  save(el).click();
  const complete = el.writeCompletion();
  await edit(el, field!, value!);
  expect(complete()).toBe(false);
  expect(save(el).disabled).toBe(false);
});
