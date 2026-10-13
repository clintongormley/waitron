import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./invoice-email-dialog.js";
import type { TillInvoiceEmailDialog } from "./invoice-email-dialog.js";

afterEach(cleanupWidgets);

const sendButton = (el: TillInvoiceEmailDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-email-send]")!;

async function type(el: TillInvoiceEmailDialog, value: string) {
  const field = el.shadowRoot!.querySelector("wt-input")!;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("till-invoice-email-dialog a11y (%s theme)", (theme) => {
  for (const locale of ["en", "es-ES"] as const) {
    async function mount(props: Partial<TillInvoiceEmailDialog> = {}) {
      setLocale(locale);
      return mountWidget<TillInvoiceEmailDialog>("till-invoice-email-dialog", props, theme);
    }

    it(`${locale}: has no violations when it opens, with Send quiet and disabled`, async () => {
      const { el, host } = await mount();
      await sendButton(el).updateComplete;
      expect(sendButton(el).variant).toBe("secondary");
      expect(sendButton(el).disabled).toBe(true);
      await expectNoA11yViolations(host);
    });

    it(`${locale}: has no violations with an address typed, as a copy, with Send primary`, async () => {
      const { el, host } = await mount({ copy: true });
      await type(el, "ana@example.com");
      expect(sendButton(el).variant).toBe("primary");
      expect(sendButton(el).disabled).toBe(false);
      await expectNoA11yViolations(host);
    });

    it(`${locale}: has no violations with a malformed address marked`, async () => {
      const { el, host } = await mount();
      await type(el, "ana@");
      sendButton(el).click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("wt-input")!.error).toBe(t("invoice.email_invalid"));
      await expectNoA11yViolations(host);
    });

    it(`${locale}: has no violations with a refusal at the bottom while a send is out, the field and Cancel held`, async () => {
      const { el, host } = await mount();
      await type(el, "ana@example.com");
      el.refusal = { code: "invoice_delivery.email_unavailable" };
      el.busy = true;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
      expect(el.shadowRoot!.querySelector("wt-input")!.disabled).toBe(true);
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-email-cancel]")!
          .disabled,
      ).toBe(true);
      await expectNoA11yViolations(host);
    });
  }
});
