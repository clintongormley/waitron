import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { staffNoticeText } from "../i18n/staff-notices.js";
import type { StaffNotice } from "../api/client.js";
import type { TillPaymentsPausedDialog } from "./payments-paused-dialog.js";
import "./payments-paused-dialog.js";

const WAITING: StaffNotice = {
  owner: "box-clock",
  key: "clock.unconfirmed",
  code: "clock.unconfirmed",
  severity: "error",
  params: { agreed: 0, cause: "clock_jumped" },
};

const DISK_FULL: StaffNotice = {
  owner: "box",
  key: "storage.disk_full",
  code: "storage.disk_full",
  severity: "error",
  params: {},
};

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

describe.each(["light", "dark"] as const)("till-payments-paused-dialog a11y (%s)", (theme) => {
  for (const locale of ["en", "es"] as const)
    for (const checkTimeOffered of [true, false])
      it(`says why payments wait in ${locale}, Check the time offered: ${checkTimeOffered}`, async () => {
        setLocale(locale);
        for (const width of [390, 1280]) {
          await page.viewport(width, 900);
          const { el, host } = await mountWidget<TillPaymentsPausedDialog>(
            "till-payments-paused-dialog",
            { notice: WAITING, checkTimeOffered },
            theme,
          );
          await expectNoA11yViolations(host);
          const close = el.shadowRoot!.querySelector<HTMLElement>("[data-close]")!;
          const box = close.getBoundingClientRect();
          expect(box.width).toBeGreaterThan(0);
          expect(box.right).toBeLessThanOrEqual(width);
          expect(el.shadowRoot!.querySelector("[data-check-time]") !== null).toBe(checkTimeOffered);
          const words = [...el.shadowRoot!.querySelectorAll("p")].map((p) => p.textContent!.trim());
          expect(words).toEqual([
            staffNoticeText(WAITING, checkTimeOffered).main,
            t("payments_paused.order_open"),
          ]);
          cleanupWidgets();
        }
      });

  for (const locale of ["en", "es"] as const)
    it(`says why payments wait for a full disk in ${locale}, with its hint and no Check the time`, async () => {
      setLocale(locale);
      for (const width of [390, 1280]) {
        await page.viewport(width, 900);
        const { el, host } = await mountWidget<TillPaymentsPausedDialog>(
          "till-payments-paused-dialog",
          { notice: DISK_FULL, checkTimeOffered: true },
          theme,
        );
        await expectNoA11yViolations(host);
        const close = el.shadowRoot!.querySelector<HTMLElement>("[data-close]")!;
        const box = close.getBoundingClientRect();
        expect(box.width).toBeGreaterThan(0);
        expect(box.right).toBeLessThanOrEqual(width);
        expect(el.shadowRoot!.querySelector("[data-check-time]")).toBeNull();
        const words = [...el.shadowRoot!.querySelectorAll("p")].map((p) => p.textContent!.trim());
        const { main, hint } = staffNoticeText(DISK_FULL);
        expect(words).toEqual([main, hint, t("payments_paused.order_open")]);
        cleanupWidgets();
      }
    });
});
