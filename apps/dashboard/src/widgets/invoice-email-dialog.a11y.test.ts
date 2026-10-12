import { afterEach, expect, it, vi } from "vitest";
import type { WtDialog, WtFormActions } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { DashboardApi } from "../api/client.js";
import "./invoice-email-dialog.js";
import type { InvoiceEmailDialog } from "./invoice-email-dialog.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const states = ["empty", "address marked", "refused", "sending"] as const;

for (const locale of ["en-GB", "es-ES"])
  for (const theme of ["light", "dark"] as const)
    for (const state of states)
      it(`has no violations ${state} (${locale}, ${theme})`, async () => {
        setLocale(locale);
        const requestOrderEmailDelivery =
          state === "sending"
            ? vi.fn(() => new Promise(() => undefined))
            : vi.fn().mockRejectedValue({ code: "invoice_delivery.email_unavailable" });
        const { el, host } = await mountWidget<InvoiceEmailDialog>(
          "dashboard-invoice-email-dialog",
          { api: { requestOrderEmailDelivery } as unknown as DashboardApi },
          theme,
        );
        el.show("bill-1");
        await el.updateComplete;
        const dialog = el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
        await expect.poll(() => dialog.open).toBe(true);
        if (state !== "empty") {
          dialog.querySelector("wt-input[name=email]")!.dispatchEvent(
            new CustomEvent("wt-change", {
              detail: { value: state === "address marked" ? "ana@" : "ana@example.com" },
              bubbles: true,
              composed: true,
            }),
          );
          await el.updateComplete;
          dialog.querySelector<HTMLElement>("[data-test=send-email]")!.click();
          if (state === "sending")
            await vi.waitFor(() => expect(requestOrderEmailDelivery).toHaveBeenCalled());
          else
            await vi.waitFor(() =>
              expect(dialog.querySelector<WtFormActions>("wt-form-actions")!.error).not.toBe(""),
            );
          await el.updateComplete;
        }
        await expectNoA11yViolations(host);
      });
