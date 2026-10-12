import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import type { DashboardApi, ReceiptLanguage } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { ReceiptLanguagePanel } from "./receipt-language-panel.js";

const cases = ["light", "dark"].flatMap((theme) =>
  ["en-GB", "es-ES"].flatMap((locale) =>
    [390, 1280].map((width) => ({ theme: theme as "light" | "dark", locale, width })),
  ),
);
afterEach(async () => {
  cleanupWidgets();
  setLocale("en-GB");
  await page.viewport(1280, 900);
});
it.each(cases)(
  "receipt language card: $locale / $theme / $width",
  async ({ theme, locale, width }) => {
    await page.viewport(width, 900);
    setLocale(locale);
    for (const state of [
      "editable",
      "fixed",
      "fixed-mismatch",
      "warning",
      "refused",
      "read-error",
    ]) {
      const model: ReceiptLanguage = {
        language: state === "warning" ? "eu-ES" : "es-ES",
        choices: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
        fixed: state.startsWith("fixed")
          ? {
              locale: state === "fixed" ? "es-ES" : "ca-ES",
              reason: { en: "Required for this territory", es: "Obligatorio en este territorio" },
            }
          : null,
      };
      const api = {
        getReceiptLanguage: async () => {
          if (state === "read-error") throw { code: "management.failed" };
          return model;
        },
        getContentLanguages: async () => ({ defaultLanguage: "es", languages: ["es", "ca"] }),
        putReceiptLanguage: async () => {
          throw { code: "receipt.language_orders_open", params: { field: "receiptLanguage" } };
        },
      } as unknown as DashboardApi;
      const { el, host } = await mountWidget<ReceiptLanguagePanel>(
        "dashboard-receipt-language-panel",
        { api },
        theme,
      );
      await expect
        .poll(() =>
          el.shadowRoot!.querySelector(
            state === "read-error" ? "[role=alert]" : "[data-test=language-section]",
          ),
        )
        .toBeTruthy();
      if (state === "refused") {
        const field = el.shadowRoot!.querySelector("wt-combobox")!;
        field.dispatchEvent(
          new CustomEvent("wt-change", {
            detail: { value: "ca-ES" },
            bubbles: true,
            composed: true,
          }),
        );
        await el.updateComplete;
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=language-save]")!.click();
        await expect.poll(() => field.error).not.toBe("");
      }
      await expectNoA11yViolations(host);
      expect(el.scrollWidth).toBeLessThanOrEqual(width);
      await page.screenshot({
        element: host,
        path: `__screenshots__/look/a493-language-${locale}-${theme}-${width}-${state}.png`,
      });
      host.remove();
    }
  },
);
