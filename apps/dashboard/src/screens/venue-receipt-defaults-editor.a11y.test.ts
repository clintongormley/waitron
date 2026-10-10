import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import "@waitron/dashboard-modules";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./venue-receipt-defaults-editor.js";
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
for (const theme of ["light", "dark"] as const)
  for (const locale of ["en-GB", "es-ES"] as const) {
    it(`${theme}/${locale} defaults remain accessible pristine, dirty and refused`, async () => {
      setLocale(locale);
      const api = {
        getVenueReceiptSettings: async () => ({
          settings: { headerSubtitle: "Restaurant", footerMessage: "Gracias" },
        }),
        putVenueReceiptSettings: async () => {
          throw { code: "receipt.invalid", params: { field: "headerSubtitle", maxLength: 500 } };
        },
      } as unknown as DashboardApi;
      const { el, host } = await mountWidget<
        HTMLElementTagNameMap["dashboard-venue-receipt-defaults-editor"]
      >("dashboard-venue-receipt-defaults-editor", { api }, theme);
      await vi.waitFor(() =>
        expect(el.shadowRoot?.querySelector("wt-input[name=headerSubtitle]")).toBeTruthy(),
      );
      await expectNoA11yViolations(host);
      const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
        "wt-input[name=headerSubtitle]",
      )!;
      await field.updateComplete;
      await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), "Typed");
      await el.updateComplete;
      await expectNoA11yViolations(host);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=defaults-save]")!.click();
      await vi.waitFor(() => expect(field.error).not.toBe(""));
      await expectNoA11yViolations(host);
    });
  }
