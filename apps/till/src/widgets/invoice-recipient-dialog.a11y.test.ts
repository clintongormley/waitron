import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./invoice-recipient-dialog.js";
import type { TillInvoiceRecipientDialog } from "./invoice-recipient-dialog.js";

afterEach(cleanupWidgets);

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
        el.shadowRoot!.querySelector<HTMLElement>("[data-invoice-save]")!.click();
        await el.updateComplete;
      }
      await expectNoA11yViolations(host);
    },
  );
});
