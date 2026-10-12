import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import {
  clickReceiptSave,
  editReceipt,
  mountReceiptDialog,
  receiptApi,
  receiptField,
} from "../testing/department-receipt-dialog-fixture.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
const cases = (["light", "dark"] as const).flatMap((theme) =>
  ["en-GB", "es-ES"].flatMap((locale) => [390, 1280].map((width) => ({ theme, locale, width }))),
);
it.each(cases)(
  "department receipt states $locale $theme $width are accessible and fit",
  async ({ theme, locale, width }) => {
    const before = { width: innerWidth, height: innerHeight };
    await page.viewport(width, 900);
    try {
      for (const state of ["open", "dirty", "invalid", "refused"] as const) {
        setLocale(locale);
        const api = receiptApi();
        api.putDepartmentReceipt.mockRejectedValue({
          code: "receipt.invalid",
          params: { field: "email", reason: "invalid_email" },
        });
        const { el, host, dialog } = await mountReceiptDialog(api, theme);
        if (state !== "open")
          await editReceipt(el, "email", state === "invalid" ? "invalid" : "bar@example.com");
        if (state === "invalid" || state === "refused") {
          await clickReceiptSave(el);
          await expect.poll(() => receiptField(el, "email").error).not.toBe("");
          await receiptField(el, "email").updateComplete;
        }
        await expectNoA11yViolations(host);
        await expect.poll(() => el.shadowRoot!.querySelector(".paper")).toBeTruthy();
        const native = dialog.shadowRoot!.querySelector("dialog")!;
        expect(native.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        expect(native.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
        const body = dialog.shadowRoot!.querySelector<HTMLElement>(".body")!;
        expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
        if (import.meta.env.VITE_A493_DIALOG_CAPTURE === "1") {
          body.scrollTop = 0;
          await page.screenshot({
            path: `__screenshots__/a493-dialog/${locale}-${theme}-${width}-${state}-top.png`,
          });
          body.scrollTop = body.scrollHeight;
          await page.screenshot({
            path: `__screenshots__/a493-dialog/${locale}-${theme}-${width}-${state}-bottom.png`,
          });
        }
        cleanupWidgets();
      }
    } finally {
      await page.viewport(before.width, before.height);
    }
  },
);
