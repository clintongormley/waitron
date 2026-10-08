import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./invoice-recipient-dialog.js";
import type {
  InvoiceRecipientDetail,
  TillInvoiceRecipientDialog,
} from "./invoice-recipient-dialog.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

async function mountDialog() {
  const { el } = await mountWidget<TillInvoiceRecipientDialog>("till-invoice-recipient-dialog", {});
  return el;
}

async function fill(el: TillInvoiceRecipientDialog, name: string, value: string) {
  const field = el.shadowRoot!.querySelector<HTMLElement>(`wt-input[name=${name}]`)!;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
}

describe("till-invoice-recipient-dialog", () => {
  it("shows Spain in the selected language", async () => {
    const el = await mountDialog();
    const country = el.shadowRoot!.querySelector<HTMLElement & { value: string }>(
      "wt-input[name=countryCode]",
    )!;
    expect(country.value).toBe("Spain");
  });

  it.each(["en", "es-ES"])(
    "puts a server field refusal under its field with a generic bottom message in %s",
    async (locale) => {
      setLocale(locale);
      const el = await mountDialog();
      await fill(el, "taxId", "12345678Z");
      await fill(el, "legalName", "Ana García");
      await fill(el, "address", "Calle Mayor 1");
      await fill(el, "postalCode", "28013");
      await fill(el, "locality", "Madrid");
      await fill(el, "province", "Madrid");
      el.refusal = "Check the customer name";
      el.refusalField = "legalName";
      await el.updateComplete;

      expect(
        el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-input[name=legalName]")!
          .error,
      ).toBe("Check the customer name");
      expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
      expect(
        el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-invoice-save]")!
          .disabled,
      ).toBe(false);

      el.refusalField = "";
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
        "Check the customer name",
      );
    },
  );

  it("retains an unscoped server refusal alongside local field errors", async () => {
    const el = await mountDialog();
    el.refusal = "The server could not be reached";
    el.refusalField = "";
    await el.updateComplete;
    await fill(el, "legalName", "Ana García");
    el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
      `${t("form.fix_fields")} The server could not be reached`,
    );
  });

  it("identifies a missing province before sending a full invoice recipient", async () => {
    const el = await mountDialog();
    const saved: InvoiceRecipientDetail[] = [];
    el.addEventListener("invoice-recipient-confirm", (event) =>
      saved.push((event as CustomEvent<InvoiceRecipientDetail>).detail),
    );

    await fill(el, "taxId", "12345678Z");
    await fill(el, "legalName", "Ana García");
    await fill(el, "address", "Calle Mayor 1");
    await fill(el, "postalCode", "28013");
    await fill(el, "locality", "Madrid");
    el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    await el.updateComplete;

    expect(saved).toEqual([]);
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-input[name=province]")!
        .error,
    ).not.toBe("");
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));

    await fill(el, "province", "Madrid");
    el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    expect(saved[0]?.recipient.address).toBe("Calle Mayor 1, 28013 Madrid, Madrid, España");
  });

  it("marks an invalid Spanish tax ID and missing customer details, then saves corrected details", async () => {
    const el = await mountDialog();
    const saved: InvoiceRecipientDetail[] = [];
    el.addEventListener("invoice-recipient-confirm", (event) =>
      saved.push((event as CustomEvent<InvoiceRecipientDetail>).detail),
    );

    await fill(el, "taxId", "12345678A");
    el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    await el.updateComplete;

    expect(saved).toEqual([]);
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-input[name=taxId]")!.error,
    ).not.toBe("");
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-input[name=legalName]")!
        .error,
    ).not.toBe("");
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-input[name=address]")!
        .error,
    ).not.toBe("");
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
    expect(
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("[data-invoice-save]")!
        .disabled,
    ).toBe(true);

    await fill(el, "taxId", " 12345678z ");
    await fill(el, "legalName", "  Ana García ");
    await fill(el, "address", "  Calle Mayor 1 ");
    await fill(el, "postalCode", " 28013 ");
    await fill(el, "locality", " Madrid ");
    await fill(el, "province", " Madrid ");

    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
    el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
    expect(saved).toEqual([
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
  });
});
