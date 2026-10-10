import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import "@waitron/dashboard-modules";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./department-receipt-editor.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
for (const theme of ["light", "dark"] as const)
  for (const locale of ["en-GB", "es-ES"] as const) {
    it(`${theme}/${locale} department editor remains accessible with inherited, dirty, and refused contact`, async () => {
      setLocale(locale);
      const api = {
        getDepartmentReceipt: async () => ({
          receipt: {},
          venueDefaults: { headerSubtitle: "Restaurant", footerMessage: "Thank you" },
          languages: ["es-ES", "ca-ES"],
          warningLanguages: [],
          venueAddress: [],
        }),
        putDepartmentReceipt: async () => {
          throw { code: "receipt.invalid", params: { field: "email", reason: "invalid_email" } };
        },
      } as unknown as DashboardApi;
      const { el, host } = await mountWidget<
        HTMLElementTagNameMap["dashboard-department-receipt-editor"]
      >(
        "dashboard-department-receipt-editor",
        { api, departmentId: "bar", departmentName: "Bar", receiptLanguage: "es-ES" },
        theme,
      );
      await vi.waitFor(() =>
        expect(el.shadowRoot?.querySelector("wt-input[name=email]")).toBeTruthy(),
      );
      await expectNoA11yViolations(host);
      const field =
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=email]")!;
      await field.updateComplete;
      await userEvent.fill(
        page.elementLocator(field.shadowRoot!.querySelector("input")!),
        "bar@example.com",
      );
      await el.updateComplete;
      await expectNoA11yViolations(host);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=department-save]")!.click();
      await vi.waitFor(() => expect(field.error).not.toBe(""));
      await expectNoA11yViolations(host);
    });
  }
