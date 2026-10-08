import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./invoice-recipient-dialog.js";
import type { TillInvoiceRecipientDialog } from "./invoice-recipient-dialog.js";

afterEach(cleanupWidgets);

const saveButton = (el: TillInvoiceRecipientDialog) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-invoice-save]")!;

describe.each(["light", "dark"] as const)("full invoice recipient a11y (%s theme)", (theme) => {
  it.each(["empty", "invalid", "field-refusal", "network-and-invalid"] as const)(
    "%s form has no violations",
    async (state) => {
      setLocale("es-ES");
      const { el, host } = await mountWidget<TillInvoiceRecipientDialog>(
        "till-invoice-recipient-dialog",
        {},
        theme,
      );
      if (state === "field-refusal") {
        el.refusal = "Revisa el nombre del cliente";
        el.refusalField = "legalName";
        await el.updateComplete;
      }
      if (state === "network-and-invalid") {
        el.refusal = "No se ha podido conectar con el servidor";
        await el.updateComplete;
      }
      if (state === "invalid" || state === "network-and-invalid") {
        const taxId = el.shadowRoot!.querySelector("wt-input[name=taxId]")!;
        await userEvent.fill(page.elementLocator(taxId.shadowRoot!.querySelector("input")!), "123");
        await el.updateComplete;
        el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
        await el.updateComplete;
        expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toContain(
          t("form.fix_fields"),
        );
      }
      await expectNoA11yViolations(host);
    },
  );

  it("has no violations when it opens, with Save quiet and disabled", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillInvoiceRecipientDialog>(
      "till-invoice-recipient-dialog",
      {},
      theme,
    );
    await saveButton(el).updateComplete;
    expect(saveButton(el).variant).toBe("secondary");
    expect(saveButton(el).disabled).toBe(true);
    await expectNoA11yViolations(host);
  });

  it("has no violations once a field changes, with Save primary and enabled", async () => {
    setLocale("es-ES");
    const { el, host } = await mountWidget<TillInvoiceRecipientDialog>(
      "till-invoice-recipient-dialog",
      {},
      theme,
    );
    const field = el.shadowRoot!.querySelector("wt-input[name=legalName]")!;
    await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), "Ana");
    await el.updateComplete;
    await saveButton(el).updateComplete;
    expect(saveButton(el).variant).toBe("primary");
    expect(saveButton(el).disabled).toBe(false);
    await expectNoA11yViolations(host);
  });
});
