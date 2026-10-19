import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./bill-pay-dialog.js";
import type { TillBillPayDialog } from "./bill-pay-dialog.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

describe.each([
  {
    locale: "en",
    label: "Terrace · Bill 2",
    sentence: "Send or remove the unsent dishes before paying.",
  },
  {
    locale: "es",
    label: "Terraza · Cuenta 2",
    sentence: "Envía o quita los platos sin enviar antes de cobrar.",
  },
])("unsent payment refusal in $locale", ({ locale, label, sentence }) => {
  describe.each(["light", "dark"] as const)("%s", (theme) => {
    it.each([360, 390, 1280])("shows the bill and code-only refusal at %i", async (width) => {
      setLocale(locale);
      await page.viewport(width, 900);
      const { el, host } = await mountWidget<TillBillPayDialog>(
        "till-bill-pay-dialog",
        {
          way: "contribution",
          balance: {
            workingOrderId: "bill-2",
            status: "open",
            total: "40.00",
            received: "0.00",
            reserved: "0.00",
            outstanding: "40.00",
            tips: "0.00",
            payments: [],
            paidLines: [],
          },
          refusal: { code: "bill.unsent_dishes", unsent: { billId: "bill-2" }, billLabel: label },
        },
        theme,
      );
      host.style.width = "100%";
      const form = el.shadowRoot!.querySelector("wt-form-actions")!;
      await form.updateComplete;
      expect(form.error).toBe(`${label}. ${sentence}`);
      await expectNoA11yViolations(host);
      const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
      await dialog.updateComplete;
      const nativeError = form.shadowRoot!.querySelector<HTMLElement>("[role=alert]")!;
      expect(nativeError.textContent!.trim()).toBe(`${label}. ${sentence}`);
      expect(nativeError.checkVisibility()).toBe(true);
      const box = nativeError.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
      expect(nativeError.scrollWidth).toBeLessThanOrEqual(nativeError.clientWidth);
      expect(window.innerWidth).toBe(width);
      await page.screenshot({
        path: `__screenshots__/a773-pay-unsent-${locale}-${theme}-${width}.png`,
      });
      el.refusal = { code: "bill.unsent_dishes" };
      await el.updateComplete;
      await form.updateComplete;
      await dialog.updateComplete;
      expect(form.error).toBe(sentence);
      expect(nativeError.textContent!.trim()).toBe(sentence);
    });
  });
});
