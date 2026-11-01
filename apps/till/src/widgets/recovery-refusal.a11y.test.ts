import { afterEach, beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { refusalOf } from "../state/bill-payment.js";
import type { TillPresentedPayDialog } from "./presented-pay-dialog.js";
import "./presented-pay-dialog.js";

let localeBefore: string;
const size = { width: window.innerWidth, height: window.innerHeight };
beforeEach(() => {
  localeBefore = currentLocale();
});
afterEach(async () => {
  cleanupWidgets();
  setLocale(localeBefore);
  await page.viewport(size.width, size.height);
});
for (const locale of ["en", "es"] as const)
  for (const theme of ["light", "dark"] as const) {
    it(`renders actionable recovery in ${locale}/${theme} at phone and desktop widths`, async () => {
      setLocale(locale);
      for (const width of [390, 1280]) {
        await page.viewport(width, 900);
        for (const charged of [false, true]) {
          const { el, host } = await mountWidget<TillPresentedPayDialog>(
            "till-presented-pay-dialog",
            {
              open: true,
              amount: "35.00",
              tableName: "Table 4",
              takesCash: true,
              refusal: refusalOf({
                code: charged ? "sale.charged_not_recorded" : "sif.allocation_invalid",
                recoveryUrl: "/manage/recovery/fiscal-conflict",
              }),
            },
            theme,
          );
          await expectNoA11yViolations(host);
          const link = el.shadowRoot!.querySelector<HTMLAnchorElement>("a[data-recovery]")!;
          const box = link.getBoundingClientRect();
          expect(box.width).toBeGreaterThan(0);
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(width);
          await page.screenshot({
            path: `__screenshots__/look/w41s7-recovery-${locale}-${theme}-${width}-${charged}.png`,
          });
          cleanupWidgets();
        }
      }
    });
  }
